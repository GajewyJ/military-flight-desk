import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, destinationPoint } from './geo';

export type LatLon = { lat: number; lon: number };

/**
 * Local frame of a run-in at a target: `x` is NM along the run-in heading (negative before the
 * target), `y` is NM towards the pattern side. Turning towards the pattern side is a
 * counter-clockwise turn in (x, y).
 */
export interface RunFrame {
  origin: LatLon;
  headingTrue: number;
  /** 1: pattern to the right of the run-in heading, -1: to the left. */
  sideSign: 1 | -1;
}

export function frameToLatLon(frame: RunFrame, x: number, y: number): LatLon {
  const along =
    x === 0
      ? frame.origin
      : destinationPoint(
          frame.origin.lat,
          frame.origin.lon,
          Math.abs(x),
          x > 0 ? frame.headingTrue : (frame.headingTrue + 180) % 360
        );
  if (y === 0) return along;
  const sideBrg = (frame.headingTrue + 90 * frame.sideSign + 360) % 360;
  return destinationPoint(along.lat, along.lon, Math.abs(y), y > 0 ? sideBrg : (sideBrg + 180) % 360);
}

/**
 * Points of a turn towards the pattern side: a circle arc around (cx, cy) with the given radius,
 * starting at `startDeg` (measured from +x, counter-clockwise) and sweeping `sweepDeg`, one point
 * every `stepDeg` (the start point itself is not included). Heading change per leg is `stepDeg`.
 */
export function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  sweepDeg: number,
  stepDeg: number
): Array<{ x: number; y: number }> {
  const n = Math.max(1, Math.round(sweepDeg / stepDeg));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= n; i++) {
    const a = ((startDeg + (sweepDeg * i) / n) * Math.PI) / 180;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

/**
 * Fixes between two points: legs of about `legNm`, each intermediate fix pushed sideways
 * (alternating sides, at most `maxLateralNm`) so the route bends gently instead of running dead
 * straight. The returned list ends with `to`; `from` is not included.
 */
export function transitFixes(from: LatLon, to: LatLon, legNm: number, maxLateralNm: number): LatLon[] {
  const dist = calculateDistanceNm(from.lat, from.lon, to.lat, to.lon);
  const brg = calculateBearingDeg(from.lat, from.lon, to.lat, to.lon);
  const n = Math.max(1, Math.round(dist / legNm));
  const fixes: LatLon[] = [];
  let sign = 1;
  for (let i = 1; i < n; i++) {
    const base = destinationPoint(from.lat, from.lon, (dist * i) / n, brg);
    const lateral = Math.min(maxLateralNm, 0.18 * (dist / n));
    fixes.push(destinationPoint(base.lat, base.lon, lateral, (brg + 90 * sign + 360) % 360));
    sign *= -1;
  }
  fixes.push(to);
  return fixes;
}

/**
 * Run-in heading: into the wind when there is wind, as long as it stays within `maxOffsetDeg` of
 * the direct bearing from home to the target (so the transit does not need a sharp turn);
 * otherwise a random offset within that limit. Returns a whole degree.
 */
export function chooseRunInHeading(
  homeToTargetDeg: number,
  windFromDeg: number | undefined,
  maxOffsetDeg: number,
  random: () => number = Math.random
): number {
  let offset: number;
  if (windFromDeg !== undefined) {
    offset = angularDiffDeg(homeToTargetDeg, windFromDeg);
    offset = Math.max(-maxOffsetDeg, Math.min(maxOffsetDeg, offset));
  } else {
    offset = (random() * 2 - 1) * maxOffsetDeg;
  }
  return Math.round((homeToTargetDeg + offset + 360) % 360) % 360;
}

/**
 * Fixes that bring an aircraft arriving from abeam or ahead of an airfield onto a straight-in
 * final without overflying the field. Threshold frame: `x` is NM before the threshold on the
 * approach side (positive) and `y` is NM towards the side the aircraft arrives from. The aircraft
 * runs out parallel to the approach course, 6.5 NM off it, then turns in on a 2.4 NM radius arc
 * in 45° steps and ends 1.7 NM off the course heading for the IP.
 * Returns [A, B, C, D, E]; the first fix is on the outbound leg, the last one points at the IP.
 */
export function straightInEntryArc(ipX: number): Array<{ x: number; y: number }> {
  const radius = 2.4;
  const cx = ipX + 5.5;
  const cy = 4.1;
  return [90, 45, 0, -45, -90].map((deg) => ({
    x: cx + radius * Math.cos((deg * Math.PI) / 180),
    y: cy + radius * Math.sin((deg * Math.PI) / 180),
  }));
}

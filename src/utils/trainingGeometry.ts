import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, destinationPoint, pointToPolylineDistanceNm } from './geo';

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

/** Outline of a transit between two points: straight with small offsets, one bend, a smooth bow, or an S-curve. */
export type TransitShape = 'direct' | 'dogleg' | 'arc' | 'sweep';

export interface TransitOptions {
  /** Distance between fixes (NM). */
  legNm: number;
  /** Sideways offset of the fixes of a direct transit (see transitFixes). */
  maxLateralNm: number;
  /** Heading of the leg that arrives at `from`; the first turn is limited to `maxStartTurnDeg`. */
  startBrg?: number;
  maxStartTurnDeg?: number;
  /** Wanted heading of the last leg (a run-in line, or the way home) and how far it may differ. */
  endBrg?: number;
  maxEndTurnDeg?: number;
  /** Largest heading change at a fix inside the transit. */
  maxTurnDeg?: number;
  /** Keep this far (NM) from a track flown earlier, except within 20 NM of either end (where the two tracks meet). */
  avoid?: LatLon[];
  minSepNm?: number;
  /** Side of the bend (1 right of the direct line, -1 left); random if not given. */
  side?: 1 | -1;
}

export interface Transit {
  fixes: LatLon[];
  shape: TransitShape;
  side: 1 | -1;
}

const SHAPE_WEIGHTS: Array<[TransitShape, number]> = [
  ['direct', 1],
  ['dogleg', 3],
  ['arc', 3],
  ['sweep', 2],
];

function pickShape(rng: () => number): TransitShape {
  const total = SHAPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [shape, w] of SHAPE_WEIGHTS) {
    if ((r -= w) < 0) return shape;
  }
  return 'direct';
}

/** The point at `t` (0-1) along the direct line, pushed `offsetNm` to the right (negative: left). */
function offsetAlong(from: LatLon, brg: number, dist: number, t: number, offsetNm: number): LatLon {
  const base = destinationPoint(from.lat, from.lon, dist * t, brg);
  if (Math.abs(offsetNm) < 1e-6) return base;
  return destinationPoint(base.lat, base.lon, Math.abs(offsetNm), (brg + (offsetNm > 0 ? 90 : 270)) % 360);
}

/**
 * Fixes from `from` to `to`, shaped as a direct line, a dogleg, a smooth arc or an S-curve, so routes between the
 * same two places do not all look alike. The result ends with `to` (`from` is not included). The shape is drawn at
 * random and checked against the limits in `opts`; when nothing fits, or the transit is short, it falls back to the
 * direct line of transitFixes.
 */
export function shapedTransit(from: LatLon, to: LatLon, opts: TransitOptions, rng: () => number = Math.random): Transit {
  const dist = calculateDistanceNm(from.lat, from.lon, to.lat, to.lon);
  const brg = calculateBearingDeg(from.lat, from.lon, to.lat, to.lon);
  const direct = (): Transit => ({ fixes: transitFixes(from, to, opts.legNm, opts.maxLateralNm), shape: 'direct', side: 1 });
  if (dist < 30) return direct();

  const maxTurn = opts.maxTurnDeg ?? 65;
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);

  for (let attempt = 0; attempt < 80; attempt++) {
    const shape = pickShape(rng);
    if (shape === 'direct') {
      // A return that must stay away from the track flown earlier is never a straight line back
      if (opts.avoid) continue;
      return direct();
    }
    const side: 1 | -1 = opts.side ?? (rng() < 0.5 ? 1 : -1);

    let poly: LatLon[];
    if (shape === 'dogleg') {
      const bulge = Math.min(between(0.12, 0.24) * dist, 45);
      const apexT = between(0.35, 0.65);
      const apex = offsetAlong(from, brg, dist, apexT, bulge * side);
      poly = [from];
      for (const [a, b] of [[from, apex], [apex, to]] as Array<[LatLon, LatLon]>) {
        const segLen = calculateDistanceNm(a.lat, a.lon, b.lat, b.lon);
        const m = Math.max(1, Math.round(segLen / opts.legNm));
        const segBrg = calculateBearingDeg(a.lat, a.lon, b.lat, b.lon);
        for (let k = 1; k <= m; k++) poly.push(k === m ? b : destinationPoint(a.lat, a.lon, (segLen * k) / m, segBrg));
      }
    } else {
      const n = Math.max(shape === 'sweep' ? 4 : 3, Math.min(12, Math.round(dist / opts.legNm)));
      const bulge = Math.min(between(shape === 'sweep' ? 0.07 : 0.12, shape === 'sweep' ? 0.12 : 0.24) * dist, 40);
      poly = [from];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const profile = shape === 'arc' ? Math.sin(Math.PI * t) : Math.sin(2 * Math.PI * t);
        poly.push(offsetAlong(from, brg, dist, t, bulge * profile * side));
      }
      poly.push(to);
    }

    const legBrg = (i: number) => calculateBearingDeg(poly[i].lat, poly[i].lon, poly[i + 1].lat, poly[i + 1].lon);
    let ok = true;
    if (opts.startBrg !== undefined && Math.abs(angularDiffDeg(opts.startBrg, legBrg(0))) > (opts.maxStartTurnDeg ?? 80)) ok = false;
    for (let i = 1; ok && i < poly.length - 1; i++) {
      if (Math.abs(angularDiffDeg(legBrg(i - 1), legBrg(i))) > maxTurn) ok = false;
    }
    if (ok && opts.endBrg !== undefined && Math.abs(angularDiffDeg(legBrg(poly.length - 2), opts.endBrg)) > (opts.maxEndTurnDeg ?? 50)) ok = false;
    if (ok && opts.avoid && opts.minSepNm) {
      // Every few NM along the transit, not just at the fixes: a long leg can cross the earlier track between them
      for (let i = 0; ok && i < poly.length - 1; i++) {
        const segLen = calculateDistanceNm(poly[i].lat, poly[i].lon, poly[i + 1].lat, poly[i + 1].lon);
        const segBrg = calculateBearingDeg(poly[i].lat, poly[i].lon, poly[i + 1].lat, poly[i + 1].lon);
        for (let d = 0; d <= segLen; d += 4) {
          const p = destinationPoint(poly[i].lat, poly[i].lon, d, segBrg);
          if (calculateDistanceNm(p.lat, p.lon, from.lat, from.lon) < 20 || calculateDistanceNm(p.lat, p.lon, to.lat, to.lon) < 20) continue;
          if (pointToPolylineDistanceNm(p, opts.avoid) < opts.minSepNm) {
            ok = false;
            break;
          }
        }
      }
    }
    if (ok) return { fixes: poly.slice(1), shape, side };
  }
  return direct();
}

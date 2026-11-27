import type { FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';
import type { LiveProgress } from './liveFlight';

/**
 * The data behind the altitude profile under the map: the planned altitude along the route, the terrain under it,
 * and where the aircraft is. Distances are along the route (nautical miles, as in the nav log), heights are in feet.
 */

export interface ProfilePoint {
  distNm: number;
  elevFt: number;
}

export interface PlannedPoint {
  distNm: number;
  altFt: number;
  index: number;
  id: string;
  name: string;
  type: FlightWaypoint['type'];
}

/** The planned altitude at every waypoint, by distance along the route. */
export function plannedSeries(plan: GeneratedFlightPlan): PlannedPoint[] {
  return plan.waypoints.map((w, index) => ({
    distNm: w.cumulativeDistNm,
    altFt: w.altFt,
    index,
    id: w.id,
    name: w.name,
    type: w.type,
  }));
}

/** Linear interpolation in a series sorted by distance; outside the series the end values are used. */
export function interpolateAt(series: Array<{ distNm: number; v: number }>, distNm: number): number {
  if (series.length === 0) return 0;
  if (distNm <= series[0].distNm) return series[0].v;
  const last = series[series.length - 1];
  if (distNm >= last.distNm) return last.v;
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].distNm <= distNm) lo = mid;
    else hi = mid;
  }
  const a = series[lo];
  const b = series[hi];
  const span = b.distNm - a.distNm;
  return span <= 0 ? b.v : a.v + ((b.v - a.v) * (distNm - a.distNm)) / span;
}

export function plannedAltAt(plan: GeneratedFlightPlan, distNm: number): number {
  return interpolateAt(
    plan.waypoints.map((w) => ({ distNm: w.cumulativeDistNm, v: w.altFt })),
    distNm
  );
}

export function terrainAt(profile: ProfilePoint[], distNm: number): number | null {
  if (profile.length === 0) return null;
  return interpolateAt(profile.map((p) => ({ distNm: p.distNm, v: p.elevFt })), distNm);
}

const LOW_TYPES = new Set<FlightWaypoint['type']>(['MTR_ENTRY', 'CHECKPOINT', 'IP', 'RANGE', 'DROP', 'EGRESS']);

export interface LowSection {
  fromNm: number;
  toNm: number;
  /** The smallest height of the plan above the terrain in this section (ft). */
  minAglFt: number;
}

/**
 * Stretches of the low-level route where the planned altitude is less than `minAglFt` above the terrain. After the terrain
 * step there are none; they show up when a waypoint was just moved and the altitudes are not recalculated yet, or when the
 * altitudes are estimates. Climbs and descents at the airfields are not low-level legs and are left out.
 */
export function lowSections(plan: GeneratedFlightPlan, terrain: ProfilePoint[], minAglFt = 500): LowSection[] {
  const wps = plan.waypoints;
  const sections: LowSection[] = [];
  let current: LowSection | null = null;

  for (let k = 1; k < wps.length; k++) {
    const a = wps[k - 1];
    const b = wps[k];
    const lowLeg = LOW_TYPES.has(a.type) && LOW_TYPES.has(b.type) && !a.name.startsWith('TNG') && !b.name.startsWith('TNG');
    for (const p of terrain) {
      if (p.distNm < a.cumulativeDistNm || p.distNm > b.cumulativeDistNm) continue;
      const span = b.cumulativeDistNm - a.cumulativeDistNm;
      const planned = span > 0 ? a.altFt + ((b.altFt - a.altFt) * (p.distNm - a.cumulativeDistNm)) / span : b.altFt;
      const agl = planned - p.elevFt;
      if (lowLeg && agl < minAglFt) {
        if (current && p.distNm - current.toNm < 6) {
          current.toNm = p.distNm;
          current.minAglFt = Math.min(current.minAglFt, agl);
        } else {
          current = { fromNm: p.distNm, toNm: p.distNm, minAglFt: agl };
          sections.push(current);
        }
      }
    }
  }
  return sections;
}

/** Where the aircraft is along the route (NM, as in the nav log) for a live reading. */
export function routeDistanceNm(plan: GeneratedFlightPlan, progress: LiveProgress): number {
  const prev = plan.waypoints[progress.legIndex - 1];
  const next = plan.waypoints[progress.legIndex];
  if (!prev || !next) return 0;
  const frac = progress.legNm > 0 ? Math.max(0, Math.min(1, progress.alongNm / progress.legNm)) : 1;
  return prev.cumulativeDistNm + frac * (next.cumulativeDistNm - prev.cumulativeDistNm);
}

export interface ProfileTracePoint {
  distNm: number;
  altFt: number;
}

/** The altitude flown, by distance along the route: a point is added after the aircraft moved `minStepNm` along the route. */
export function appendProfileTrace(
  trace: ProfileTracePoint[],
  point: ProfileTracePoint,
  minStepNm = 0.3,
  maxPoints = 1500
): ProfileTracePoint[] {
  const last = trace[trace.length - 1];
  if (last && Math.abs(point.distNm - last.distNm) < minStepNm) return trace;
  const next = [...trace, point];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}

/** Index of the waypoint nearest to a distance along the route. */
export function nearestWaypointIndex(plan: GeneratedFlightPlan, distNm: number): number {
  let best = 0;
  let bestGap = Infinity;
  plan.waypoints.forEach((w, i) => {
    const gap = Math.abs(w.cumulativeDistNm - distNm);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

/**
 * Tick values for an axis from `min` to `max` (in the display unit), about `count` of them, on round numbers
 * (1, 2, 5 times a power of ten). Returns the ticks and the step.
 */
export function niceTicks(min: number, max: number, count = 4): { ticks: number[]; step: number } {
  const span = Math.max(max - min, 1e-9);
  const raw = span / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, step };
}

/**
 * The height range of a profile chart for the given heights (feet), and the tick values in the display unit.
 * `toDisplay` converts feet to the unit shown (feet or metres). The range starts at sea level or at the lowest terrain
 * rounded down to 500 ft, and ends at the first round tick above the highest value.
 */
export function profileScale(
  heightsFt: number[],
  toDisplay: (ft: number) => number,
  count = 4
): { ticks: number[]; bottomFt: number; topFt: number } {
  const lowestFt = Math.min(0, ...heightsFt);
  const highestFt = Math.max(0, ...heightsFt) * 1.04;
  const { ticks, step } = niceTicks(toDisplay(lowestFt), toDisplay(highestFt), count);
  let top = ticks.length ? ticks[ticks.length - 1] : toDisplay(highestFt);
  if (top < toDisplay(highestFt)) top += step;
  const bottomFt = Math.min(0, Math.floor(lowestFt / 500) * 500);
  const topFt = top / (toDisplay(1) || 1);
  return { ticks, bottomFt, topFt: Math.max(topFt, bottomFt + 1) };
}

/** A waypoint that gets a name under the chart: the ends and the fixes that mark a stage of the sortie. */
export function isLabelledWaypoint(w: FlightWaypoint, index: number, count: number): boolean {
  if (index === 0 || index === count - 1) return true;
  if (/^(CP |TURN)/.test(w.name)) return false;
  return w.type === 'MTR_ENTRY' || w.type === 'IP' || w.type === 'RANGE' || w.type === 'DROP' || w.type === 'EGRESS' || w.type === 'TNG';
}

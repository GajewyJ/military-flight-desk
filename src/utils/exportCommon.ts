import { GeneratedFlightPlan } from '../types/flightDesk';
import { calculateDistanceNm } from './geo';

const LOW_LEVEL_TYPES = ['MTR_ENTRY', 'CHECKPOINT', 'IP', 'EGRESS', 'RANGE', 'DROP'];

/**
 * Cruise altitude (MSL) for plans whose low-level altitudes come from terrain data:
 * the highest low-level waypoint. Returns null for other plans so the caller falls back to
 * parsing assignedAltitude. (assignedAltitude is free text and may contain no number at all.)
 */
export function lowLevelCruiseAltitudeFt(plan: GeneratedFlightPlan): number | null {
  if (!plan.terrainSource) return null;
  const alts = plan.waypoints
    .filter((w) => LOW_LEVEL_TYPES.includes(w.type) && !w.name.startsWith('TNG'))
    .map((w) => w.altFt)
    .filter((a) => Number.isFinite(a));
  return alts.length > 0 ? Math.max(...alts) : null;
}

/** How the exported flight plan files end (the same choice for MSFS 2020, MSFS 2024 and Little Navmap). */
export interface PlanExportOptions {
  /**
   * End the route where it leaves the low-level corridor for the airfield (the egress), before the landing circuit,
   * instead of at the airfield. Default true.
   * These sorties take off and land at the same airfield, so a route that ends with the landing circuit starts and
   * ends in the same place, which confuses the flight tracking of the simulator and Little Navmap (nearest leg, next
   * waypoint and remaining distance cannot tell the take-off from the landing). Ending before the circuit avoids that;
   * the pilot flies the circuit and lands, and the simulator still names the airfield as the destination of the plan.
   */
  endBeforeAirfield?: boolean;
}

/**
 * The last fix of the route must be at least this far (NM) from where the flight starts. The egress, where the route
 * leaves the corridor for the airfield, is 10 to 15 NM out.
 */
export const MIN_FINAL_FIX_NM = 5;

/**
 * Index of the last waypoint of a route that ends before the airfield: the one before the landing circuit (the recovery
 * waypoints: entry, initial, break, downwind, perch, final) and the touchdown and rollout at the end of the plan. That is
 * the egress, where the route leaves the low-level corridor for the airfield. Null when the plan has no such waypoint
 * away from the start, so the route then ends at the airfield as before.
 */
export function finalFixIndex(plan: GeneratedFlightPlan): number | null {
  const w = plan.waypoints;
  let i = w.length - 1;
  while (i > 0 && (w[i].type === 'ARR' || w[i].type === 'RECOVERY')) i--;
  if (i < 2 || i === w.length - 1) return null;
  if (calculateDistanceNm(w[0].lat, w[0].lon, w[i].lat, w[i].lon) < MIN_FINAL_FIX_NM) return null;
  return i;
}

/**
 * Where an exported route ends: `lastIndex` is the last waypoint written, `endsAtAirport` tells if it is the airfield
 * (the old way) or the final fix before it.
 */
export function exportRouteEnd(plan: GeneratedFlightPlan, options?: PlanExportOptions): { lastIndex: number; endsAtAirport: boolean } {
  const fix = options?.endBeforeAirfield === false ? null : finalFixIndex(plan);
  return fix === null ? { lastIndex: plan.waypoints.length - 1, endsAtAirport: true } : { lastIndex: fix, endsAtAirport: false };
}

/** Returns `base`, or `base` with a numeric suffix if it was already used (keeps within maxLen). */
export function uniqueIdent(base: string, used: Set<string>, maxLen: number): string {
  let candidate = base.slice(0, maxLen);
  for (let n = 2; used.has(candidate) && n < 100; n++) {
    const suffix = String(n);
    candidate = base.slice(0, maxLen - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

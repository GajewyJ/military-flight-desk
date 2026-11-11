import { GeneratedFlightPlan } from '../types/flightDesk';

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

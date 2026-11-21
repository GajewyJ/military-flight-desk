import type { FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';
import { calculateBearingDeg, calculateDistanceNm, parseMagDecl, trueToMag } from './geo';

/** A moved waypoint must stay at least this far (NM) from both of its neighbours. */
export const MIN_WAYPOINT_SPACING_NM = 1;

/**
 * Which waypoints can be moved on the map: the low-level corridor fixes (entry, checkpoints, turns, egress, and the IP of a
 * plain low-level route). The home airfield, the runway departure and recovery, the Touch & Go pattern and the training-ground
 * patterns follow runway and range geometry, so they stay where the generator put them.
 */
export function isDraggableWaypoint(plan: GeneratedFlightPlan, index: number): boolean {
  const wp = plan.waypoints[index];
  if (!wp || index === 0 || index === plan.waypoints.length - 1) return false;
  if (wp.name.startsWith('TNG')) return false;
  if (wp.type === 'IP') return plan.missionProfile === 'low_level_mtr';
  return wp.type === 'CHECKPOINT' || wp.type === 'MTR_ENTRY' || wp.type === 'EGRESS';
}

/** Leg to `wp` flown from `prev`: the same rounding the generators use. */
function legTo(prev: FlightWaypoint, wp: FlightWaypoint, magDecl: number) {
  const dist = Math.round(calculateDistanceNm(prev.lat, prev.lon, wp.lat, wp.lon) * 10) / 10;
  const brg = Math.round(calculateBearingDeg(prev.lat, prev.lon, wp.lat, wp.lon));
  return {
    legDistNm: dist,
    bearingTrueDeg: brg,
    bearingMagDeg: trueToMag(brg, magDecl),
    legEteSeconds: Math.round((dist / wp.speedKts) * 3600),
  };
}

/** Corridor remarks that name the heading to the next fix: keep them true after a move. */
function refreshHeadingRemark(wp: FlightWaypoint, next: FlightWaypoint | undefined): FlightWaypoint {
  if (!next || !(wp.name.startsWith('CP ') || wp.name.startsWith('TURN '))) return wp;
  const hdg = Math.round(next.bearingMagDeg) % 360;
  const remarks = wp.remarks.replace(/(onto |corridor, heading )\d{1,3}°M/, `$1${hdg}°M`);
  return remarks === wp.remarks ? wp : { ...wp, remarks };
}

/**
 * Moves one waypoint and recalculates the two legs that touch it, the totals and the headings named in the remarks of
 * the two waypoints in front of the move. Returns null if the waypoint cannot be moved or the new position is closer than
 * MIN_WAYPOINT_SPACING_NM to a neighbour. Altitudes stay as they are until the terrain step runs again.
 */
export function moveWaypoint(
  plan: GeneratedFlightPlan,
  id: string,
  lat: number,
  lon: number
): GeneratedFlightPlan | null {
  const idx = plan.waypoints.findIndex((w) => w.id === id);
  if (idx < 0 || !isDraggableWaypoint(plan, idx)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180) return null;

  const before = plan.waypoints[idx - 1];
  const after = plan.waypoints[idx + 1];
  if (
    calculateDistanceNm(before.lat, before.lon, lat, lon) < MIN_WAYPOINT_SPACING_NM ||
    calculateDistanceNm(after.lat, after.lon, lat, lon) < MIN_WAYPOINT_SPACING_NM
  ) {
    return null;
  }

  const magDecl = parseMagDecl(plan.operatingAirbase.magDecl);
  const moved: FlightWaypoint = { ...plan.waypoints[idx], lat, lon };
  const legIn = legTo(before, moved, magDecl);
  const legOut = legTo(moved, after, magDecl);

  const old = plan.waypoints;
  const dDist = legIn.legDistNm - old[idx].legDistNm + (legOut.legDistNm - after.legDistNm);
  const dTime = legIn.legEteSeconds - old[idx].legEteSeconds + (legOut.legEteSeconds - after.legEteSeconds);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const waypoints: FlightWaypoint[] = old.map((w, i) => {
    if (i === idx) {
      return {
        ...moved,
        ...legIn,
        cumulativeDistNm: round1(w.cumulativeDistNm + (legIn.legDistNm - w.legDistNm)),
        cumulativeTimeSeconds: w.cumulativeTimeSeconds + (legIn.legEteSeconds - w.legEteSeconds),
      };
    }
    if (i === idx + 1) {
      return {
        ...w,
        ...legOut,
        cumulativeDistNm: round1(w.cumulativeDistNm + dDist),
        cumulativeTimeSeconds: w.cumulativeTimeSeconds + dTime,
      };
    }
    if (i > idx + 1) {
      return { ...w, cumulativeDistNm: round1(w.cumulativeDistNm + dDist), cumulativeTimeSeconds: w.cumulativeTimeSeconds + dTime };
    }
    return w;
  });

  waypoints[idx] = refreshHeadingRemark(waypoints[idx], waypoints[idx + 1]);
  if (idx > 1) waypoints[idx - 1] = refreshHeadingRemark(waypoints[idx - 1], waypoints[idx]);

  const last = waypoints[waypoints.length - 1];
  return {
    ...plan,
    waypoints,
    totalDistanceNm: Math.round(last.cumulativeDistNm),
    totalFlightTimeMin: Math.round(last.cumulativeTimeSeconds / 60),
    routeEdited: true,
  };
}

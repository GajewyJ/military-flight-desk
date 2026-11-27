import type { FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';
import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, pointToSegmentDistanceNm, toRad } from './geo';
import { LOW_LEVEL_AGL_FT } from './terrainService';

/**
 * What the live link shows on the map, worked out from the plan and one reading of the aircraft:
 * which leg is being flown, how far off the planned track, and (on low-level legs) whether the radar altitude
 * is where the plan wants it. Pure functions: the plan stays in feet, knots and nautical miles.
 */

const EARTH_RADIUS_NM = 3440.065;

/** A leg counts as flown when the aircraft is this close to its end fix, or past it (NM). */
const ARRIVE_NM = 1.5;
/** The nearest leg is searched again when the aircraft is farther than this from the leg it is on (NM). */
const RESYNC_NM = 10;
/** Further than this from the planned track is "off track" (NM). */
export const OFF_TRACK_NM = 3;

/** Low-level corridor legs: caution below this share of the planned clearance, warning below the second. */
export const LOW_CAUTION_RATIO = 0.8;
export const LOW_WARNING_RATIO = 0.5;
/** More than this above the planned altitude (ft) on a corridor leg is flagged as high. */
export const HIGH_ABOVE_PLAN_FT = 1000;

export type AglState = 'ok' | 'low' | 'critical' | 'none';

export interface LiveProgress {
  /** Index of the waypoint the aircraft is flying to; the leg runs from the waypoint before it. */
  legIndex: number;
  next: FlightWaypoint;
  distToNextNm: number;
  /** Seconds to the next fix at the present ground speed (null when almost standing still). */
  eteToNextSec: number | null;
  /** Distance from the planned track, positive to the right of it. */
  crossTrackNm: number;
  offTrack: boolean;
  /** Distance already flown along the leg, and the leg length (NM). */
  alongNm: number;
  legNm: number;
  /** Altitude (MSL) the plan has at this point of the leg, and how far the aircraft is from it. */
  plannedMslFt: number;
  altDeltaFt: number;
  /** Is the radar altitude watched on this leg? (low-level corridor and range / drop-zone legs, in the air) */
  monitored: boolean;
  /** Height above the ground the plan wants here (null when the leg has none). */
  plannedAglFt: number | null;
  /** The radar altitude below which "low" is shown, and "critical". */
  lowAglFt: number | null;
  criticalAglFt: number | null;
  aglState: AglState;
  /** Corridor legs: flying well above the planned altitude. */
  tooHigh: boolean;
}

interface LegGeometry {
  lenNm: number;
  /** Distance along the leg from its start (negative before the start). */
  alongNm: number;
  /** Distance from the great-circle track of the leg, positive to the right. */
  crossNm: number;
}

/** The aircraft's place relative to the leg from `a` to `b`. */
export function legGeometry(a: FlightWaypoint, b: FlightWaypoint, lat: number, lon: number): LegGeometry {
  const lenNm = calculateDistanceNm(a.lat, a.lon, b.lat, b.lon);
  const d13 = calculateDistanceNm(a.lat, a.lon, lat, lon) / EARTH_RADIUS_NM;
  if (d13 < 1e-9) return { lenNm, alongNm: 0, crossNm: 0 };
  const t13 = toRad(calculateBearingDeg(a.lat, a.lon, lat, lon));
  const t12 = toRad(calculateBearingDeg(a.lat, a.lon, b.lat, b.lon));
  const xt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12))));
  // Along-track: distance from the start to the point nearest the aircraft
  const cosXt = Math.cos(xt);
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / (cosXt || 1)))) * (Math.cos(t13 - t12) < 0 ? -1 : 1);
  return { lenNm, alongNm: at * EARTH_RADIUS_NM, crossNm: xt * EARTH_RADIUS_NM };
}

function passed(a: FlightWaypoint, b: FlightWaypoint, lat: number, lon: number): boolean {
  const g = legGeometry(a, b, lat, lon);
  return g.alongNm >= g.lenNm - 0.3 || calculateDistanceNm(lat, lon, b.lat, b.lon) < ARRIVE_NM;
}

/** What is known about the aircraft when its leg has to be found without knowing the leg before. */
export interface LegHint {
  onGround: boolean;
  headingTrueDeg: number;
}

/** Legs this close (NM) to the nearest one count as equally near. */
const TIE_NM = 1.0;

/**
 * The leg nearest to the aircraft. These sorties start and end at the same airfield, so the first legs (take-off) and the
 * last legs (landing) lie on top of each other: legs about as near as the nearest are told apart by the situation. On the
 * ground the flight is about to start (or has just started), so the earliest of them is taken; in the air the one that
 * runs in the direction the aircraft is heading, and then the nearest.
 */
function nearestLeg(wps: FlightWaypoint[], lat: number, lon: number, hint?: LegHint): number {
  const here = { lat, lon };
  const dist: number[] = [Infinity];
  let min = Infinity;
  for (let i = 1; i < wps.length; i++) {
    const d = pointToSegmentDistanceNm(here, wps[i - 1], wps[i]);
    dist.push(d);
    if (d < min) min = d;
  }
  const near: number[] = [];
  for (let i = 1; i < wps.length; i++) if (dist[i] <= min + TIE_NM) near.push(i);

  if (near.length > 1 && hint) {
    if (hint.onGround) return near[0];
    // Legs shorter than half a mile have no useful direction
    const directed = near.filter((i) => calculateDistanceNm(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon) > 0.5);
    if (directed.length > 0) {
      const gap = (i: number) =>
        Math.abs(angularDiffDeg(hint.headingTrueDeg, calculateBearingDeg(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon)));
      // Among those heading the right way (within 45 degrees) the nearest; if none does, the nearest of all
      const aligned = directed.filter((i) => gap(i) <= 45);
      if (aligned.length > 0) return aligned.reduce((a, b) => (dist[b] < dist[a] ? b : a));
    }
  }
  let best = 1;
  for (let i = 1; i < wps.length; i++) if (dist[i] < dist[best]) best = i;
  return best;
}

/**
 * The leg being flown. With the leg of the previous reading (`prev`) it only moves forward, when the aircraft has
 * passed the end fix, so a route that doubles back near itself is not mixed up. Without it, or when the aircraft is far
 * from that leg (the flight was restarted, or cut across to another part of the route), the nearest leg is taken.
 */
export function trackLeg(wps: FlightWaypoint[], lat: number, lon: number, prev?: number, hint?: LegHint): number {
  const n = wps.length;
  if (prev === undefined || prev < 1 || prev > n - 1) return nearestLeg(wps, lat, lon, hint);
  let i = prev;
  while (i < n - 1 && passed(wps[i - 1], wps[i], lat, lon)) i++;
  const here = { lat, lon };
  if (pointToSegmentDistanceNm(here, wps[i - 1], wps[i]) > RESYNC_NM) {
    const near = nearestLeg(wps, lat, lon, hint);
    if (pointToSegmentDistanceNm(here, wps[near - 1], wps[near]) < pointToSegmentDistanceNm(here, wps[i - 1], wps[i]) - 5) return near;
  }
  return i;
}

/** The planned height above the ground at a fix, read from its altitude text "N ft MSL (M ft AGL)". */
export function plannedAglAt(wp: FlightWaypoint): number | null {
  if (wp.aglFt !== undefined) return wp.aglFt;
  const m = /\(([\d,]+) ft AGL\)/.exec(wp.altDisplay);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const CORRIDOR_FROM = new Set<FlightWaypoint['type']>(['MTR_ENTRY', 'CHECKPOINT', 'IP']);
const CORRIDOR_TO = new Set<FlightWaypoint['type']>(['CHECKPOINT', 'IP']);

/**
 * Progress along the plan for one reading. `prevLegIndex` is the leg of the reading before (see trackLeg).
 * Returns null for a plan without legs.
 */
export function computeProgress(plan: GeneratedFlightPlan, sample: SimSample, prevLegIndex?: number): LiveProgress | null {
  const wps = plan.waypoints;
  if (wps.length < 2) return null;

  const legIndex = trackLeg(wps, sample.lat, sample.lon, prevLegIndex, { onGround: sample.onGround, headingTrueDeg: sample.headingTrueDeg });
  const a = wps[legIndex - 1];
  const b = wps[legIndex];
  const g = legGeometry(a, b, sample.lat, sample.lon);
  // The next leg is taken a little before the fix (see ARRIVE_NM): until the aircraft is past the fix, how far it is from
  // the track is measured against the leg it is still on, so a corner does not show as being off track
  const crossTrackNm =
    g.alongNm < 0 && legIndex >= 2 ? legGeometry(wps[legIndex - 2], a, sample.lat, sample.lon).crossNm : g.crossNm;
  const frac = g.lenNm > 0 ? Math.max(0, Math.min(1, g.alongNm / g.lenNm)) : 1;

  const distToNextNm = calculateDistanceNm(sample.lat, sample.lon, b.lat, b.lon);
  const eteToNextSec = sample.groundSpeedKts >= 30 ? Math.round((distToNextNm / sample.groundSpeedKts) * 3600) : null;

  const plannedMslFt = a.altFt + (b.altFt - a.altFt) * frac;
  const altDeltaFt = sample.altMslFt - plannedMslFt;

  // What is watched on this leg
  const aglA = plannedAglAt(a);
  const aglB = plannedAglAt(b);
  const rangeLeg = (b.type === 'RANGE' || b.type === 'DROP') && b.aglFt !== undefined;
  const corridorLeg = !rangeLeg && CORRIDOR_FROM.has(a.type) && CORRIDOR_TO.has(b.type) && !a.name.startsWith('TNG') && !b.name.startsWith('TNG');

  let monitored = false;
  let plannedAglFt: number | null = null;
  let lowAglFt: number | null = null;
  let criticalAglFt: number | null = null;
  if (!sample.onGround) {
    if (rangeLeg) {
      const from = a.aglFt ?? aglA ?? b.aglFt!;
      plannedAglFt = Math.round(from + (b.aglFt! - from) * frac);
      lowAglFt = Math.max(plannedAglFt * 0.75, plannedAglFt - 200);
      criticalAglFt = lowAglFt * 0.7;
      monitored = true;
    } else if (corridorLeg) {
      plannedAglFt = aglB ?? aglA;
      lowAglFt = LOW_LEVEL_AGL_FT * LOW_CAUTION_RATIO;
      criticalAglFt = LOW_LEVEL_AGL_FT * LOW_WARNING_RATIO;
      monitored = true;
    }
  }

  let aglState: AglState = 'none';
  if (monitored && lowAglFt !== null && criticalAglFt !== null) {
    aglState = sample.aglFt < criticalAglFt ? 'critical' : sample.aglFt < lowAglFt ? 'low' : 'ok';
  }

  return {
    legIndex,
    next: b,
    distToNextNm,
    eteToNextSec,
    crossTrackNm,
    offTrack: Math.abs(crossTrackNm) > OFF_TRACK_NM,
    alongNm: g.alongNm,
    legNm: g.lenNm,
    plannedMslFt,
    altDeltaFt,
    monitored,
    plannedAglFt,
    lowAglFt,
    criticalAglFt,
    aglState,
    tooHigh: monitored && corridorLeg && altDeltaFt > HIGH_ABOVE_PLAN_FT,
  };
}

/** The track the aircraft has flown: a point is added after it has moved `minStepNm`; the oldest points go first. */
export function appendTrail(
  trail: Array<[number, number]>,
  sample: Pick<SimSample, 'lat' | 'lon'>,
  minStepNm = 0.25,
  maxPoints = 1500
): Array<[number, number]> {
  const last = trail[trail.length - 1];
  if (last && calculateDistanceNm(last[0], last[1], sample.lat, sample.lon) < minStepNm) return trail;
  const next = [...trail, [sample.lat, sample.lon] as [number, number]];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}

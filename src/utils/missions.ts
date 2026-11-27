import type { GeneratedFlightPlan } from '../types/flightDesk';

/** The saved missions: the whole plan as it is on screen (hand-moved waypoints included) with a short summary for the list. */

export interface MissionMeta {
  name: string;
  savedAt: number;
  callsign: string;
  missionProfile: string;
  aircraftType: string;
  depIdent: string;
  /** For the list: how long the route is. */
  waypoints: number;
  distanceNm: number;
  timeMin: number;
  edited: boolean;
}

export interface SavedMission {
  schema: 1;
  plan: GeneratedFlightPlan;
}

const PROFILE_NAMES: Record<string, string> = {
  low_level_mtr: 'Low-level route',
  lltr_tng: 'Low-level + Touch & Go',
  range_strafe: 'Range strafe',
  cargo_drop: 'Cargo drop',
};

export function missionProfileName(profile: string): string {
  return PROFILE_NAMES[profile] ?? profile.replace(/_/g, ' ');
}

/** The name offered when a mission is saved, for example "EPLK Low-level route · VIPER 41". */
export function defaultMissionName(plan: GeneratedFlightPlan): string {
  return `${plan.operatingAirbase.ident} ${missionProfileName(plan.missionProfile)} \u00b7 ${plan.callsign}`;
}

export function missionMeta(plan: GeneratedFlightPlan, name: string, now: number = Date.now()): MissionMeta {
  return {
    name: name.trim().slice(0, 80) || defaultMissionName(plan),
    savedAt: now,
    callsign: plan.callsign,
    missionProfile: plan.missionProfile,
    aircraftType: plan.aircraftType,
    depIdent: plan.operatingAirbase.ident,
    waypoints: plan.waypoints.length,
    distanceNm: plan.totalDistanceNm,
    timeMin: plan.totalFlightTimeMin,
    edited: plan.routeEdited === true,
  };
}

export function packMission(plan: GeneratedFlightPlan): SavedMission {
  return { schema: 1, plan };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Is this something the screens can show as a flight plan? A saved file from elsewhere or a future version may not be. */
export function isValidPlan(x: unknown): x is GeneratedFlightPlan {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (!isStr(p.callsign) || !isStr(p.missionProfile) || !isStr(p.sortieId) || !isStr(p.aircraftType)) return false;
  if (!isNum(p.totalDistanceNm) || !isNum(p.totalFlightTimeMin)) return false;
  const ap = p.operatingAirbase as Record<string, unknown> | undefined;
  if (!ap || !isStr(ap.ident) || !isNum(ap.latitude) || !isNum(ap.longitude) || !isStr(ap.magDecl) || !isNum(ap.elevationFt)) return false;
  if (!p.departureWeather || typeof p.departureWeather !== 'object') return false;
  if (!Array.isArray(p.waypoints) || p.waypoints.length < 2) return false;
  return p.waypoints.every((w: unknown) => {
    const q = w as Record<string, unknown>;
    return (
      !!q &&
      isStr(q.id) &&
      isStr(q.name) &&
      isStr(q.type) &&
      isStr(q.altDisplay) &&
      isStr(q.remarks) &&
      isNum(q.lat) &&
      isNum(q.lon) &&
      isNum(q.altFt) &&
      isNum(q.speedKts) &&
      isNum(q.bearingTrueDeg) &&
      isNum(q.bearingMagDeg) &&
      isNum(q.legDistNm) &&
      isNum(q.cumulativeDistNm) &&
      isNum(q.legEteSeconds) &&
      isNum(q.cumulativeTimeSeconds)
    );
  });
}

/** The plan from a saved mission, or null when the file is not a usable mission. */
export function unpackMission(data: unknown): GeneratedFlightPlan | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<SavedMission>;
  return m.schema === 1 && isValidPlan(m.plan) ? m.plan : null;
}

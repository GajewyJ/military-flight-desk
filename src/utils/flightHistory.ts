import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { AglState } from './liveFlight';
import type { RecPoint } from './flightRecorder';
import { computeDebrief } from './debrief';
import { isValidPlan } from './missions';

/**
 * The history of flown flights: each landing saves the plan and the recorded flight. The recorded points are stored
 * as short rows of rounded numbers, so a two-hour flight is well under a megabyte.
 */

export interface FlightMeta {
  savedAt: number;
  /** When the flight started (ms since 1970). */
  startedAt: number;
  callsign: string;
  missionProfile: string;
  depIdent: string;
  airborneSec: number;
  distanceNm: number;
  samples: number;
}

export interface SavedFlight {
  schema: 1;
  plan: GeneratedFlightPlan;
  /** One row per recorded point, see packPoints. */
  rows: number[][];
}

const AGL_CODES: AglState[] = ['ok', 'low', 'critical', 'none'];
const ROW_LENGTH = 13;

const round = (n: number, decimals: number) => {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
};

/** Points as rows: t, lat, lon, alt MSL, radar alt, ground speed, heading, leg, off track, distance, plan alt, radar state, flags. */
export function packPoints(points: RecPoint[]): number[][] {
  return points.map((p) => [
    Math.round(p.t),
    round(p.lat, 5),
    round(p.lon, 5),
    Math.round(p.altMslFt),
    Math.round(p.aglFt),
    Math.round(p.gsKts),
    Math.round(p.headingTrueDeg),
    p.leg,
    round(p.xtkNm, 2),
    round(p.distNm, 2),
    Math.round(p.planMslFt),
    Math.max(0, AGL_CODES.indexOf(p.agl)),
    (p.high ? 1 : 0) | (p.offTrack ? 2 : 0),
  ]);
}

/** The points from stored rows; rows that are not numbers are left out. */
export function unpackPoints(rows: unknown): RecPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: RecPoint[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < ROW_LENGTH || !r.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({
      t: r[0],
      lat: r[1],
      lon: r[2],
      altMslFt: r[3],
      aglFt: r[4],
      gsKts: r[5],
      headingTrueDeg: r[6],
      leg: r[7],
      xtkNm: r[8],
      distNm: r[9],
      planMslFt: r[10],
      agl: AGL_CODES[r[11]] ?? 'none',
      high: (r[12] & 1) !== 0,
      offTrack: (r[12] & 2) !== 0,
    });
  }
  return out;
}

/** The name of a flight in the library: the same flight saved twice has the same name, so it is saved once. */
export function flightId(points: RecPoint[]): string {
  return `f-${Math.round(points[0]?.t ?? 0).toString(36)}`;
}

export function packFlight(plan: GeneratedFlightPlan, points: RecPoint[]): SavedFlight {
  return { schema: 1, plan, rows: packPoints(points) };
}

export function flightMeta(plan: GeneratedFlightPlan, points: RecPoint[], now: number = Date.now()): FlightMeta | null {
  const d = computeDebrief(plan, points);
  if (!d) return null;
  return {
    savedAt: now,
    startedAt: points[0].t,
    callsign: plan.callsign,
    missionProfile: plan.missionProfile,
    depIdent: plan.operatingAirbase.ident,
    airborneSec: Math.round(d.airborneSec),
    distanceNm: Math.round(d.distanceNm * 10) / 10,
    samples: points.length,
  };
}

/** The plan and the points of a stored flight, or null when the file is not a usable flight. */
export function unpackFlight(data: unknown): { plan: GeneratedFlightPlan; points: RecPoint[] } | null {
  if (!data || typeof data !== 'object') return null;
  const f = data as Partial<SavedFlight>;
  if (f.schema !== 1 || !isValidPlan(f.plan)) return null;
  const points = unpackPoints(f.rows);
  return points.length >= 2 ? { plan: f.plan, points } : null;
}

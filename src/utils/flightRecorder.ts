import type { SimSample } from '../types/electronSim';
import type { AglState, LiveProgress } from './liveFlight';
import { routeDistanceNm } from './altitudeProfile';
import type { GeneratedFlightPlan } from '../types/flightDesk';

/**
 * Records the flight from the live link for the debrief: one point a second while the aircraft is in the air, with
 * where it is on the plan and how it did against it. The flight starts at take-off and ends when the aircraft has
 * stopped on the ground (a touch-and-go does not end it).
 */

export interface RecPoint {
  /** Time of the reading (ms since 1970). */
  t: number;
  lat: number;
  lon: number;
  altMslFt: number;
  /** Radar altitude (ft). */
  aglFt: number;
  gsKts: number;
  headingTrueDeg: number;
  /** The plan leg flown (index of the waypoint flown to). */
  leg: number;
  /** Distance from the planned track, positive to the right (NM). */
  xtkNm: number;
  /** Distance along the route, as in the nav log (NM). */
  distNm: number;
  /** The planned altitude here (ft MSL). */
  planMslFt: number;
  /** Radar check on this leg: 'none' when the leg is not watched. */
  agl: AglState;
  high: boolean;
  offTrack: boolean;
}

export type FlightPhase = 'idle' | 'airborne' | 'landed';

/** Stopped on the ground this long (ms) at under this speed (kt) is a landing. */
export const LANDING_HOLD_MS = 5000;
export const LANDING_MAX_GS_KTS = 40;
const MAX_POINTS = 14400;

export interface FlightRecorder {
  /** Takes one reading. Reports the phase and whether this reading ended the flight. */
  feed: (plan: GeneratedFlightPlan, sample: SimSample, progress: LiveProgress | null) => { phase: FlightPhase; justLanded: boolean };
  points: () => RecPoint[];
  phase: () => FlightPhase;
  reset: () => void;
}

export function createFlightRecorder(): FlightRecorder {
  let phase: FlightPhase = 'idle';
  let points: RecPoint[] = [];
  let stoppedSince: number | null = null;

  return {
    feed(plan, sample, progress) {
      const stopped = sample.onGround && sample.groundSpeedKts < LANDING_MAX_GS_KTS;

      if (phase === 'airborne') {
        if (stopped) {
          stoppedSince = stoppedSince ?? sample.t;
          if (sample.t - stoppedSince >= LANDING_HOLD_MS) {
            phase = 'landed';
            return { phase, justLanded: true };
          }
        } else {
          stoppedSince = null;
        }
      } else if (!sample.onGround) {
        // Take-off (or the start of a flight already in the air): a new flight, so a new recording
        phase = 'airborne';
        points = [];
        stoppedSince = null;
      }

      if (phase === 'airborne' && !sample.onGround && progress && points.length < MAX_POINTS) {
        const last = points[points.length - 1];
        if (!last || sample.t - last.t >= 900) {
          points.push({
            t: sample.t,
            lat: sample.lat,
            lon: sample.lon,
            altMslFt: sample.altMslFt,
            aglFt: sample.aglFt,
            gsKts: sample.groundSpeedKts,
            headingTrueDeg: sample.headingTrueDeg,
            leg: progress.legIndex,
            xtkNm: progress.crossTrackNm,
            distNm: routeDistanceNm(plan, progress),
            planMslFt: progress.plannedMslFt,
            agl: progress.aglState,
            high: progress.tooHigh,
            offTrack: progress.offTrack,
          });
        }
      }
      return { phase, justLanded: false };
    },
    points: () => points,
    phase: () => phase,
    reset() {
      phase = 'idle';
      points = [];
      stoppedSince = null;
    },
  };
}

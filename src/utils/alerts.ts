import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';
import { angularDiffDeg } from './geo';
import { isLabelledWaypoint } from './altitudeProfile';
import type { AglState, LiveProgress } from './liveFlight';

/**
 * The spoken alerts of the live link. `nextAlerts` decides, for one reading of the aircraft, what to say: it speaks when
 * something changes (a state is entered) and repeats a warning at a calm pace while it lasts, so the voice does not
 * chatter. Pure: the speaking itself is in speech.ts.
 */

export type AlertKind = 'critical' | 'low' | 'off_track' | 'back_on_track' | 'high' | 'waypoint';

export interface Alert {
  kind: AlertKind;
  text: string;
  /** 3 urgent (too low), 2 warning, 1 information. A more urgent alert interrupts a less urgent one that is being spoken. */
  priority: 1 | 2 | 3;
}

export interface AlertState {
  aglState: AglState;
  offTrack: boolean;
  high: boolean;
  /** The leg of the previous reading; waypoints are announced when it moves on. */
  leg: number | undefined;
  /** When each kind of alert was last spoken (ms). */
  last: Partial<Record<AlertKind, number>>;
}

export function initialAlertState(): AlertState {
  return { aglState: 'none', offTrack: false, high: false, leg: undefined, last: {} };
}

/** Distances and heights as they are spoken, in the units chosen in Settings. */
export interface SpeechFormat {
  dist: (nm: number) => string;
  alt: (ft: number) => string;
}

/** How long a warning that is still going on waits before it is spoken again (ms). */
export const REPEAT_MS = { critical: 8000, low: 20000, off_track: 30000, high: 30000 } as const;
/** A turn at a waypoint is announced from this size on (degrees). */
export const ANNOUNCE_TURN_DEG = 25;

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A heading as a pilot says it: 270 is "two seven zero". */
export function spellHeading(deg: number): string {
  const h = String(((Math.round(deg) % 360) + 360) % 360).padStart(3, '0');
  return h
    .split('')
    .map((c) => DIGITS[Number(c)])
    .join(' ');
}

/** A waypoint name that a speech voice reads properly: abbreviations spelled out, airfield codes letter by letter. */
export function speakableName(name: string): string {
  const spelled = (s: string) => s.split('').join(' ');
  return name
    .split(' ')
    .map((word) => {
      if (word === 'LLTR') return 'low level';
      // Airfield codes (EPLK) and abbreviations (IP, RTB, DZ) letter by letter
      if (/^[A-Z]{4}$/.test(word) || ['IP', 'RTB', 'DZ', 'TNG', 'TGT', 'MTR'].includes(word)) return spelled(word);
      return word.toLowerCase();
    })
    .join(' ');
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** What to say for one reading, and the state to pass to the next call. */
export function nextAlerts(
  state: AlertState,
  ctx: { plan: GeneratedFlightPlan; sample: SimSample; progress: LiveProgress | null; nowMs: number; say: SpeechFormat }
): { state: AlertState; alerts: Alert[] } {
  const { plan, sample, progress, nowMs, say } = ctx;
  const alerts: Alert[] = [];
  const last = { ...state.last };
  const due = (kind: keyof typeof REPEAT_MS, entered: boolean) => entered || nowMs - (last[kind] ?? 0) >= REPEAT_MS[kind];

  // Nothing is said on the ground, or without a plan leg under the aircraft
  if (!progress || sample.onGround) {
    return { state: { ...state, aglState: 'none', offTrack: false, high: false, leg: progress?.legIndex ?? state.leg, last }, alerts };
  }

  // Height above the ground
  if (progress.aglState === 'critical' && due('critical', state.aglState !== 'critical')) {
    alerts.push({ kind: 'critical', text: 'Too low. Pull up.', priority: 3 });
    last.critical = nowMs;
  } else if (progress.aglState === 'low' && state.aglState !== 'critical' && due('low', state.aglState !== 'low')) {
    alerts.push({ kind: 'low', text: `Low altitude, ${say.alt(roundTo(sample.aglFt, 100))}`, priority: 2 });
    last.low = nowMs;
  }

  // Off the planned track
  if (progress.offTrack) {
    if (due('off_track', !state.offTrack)) {
      const side = progress.crossTrackNm >= 0 ? 'right' : 'left';
      alerts.push({ kind: 'off_track', text: `Off track, ${say.dist(Math.abs(progress.crossTrackNm))} ${side}`, priority: 2 });
      last.off_track = nowMs;
    }
  } else if (state.offTrack) {
    alerts.push({ kind: 'back_on_track', text: 'Back on track', priority: 1 });
  }

  // Well above the planned altitude
  if (progress.tooHigh && due('high', !state.high)) {
    alerts.push({ kind: 'high', text: `High, ${say.alt(roundTo(progress.altDeltaFt, 100))} above plan`, priority: 1 });
    last.high = nowMs;
  }

  // A waypoint passed: its name if it is a main fix, and the turn if the route bends there
  if (state.leg !== undefined && progress.legIndex > state.leg) {
    const wps = plan.waypoints;
    const passedIdx = progress.legIndex - 1;
    const passed = wps[passedIdx];
    const next = wps[progress.legIndex];
    const parts: string[] = [];
    if (passed && isLabelledWaypoint(passed, passedIdx, wps.length)) parts.push(speakableName(passed.name));
    if (passed && next) {
      const turn = angularDiffDeg(passed.bearingTrueDeg, next.bearingTrueDeg);
      if (passedIdx > 0 && Math.abs(turn) >= ANNOUNCE_TURN_DEG) {
        parts.push(`turn ${turn > 0 ? 'right' : 'left'}, heading ${spellHeading(next.bearingMagDeg)}`);
      }
    }
    if (parts.length > 0) alerts.push({ kind: 'waypoint', text: parts.join(', '), priority: 1 });
  }

  return {
    state: {
      aglState: progress.aglState,
      offTrack: progress.offTrack,
      high: progress.tooHigh,
      leg: progress.legIndex,
      last,
    },
    alerts,
  };
}

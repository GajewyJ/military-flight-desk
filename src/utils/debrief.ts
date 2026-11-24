import type { GeneratedFlightPlan } from '../types/flightDesk';
import { calculateDistanceNm } from './geo';
import type { RecPoint } from './flightRecorder';

/** Gaps between readings longer than this (s) are a paused simulator, not time flown. */
const MAX_STEP_S = 5;

export interface LegStat {
  /** Index of the waypoint flown to; the leg starts at the waypoint before it. */
  index: number;
  from: string;
  to: string;
  flown: boolean;
  /** Time on the leg (s), planned time (s). */
  seconds: number;
  plannedSeconds: number;
  /** Average and largest distance from the planned track on the leg (NM). */
  avgXtkNm: number;
  maxXtkNm: number;
  avgGsKts: number;
}

export interface Debrief {
  /** Readings recorded, and whether there is enough for a debrief. */
  samples: number;
  airborneSec: number;
  plannedSec: number;
  distanceNm: number;
  plannedNm: number;
  avgGsKts: number;
  maxGsKts: number;
  maxAltFt: number;
  /** Lowest radar altitude of the flight. */
  minAglFt: number;
  /** Legs of the plan that were flown, and how many there are. */
  legsFlown: number;
  legsTotal: number;
  /** The radar-checked part of the flight (low-level and range legs). */
  checked: {
    seconds: number;
    lowSec: number;
    criticalSec: number;
    highSec: number;
    /** Lowest radar altitude while it was checked (null if no leg was checked). */
    minAglFt: number | null;
  };
  deviation: { avgXtkNm: number; maxXtkNm: number; offTrackSec: number };
  legs: LegStat[];
}

/** The debrief of a recorded flight against its plan. Null if nothing was recorded. */
export function computeDebrief(plan: GeneratedFlightPlan, points: RecPoint[]): Debrief | null {
  if (points.length < 2 || plan.waypoints.length < 2) return null;
  const wps = plan.waypoints;

  // Seconds each reading stands for: up to the next one
  const dt = points.map((p, i) => {
    if (i === points.length - 1) return 0;
    return Math.min(MAX_STEP_S, Math.max(0, (points[i + 1].t - p.t) / 1000));
  });

  let airborneSec = 0;
  let distanceNm = 0;
  let gsSum = 0;
  let maxGs = 0;
  let maxAlt = -Infinity;
  let minAgl = Infinity;
  let xtkSum = 0;
  let xtkMax = 0;
  let offTrackSec = 0;
  const checked = { seconds: 0, lowSec: 0, criticalSec: 0, highSec: 0, minAglFt: null as number | null };

  const perLeg = new Map<number, { sec: number; xtk: number; xtkMax: number; gs: number; n: number }>();

  points.forEach((p, i) => {
    const step = dt[i];
    airborneSec += step;
    if (i > 0) {
      const prev = points[i - 1];
      const d = calculateDistanceNm(prev.lat, prev.lon, p.lat, p.lon);
      if (points[i].t - prev.t <= MAX_STEP_S * 1000 * 4) distanceNm += d;
    }
    gsSum += p.gsKts * step;
    maxGs = Math.max(maxGs, p.gsKts);
    maxAlt = Math.max(maxAlt, p.altMslFt);
    minAgl = Math.min(minAgl, p.aglFt);
    const ax = Math.abs(p.xtkNm);
    xtkSum += ax * step;
    xtkMax = Math.max(xtkMax, ax);
    if (p.offTrack) offTrackSec += step;

    if (p.agl !== 'none') {
      checked.seconds += step;
      if (p.agl === 'low') checked.lowSec += step;
      if (p.agl === 'critical') checked.criticalSec += step;
      if (p.high) checked.highSec += step;
      checked.minAglFt = checked.minAglFt === null ? p.aglFt : Math.min(checked.minAglFt, p.aglFt);
    }

    const l = perLeg.get(p.leg) ?? { sec: 0, xtk: 0, xtkMax: 0, gs: 0, n: 0 };
    l.sec += step;
    l.xtk += ax * step;
    l.xtkMax = Math.max(l.xtkMax, ax);
    l.gs += p.gsKts * step;
    l.n += 1;
    perLeg.set(p.leg, l);
  });

  const legs: LegStat[] = [];
  for (let i = 1; i < wps.length; i++) {
    const l = perLeg.get(i);
    const flown = !!l && l.n >= 2 && l.sec > 0;
    legs.push({
      index: i,
      from: wps[i - 1].name,
      to: wps[i].name,
      flown,
      seconds: flown ? l!.sec : 0,
      plannedSeconds: wps[i].legEteSeconds,
      avgXtkNm: flown ? l!.xtk / l!.sec : 0,
      maxXtkNm: flown ? l!.xtkMax : 0,
      avgGsKts: flown ? l!.gs / l!.sec : 0,
    });
  }

  const lastWp = wps[wps.length - 1];
  return {
    samples: points.length,
    airborneSec,
    plannedSec: lastWp.cumulativeTimeSeconds,
    distanceNm,
    plannedNm: lastWp.cumulativeDistNm,
    avgGsKts: airborneSec > 0 ? gsSum / airborneSec : 0,
    maxGsKts: maxGs,
    maxAltFt: maxAlt,
    minAglFt: minAgl,
    legsFlown: legs.filter((l) => l.flown).length,
    legsTotal: legs.length,
    checked,
    deviation: { avgXtkNm: airborneSec > 0 ? xtkSum / airborneSec : 0, maxXtkNm: xtkMax, offTrackSec },
    legs,
  };
}

import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { findTrainingGround } from '../data/trainingGrounds';
import {
  appendTrail,
  computeProgress,
  legGeometry,
  plannedAglAt,
  trackLeg,
  type LiveProgress,
} from '../utils/liveFlight';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

const sample = (lat: number, lon: number, over: Partial<SimSample> = {}): SimSample => ({
  lat, lon, altMslFt: 3000, aglFt: 1600, headingTrueDeg: 0, groundSpeedKts: 450, iasKts: 450,
  vsFpm: 0, onGround: false, t: 0, ...over,
});

/** Points along the plan, every `stepNm`, shifted `offsetNm` to the right of the track (negative: left). */
function flyAlong(plan: GeneratedFlightPlan, stepNm: number, offsetNm = 0): Array<{ lat: number; lon: number; leg: number }> {
  const out: Array<{ lat: number; lon: number; leg: number }> = [];
  const w = plan.waypoints;
  for (let i = 1; i < w.length; i++) {
    const len = calculateDistanceNm(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    const brg = calculateBearingDeg(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    for (let d = 0; d < len; d += stepNm) {
      let p = destinationPoint(w[i - 1].lat, w[i - 1].lon, d, brg);
      if (offsetNm !== 0) p = destinationPoint(p.lat, p.lon, Math.abs(offsetNm), (brg + (offsetNm > 0 ? 90 : 270)) % 360);
      out.push({ ...p, leg: i });
    }
  }
  return out;
}

const lowLevel = (cls: 'fighter_jet' | 'cargo' = 'fighter_jet') =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk), undefined, cls);

describe('legGeometry', () => {
  const mk = (lat: number, lon: number): FlightWaypoint =>
    ({ lat, lon, altFt: 0 }) as unknown as FlightWaypoint;
  const a = mk(50, 19);
  const b = mk(51, 19); // 60 NM due north

  it('gives the distance along the leg and the side of the track', () => {
    const right = legGeometry(a, b, 50.5, 19.05); // east of a northbound track: right
    expect(right.crossNm).toBeGreaterThan(1.5);
    expect(right.crossNm).toBeLessThan(2.5);
    expect(right.alongNm).toBeGreaterThan(29);
    expect(right.alongNm).toBeLessThan(31);
    expect(legGeometry(a, b, 50.5, 18.95).crossNm).toBeLessThan(-1.5);
    expect(legGeometry(a, b, 49.9, 19).alongNm).toBeLessThan(0); // before the start
    expect(legGeometry(a, b, 51.2, 19).alongNm).toBeGreaterThan(legGeometry(a, b, 51.2, 19).lenNm);
  });
});

describe('computeProgress', () => {
  for (const cls of ['fighter_jet', 'cargo'] as const) {
    it(`${cls}: follows the plan leg by leg, never going back, and reaches the end`, () => {
      const plan = lowLevel(cls);
      let prev: number | undefined;
      const seen = new Set<number>();
      for (const pt of flyAlong(plan, 0.4)) {
        const p = computeProgress(plan, sample(pt.lat, pt.lon), prev) as LiveProgress;
        if (prev !== undefined) expect(p.legIndex).toBeGreaterThanOrEqual(prev);
        prev = p.legIndex;
        seen.add(p.legIndex);
        // The next leg is taken 1.5 NM before the fix, so at a sharp turn the offset to it can be up to about that much
        expect(Math.abs(p.crossTrackNm)).toBeLessThan(1.6);
      }
      expect(prev).toBe(plan.waypoints.length - 1);
      // Every leg was recognised at some point
      expect(seen.size).toBeGreaterThanOrEqual(plan.waypoints.length - 3);
    });
  }

  it('shows the side and size of the offset from the track', () => {
    const plan = lowLevel();
    const i = plan.waypoints.findIndex((w) => w.name.startsWith('CP ') && w.legDistNm > 12);
    const pts = flyAlong(plan, 1).filter((p) => p.leg === i);
    const mid = pts[Math.floor(pts.length / 2)];
    const right = computeProgress(plan, sample(...(Object.values(destinationPoint(mid.lat, mid.lon, 2, (calculateBearingDeg(plan.waypoints[i - 1].lat, plan.waypoints[i - 1].lon, plan.waypoints[i].lat, plan.waypoints[i].lon) + 90) % 360)) as [number, number])), i) as LiveProgress;
    expect(right.crossTrackNm).toBeGreaterThan(1.5);
    expect(right.offTrack).toBe(false);
    const far = computeProgress(plan, sample(...(Object.values(destinationPoint(mid.lat, mid.lon, 5, (calculateBearingDeg(plan.waypoints[i - 1].lat, plan.waypoints[i - 1].lon, plan.waypoints[i].lat, plan.waypoints[i].lon) + 270) % 360)) as [number, number])), i) as LiveProgress;
    expect(far.crossTrackNm).toBeLessThan(-4);
    expect(far.offTrack).toBe(true);
  });

  it('gives the time to the next fix from the ground speed, and nothing when standing still', () => {
    const plan = lowLevel();
    const w = plan.waypoints;
    const here = destinationPoint(w[2].lat, w[2].lon, 10, (calculateBearingDeg(w[2].lat, w[2].lon, w[1].lat, w[1].lon)));
    const p = computeProgress(plan, sample(here.lat, here.lon, { groundSpeedKts: 300 })) as LiveProgress;
    expect(p.eteToNextSec).not.toBe(null);
    expect(computeProgress(plan, sample(here.lat, here.lon, { groundSpeedKts: 5 }))!.eteToNextSec).toBe(null);
  });

  it('finds the nearest leg again when the flight is restarted far from where it was', () => {
    const plan = lowLevel();
    const pts = flyAlong(plan, 1);
    const midRoute = pts[Math.floor(pts.length * 0.55)];
    const p = computeProgress(plan, sample(midRoute.lat, midRoute.lon), 2) as LiveProgress;
    expect(p.legIndex).toBe(midRoute.leg);
    expect(trackLeg(plan.waypoints, pts[3].lat, pts[3].lon)).toBeLessThanOrEqual(3);
  });

  describe('low-level monitor', () => {
    const plan = lowLevel();
    const w = plan.waypoints;
    const entry = w.findIndex((x) => x.name === 'LLTR ENTRY');
    // Middle of a leg between two corridor checkpoints
    const k = w.findIndex((x, i) => i > entry + 1 && x.type === 'CHECKPOINT' && w[i - 1].type === 'CHECKPOINT');
    const a = w[k - 1];
    const b = w[k];
    const mid = destinationPoint(a.lat, a.lon, calculateDistanceNm(a.lat, a.lon, b.lat, b.lon) / 2, calculateBearingDeg(a.lat, a.lon, b.lat, b.lon));
    const at = (over: Partial<SimSample>) => computeProgress(plan, sample(mid.lat, mid.lon, over), k) as LiveProgress;

    it('watches corridor legs: ok, low and critical by radar altitude', () => {
      expect(at({ aglFt: 1600 }).monitored).toBe(true);
      expect(at({ aglFt: 1600 }).aglState).toBe('ok');
      expect(at({ aglFt: 1100 }).aglState).toBe('low');
      expect(at({ aglFt: 600 }).aglState).toBe('critical');
    });

    it('flags flying well above the planned altitude, and does not watch on the ground', () => {
      const planned = at({}).plannedMslFt;
      expect(at({ altMslFt: planned + 1500 }).tooHigh).toBe(true);
      expect(at({ altMslFt: planned + 200 }).tooHigh).toBe(false);
      const parked = at({ onGround: true, aglFt: 0 });
      expect(parked.monitored).toBe(false);
      expect(parked.aglState).toBe('none');
    });

    it('does not watch the climb-out after take-off', () => {
      const dep = computeProgress(plan, sample(w[1].lat, w[1].lon), 1) as LiveProgress;
      expect(dep.monitored).toBe(false);
    });

    it('reads the planned height above the ground from the waypoint', () => {
      expect(plannedAglAt({ ...b, aglFt: 700 })).toBe(700);
      expect(plannedAglAt({ ...b, aglFt: undefined, altDisplay: '3,200 ft MSL (1,650 ft AGL)' })).toBe(1650);
      expect(plannedAglAt({ ...b, aglFt: undefined, altDisplay: '3,200 ft MSL' })).toBe(null);
    });
  });

  it('watches the passes of a range sortie against their planned height', () => {
    const ground = findTrainingGround('nowa-deba')!;
    const plan = generateMilitaryFlightPlan(eplk, 'range_strafe', 'short', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet', ground);
    const w = plan.waypoints;
    const k = w.findIndex((x) => x.name === 'TARGET 1');
    const a = w[k - 1];
    const b = w[k];
    const mid = destinationPoint(a.lat, a.lon, calculateDistanceNm(a.lat, a.lon, b.lat, b.lon) / 2, calculateBearingDeg(a.lat, a.lon, b.lat, b.lon));
    const ref = computeProgress(plan, sample(mid.lat, mid.lon, { aglFt: 500 }), k) as LiveProgress;
    expect(ref.monitored).toBe(true);
    expect(ref.plannedAglFt).not.toBe(null);
    const planned = ref.plannedAglFt as number;
    expect(computeProgress(plan, sample(mid.lat, mid.lon, { aglFt: planned }), k)!.aglState).toBe('ok');
    expect(computeProgress(plan, sample(mid.lat, mid.lon, { aglFt: planned * 0.3 }), k)!.aglState).toBe('critical');
  });
});

describe('appendTrail', () => {
  it('adds a point only after the aircraft moved, and keeps the newest points', () => {
    let t: Array<[number, number]> = [];
    t = appendTrail(t, { lat: 51, lon: 19 });
    t = appendTrail(t, { lat: 51.0001, lon: 19 });
    expect(t.length).toBe(1);
    t = appendTrail(t, { lat: 51.1, lon: 19 });
    expect(t.length).toBe(2);
    for (let i = 0; i < 30; i++) t = appendTrail(t, { lat: 52 + i * 0.1, lon: 19 }, 0.25, 10);
    expect(t.length).toBe(10);
    expect(t[t.length - 1][0]).toBeCloseTo(54.9, 5);
  });
});

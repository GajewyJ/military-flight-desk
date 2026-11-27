import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { fetchTerrainProfile } from '../utils/terrainService';
import {
  appendProfileTrace,
  interpolateAt,
  isLabelledWaypoint,
  lowSections,
  nearestWaypointIndex,
  niceTicks,
  plannedAltAt,
  plannedSeries,
  profileScale,
  routeDistanceNm,
  terrainAt,
  type ProfilePoint,
} from '../utils/altitudeProfile';
import { computeProgress } from '../utils/liveFlight';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const lowLevel = (): GeneratedFlightPlan =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet');

describe('interpolateAt', () => {
  const s = [
    { distNm: 0, v: 100 },
    { distNm: 10, v: 200 },
    { distNm: 30, v: 0 },
  ];
  it('is linear between points and flat outside them', () => {
    expect(interpolateAt(s, 5)).toBe(150);
    expect(interpolateAt(s, 20)).toBe(100);
    expect(interpolateAt(s, -4)).toBe(100);
    expect(interpolateAt(s, 99)).toBe(0);
    expect(interpolateAt([], 3)).toBe(0);
  });
});

describe('plan series', () => {
  it('has one planned altitude per waypoint, on the nav log distance', () => {
    const plan = lowLevel();
    const series = plannedSeries(plan);
    expect(series.length).toBe(plan.waypoints.length);
    expect(series[0].distNm).toBe(0);
    expect(series[series.length - 1].distNm).toBe(plan.waypoints[plan.waypoints.length - 1].cumulativeDistNm);
    const mid = Math.floor(series.length / 2);
    expect(plannedAltAt(plan, series[mid].distNm)).toBeCloseTo(series[mid].altFt, 5);
    expect(nearestWaypointIndex(plan, series[mid].distNm + 0.2)).toBe(mid);
  });

  it('names the ends and the main fixes, not the checkpoints and turns', () => {
    const plan = lowLevel();
    const w = plan.waypoints;
    expect(isLabelledWaypoint(w[0], 0, w.length)).toBe(true);
    expect(isLabelledWaypoint(w[w.length - 1], w.length - 1, w.length)).toBe(true);
    const cp = w.findIndex((x) => x.name.startsWith('CP ') || x.name.startsWith('TURN'));
    expect(isLabelledWaypoint(w[cp], cp, w.length)).toBe(false);
    const ip = w.findIndex((x) => x.type === 'IP');
    expect(isLabelledWaypoint(w[ip], ip, w.length)).toBe(true);
  });
});

describe('lowSections', () => {
  it('finds nothing when the plan is above the terrain, and the stretch where it is not', () => {
    const plan = lowLevel();
    const w = plan.waypoints;
    // A long leg between two low-level fixes
    const a = w.findIndex((x, i) => x.type === 'CHECKPOINT' && i + 1 < w.length && (w[i + 1].type === 'CHECKPOINT' || w[i + 1].type === 'IP') && w[i + 1].legDistNm > 10);
    expect(a).toBeGreaterThan(0);
    const from = w[a].cumulativeDistNm;
    const to = w[a + 1].cumulativeDistNm;
    // Terrain 1,500 ft under every waypoint's planned altitude, everywhere
    const safe: ProfilePoint[] = [];
    for (let d = 0; d <= w[w.length - 1].cumulativeDistNm; d += 2) safe.push({ distNm: d, elevFt: plannedAltAt(plan, d) - 1500 });
    expect(lowSections(plan, safe)).toEqual([]);

    // A hill that rises to 100 ft under the plan on one low-level leg
    const hill = safe.map((p) => (p.distNm >= from + 2 && p.distNm <= to - 2 ? { ...p, elevFt: plannedAltAt(plan, p.distNm) - 100 } : p));
    const found = lowSections(plan, hill);
    expect(found.length).toBe(1);
    expect(found[0].minAglFt).toBeLessThan(500);
    expect(found[0].fromNm).toBeGreaterThanOrEqual(from);
    expect(found[0].toNm).toBeLessThanOrEqual(to);
  });

  it('does not count the take-off and the landing, where the plan meets the ground', () => {
    const plan = lowLevel();
    const ground: ProfilePoint[] = [];
    for (let d = 0; d <= plan.waypoints[plan.waypoints.length - 1].cumulativeDistNm; d += 2) ground.push({ distNm: d, elevFt: plannedAltAt(plan, d) });
    // The plan is exactly on the ground everywhere: only the low-level legs may be reported
    const sections = lowSections(plan, ground);
    const w = plan.waypoints;
    const firstLow = w.findIndex((x) => x.name === 'LLTR ENTRY');
    for (const s of sections) expect(s.fromNm).toBeGreaterThanOrEqual(w[firstLow].cumulativeDistNm);
  });
});

describe('terrainAt', () => {
  it('reads the terrain at a distance', () => {
    const t: ProfilePoint[] = [{ distNm: 0, elevFt: 300 }, { distNm: 10, elevFt: 500 }];
    expect(terrainAt(t, 5)).toBe(400);
    expect(terrainAt([], 5)).toBe(null);
  });
});

describe('niceTicks', () => {
  it('gives round values inside the range', () => {
    const { ticks, step } = niceTicks(0, 4800, 4);
    expect(step).toBe(1000);
    expect(ticks).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(niceTicks(0, 1500, 4).ticks).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(0, 1500 * 0.3048, 4).step).toBeGreaterThan(0);
    for (const t of niceTicks(0, 987, 5).ticks) expect(t % 100).toBe(0);
  });
});

describe('aircraft on the profile', () => {
  it('puts the aircraft at its distance along the route', () => {
    const plan = lowLevel();
    const w = plan.waypoints;
    const k = w.findIndex((x, i) => i > 3 && x.type === 'CHECKPOINT');
    const a = w[k - 1];
    const b = w[k];
    const half = calculateDistanceNm(a.lat, a.lon, b.lat, b.lon) / 2;
    const p = destinationPoint(a.lat, a.lon, half, calculateBearingDeg(a.lat, a.lon, b.lat, b.lon));
    const sample: SimSample = {
      lat: p.lat, lon: p.lon, altMslFt: 3000, aglFt: 1500, headingTrueDeg: 0, groundSpeedKts: 450, iasKts: 450, vsFpm: 0, onGround: false, t: 0,
    };
    const progress = computeProgress(plan, sample, k)!;
    const d = routeDistanceNm(plan, progress);
    expect(d).toBeGreaterThan(a.cumulativeDistNm);
    expect(d).toBeLessThan(b.cumulativeDistNm);
    expect(d).toBeCloseTo((a.cumulativeDistNm + b.cumulativeDistNm) / 2, 0);
  });

  it('keeps the altitude flown, thinned out, and the newest points', () => {
    let t = appendProfileTrace([], { distNm: 0, altFt: 100 });
    t = appendProfileTrace(t, { distNm: 0.1, altFt: 120 });
    expect(t.length).toBe(1);
    t = appendProfileTrace(t, { distNm: 1, altFt: 150 });
    expect(t.length).toBe(2);
    for (let i = 0; i < 30; i++) t = appendProfileTrace(t, { distNm: 2 + i, altFt: 100 }, 0.3, 10);
    expect(t.length).toBe(10);
    expect(t[t.length - 1].distNm).toBe(31);
  });
});

describe('fetchTerrainProfile', () => {
  it('samples the whole route on the nav log distance and returns the elevations', async () => {
    const calls: number[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url);
      const lats = q.searchParams.get('latitude')!.split(',').map(Number);
      calls.push(lats.length);
      return { ok: true, status: 200, json: async () => ({ elevation: lats.map((la) => la * 3) }) };
    });
    const plan = lowLevel();
    const profile = await fetchTerrainProfile(plan);
    expect(profile).not.toBe(null);
    const pts = profile as ProfilePoint[];
    expect(pts.length).toBeGreaterThan(20);
    expect(pts[0].distNm).toBe(0);
    expect(pts[pts.length - 1].distNm).toBe(plan.waypoints[plan.waypoints.length - 1].cumulativeDistNm);
    for (let i = 1; i < pts.length; i++) expect(pts[i].distNm).toBeGreaterThanOrEqual(pts[i - 1].distNm);
    // Requests of at most 100 points each
    for (const n of calls) expect(n).toBeLessThanOrEqual(100);
  });

  it('gives null when the terrain data cannot be fetched', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const plan = lowLevel();
    const p = await fetchTerrainProfile({ ...plan, waypoints: plan.waypoints.slice(0, 4) });
    expect(p).toBe(null);
  });
});

describe('profileScale', () => {
  it('covers the highest value with a round top, and starts at sea level', () => {
    const s = profileScale([500, 3400, 1200], (ft) => ft, 4);
    expect(s.bottomFt).toBe(0);
    expect(s.topFt).toBeGreaterThanOrEqual(3400);
    expect(s.topFt).toBeLessThan(5000);
    expect(s.ticks[0]).toBe(0);
    // The ticks are round numbers
    for (const t of s.ticks) expect(t % 500).toBe(0);
  });

  it('goes below sea level for terrain under it, in steps of 500 ft', () => {
    const s = profileScale([-380, 2000], (ft) => ft, 4);
    expect(s.bottomFt).toBe(-500);
    expect(s.topFt).toBeGreaterThanOrEqual(2000);
  });

  it('works in metres: ticks in metres, the range still in feet', () => {
    const toM = (ft: number) => ft * 0.3048;
    const s = profileScale([0, 3000], toM, 4);
    // 3,000 ft is 914 m: the chart reaches above it, and the ticks are in metres inside the range
    expect(s.topFt).toBeGreaterThanOrEqual(3000);
    for (const t of s.ticks) expect(t / 0.3048).toBeLessThanOrEqual(s.topFt + 1e-6);
    for (const t of s.ticks) expect(t % 100).toBe(0);
  });

  it('copes with nothing above zero', () => {
    const s = profileScale([0, 0], (ft) => ft, 4);
    expect(s.topFt).toBeGreaterThan(s.bottomFt);
  });
});

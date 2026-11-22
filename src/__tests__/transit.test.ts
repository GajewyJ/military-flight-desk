import { describe, it, expect } from 'vitest';
import { shapedTransit, transitFixes, type TransitShape } from '../utils/trainingGeometry';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { TRAINING_GROUNDS } from '../data/trainingGrounds';
import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, destinationPoint, pointToPolylineDistanceNm } from '../utils/geo';
import type { Airport, FlightWaypoint } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const home = { lat: eplk.latitude, lon: eplk.longitude };

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('shapedTransit', () => {
  const from = home;
  const to = destinationPoint(home.lat, home.lon, 110, 140);

  it('ends at the target, keeps its turns inside the limit and uses every outline', () => {
    const rng = seeded(11);
    const shapes = new Set<TransitShape>();
    for (let i = 0; i < 200; i++) {
      const t = shapedTransit(from, to, { legNm: 20, maxLateralNm: 4, maxTurnDeg: 65 }, rng);
      shapes.add(t.shape);
      expect(t.fixes[t.fixes.length - 1]).toEqual(to);
      const pts = [from, ...t.fixes];
      for (let k = 1; k < pts.length - 1; k++) {
        const a = calculateBearingDeg(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon);
        const b = calculateBearingDeg(pts[k].lat, pts[k].lon, pts[k + 1].lat, pts[k + 1].lon);
        expect(Math.abs(angularDiffDeg(a, b))).toBeLessThanOrEqual(65 + 1e-6);
      }
    }
    expect(shapes.size).toBe(4);
  });

  it('keeps a short transit straight', () => {
    const near = destinationPoint(from.lat, from.lon, 25, 90);
    expect(shapedTransit(from, near, { legNm: 20, maxLateralNm: 4 }, seeded(1)).shape).toBe('direct');
  });

  it('keeps clear of an earlier track and never flies straight back along it', () => {
    const earlier = [from, ...transitFixes(from, to, 20, 0)];
    const rng = seeded(5);
    for (let i = 0; i < 60; i++) {
      const t = shapedTransit(to, from, { legNm: 45, maxLateralNm: 0, avoid: earlier, minSepNm: 6 }, rng);
      if (t.shape === 'direct') continue; // the fallback when nothing fits
      for (const p of [to, ...t.fixes]) {
        const nearEnd = calculateDistanceNm(p.lat, p.lon, from.lat, from.lon) < 20 || calculateDistanceNm(p.lat, p.lon, to.lat, to.lon) < 20;
        if (!nearEnd) expect(pointToPolylineDistanceNm(p, earlier)).toBeGreaterThanOrEqual(6 - 1e-6);
      }
    }
  });

  it('arrives within the allowed angle of the wanted heading', () => {
    const rng = seeded(9);
    const want = 150;
    for (let i = 0; i < 80; i++) {
      const t = shapedTransit(from, to, { legNm: 20, maxLateralNm: 4, endBrg: want, maxEndTurnDeg: 30 }, rng);
      if (t.shape === 'direct') continue;
      const pts = [from, ...t.fixes];
      const last = calculateBearingDeg(pts[pts.length - 2].lat, pts[pts.length - 2].lon, to.lat, to.lon);
      expect(Math.abs(angularDiffDeg(last, want))).toBeLessThanOrEqual(30 + 1e-6);
    }
  });
});

describe('range, drop and Touch & Go routes no longer go straight back', () => {
  const between = (wps: FlightWaypoint[], from: (w: FlightWaypoint) => boolean, to: (w: FlightWaypoint) => boolean) => {
    const a = wps.findIndex(from);
    const b = wps.findIndex((w, i) => i > a && to(w));
    return wps.slice(a, b + 1);
  };

  for (const [label, profile, cls, startName, endName] of [
    ['range', 'range_strafe', 'fighter_jet', 'RANGE EXIT', 'RTB EGRESS'],
    ['cargo drop', 'cargo_drop', 'cargo', 'DZ DEPARTURE', 'RTB EGRESS'],
  ] as const) {
    it(`${label}: the return is on a different track from the way out`, () => {
      let apart = 0;
      let total = 0;
      for (const ground of TRAINING_GROUNDS.slice(0, 6)) {
        for (let i = 0; i < 6; i++) {
          let plan;
          try {
            plan = generateMilitaryFlightPlan(eplk, profile, 'medium', undefined, getNeutralWeather(eplk), undefined, cls, ground);
          } catch {
            continue; // ground out of reach of this field
          }
          const wps = plan.waypoints;
          const out = between(wps, (w) => w.name === 'LLTR ENTRY', (w) => w.type === 'IP');
          const back = between(wps, (w) => w.name === startName, (w) => w.name === endName);
          const mid = back.filter(
            (w) =>
              calculateDistanceNm(w.lat, w.lon, home.lat, home.lon) > 25 &&
              calculateDistanceNm(w.lat, w.lon, ground.lat, ground.lon) > 25
          );
          if (mid.length === 0) continue;
          total++;
          if (Math.min(...mid.map((w) => pointToPolylineDistanceNm(w, out))) >= 4) apart++;
        }
      }
      expect(total).toBeGreaterThan(10);
      expect(apart / total).toBeGreaterThan(0.75);
    });
  }
});

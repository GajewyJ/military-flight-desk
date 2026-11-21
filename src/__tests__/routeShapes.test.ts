import { describe, it, expect } from 'vitest';
import { buildCorridor, ROUTE_SHAPE_LABELS, type CorridorLimits } from '../utils/routeShapes';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, destinationPoint, pointToPolylineDistanceNm } from '../utils/geo';
import type { Airport, FlightWaypoint, RouteShapeId } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const epwa: Airport = {
  ident: 'EPWA', icao: 'EPWA', name: 'Warsaw Chopin', elevationFt: 361,
  magDecl: '6.0° East', longestRunwayFt: 12467, latitude: 52.1657, longitude: 20.9671, military: false,
};

const FIGHTER: CorridorLimits = {
  maxStepDeg: 60, cornerRadiusNm: 6, legNm: 21, wiggle: [0.08, 0.14],
  minFinalDistNm: 22, maxFinalDistNm: 38, maxFinalTurnDeg: 65, homeClearNm: 12, separationNm: 6, pathGapNm: 45,
};
const CARGO: CorridorLimits = {
  maxStepDeg: 50, cornerRadiusNm: 8, legNm: 14, wiggle: [0.05, 0.1],
  minFinalDistNm: 22, maxFinalDistNm: 38, maxFinalTurnDeg: 55, homeClearNm: 14, separationNm: 8, pathGapNm: 40,
};

/** Small seeded random generator, so a failing run can be repeated. */
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

describe('buildCorridor', () => {
  const rng = seeded(42);
  const shapesSeen = new Set<RouteShapeId>();

  for (const [name, limits, lengths, entryNm] of [
    ['fighter', FIGHTER, [80, 185, 310], 16],
    ['cargo', CARGO, [58, 126, 208], 12],
  ] as const) {
    it(`${name}: every route ends 22-38 NM from the field, heading home, with turns inside the limit`, () => {
      for (const lat of [0, 35, 51.5, 62]) {
        for (const lengthNm of lengths) {
          for (let heading = 0; heading < 360; heading += 30) {
            const home = { lat, lon: 19 };
            const entry = destinationPoint(home.lat, home.lon, entryNm, heading);
            const c = buildCorridor({ home, entry, entryHeadingDeg: heading, lengthNm, limits }, rng);
            shapesSeen.add(c.shape);

            const pts = [entry, ...c.points.map((p) => p.pos)];
            const ip = pts[pts.length - 1];
            expect(c.points[c.points.length - 1].kind).toBe('ip');
            const ipDist = calculateDistanceNm(ip.lat, ip.lon, home.lat, home.lon);
            expect(ipDist).toBeGreaterThanOrEqual(22);
            expect(ipDist).toBeLessThanOrEqual(38);

            const brg = (a: typeof ip, b: typeof ip) => calculateBearingDeg(a.lat, a.lon, b.lat, b.lon);
            // Heading home at the IP (the limit is relaxed by up to 10° when the strict search fails)
            expect(Math.abs(angularDiffDeg(brg(pts[pts.length - 2], ip), brg(ip, home)))).toBeLessThanOrEqual(limits.maxFinalTurnDeg + 10);
            for (let i = 1; i < pts.length - 1; i++) {
              expect(Math.abs(angularDiffDeg(brg(pts[i - 1], pts[i]), brg(pts[i], pts[i + 1])))).toBeLessThanOrEqual(limits.maxStepDeg);
            }
            // Length close to what was asked for
            expect(c.lengthNm).toBeGreaterThan(lengthNm * 0.55);
            expect(c.lengthNm).toBeLessThan(lengthNm * 1.45);
          }
        }
      }
    });
  }

  it('flies more than one outline (triangle, L-shape, box, loop, four-leg circuit)', () => {
    expect(shapesSeen.size).toBe(5);
    for (const id of shapesSeen) expect(ROUTE_SHAPE_LABELS[id].length).toBeGreaterThan(0);
  });

  it('never crosses itself or runs back along its own track', () => {
    const r = seeded(7);
    for (let run = 0; run < 150; run++) {
      const limits = run % 2 ? CARGO : FIGHTER;
      const home = { lat: 50, lon: 10 };
      const heading = Math.floor(r() * 360);
      const entry = destinationPoint(home.lat, home.lon, 14, heading);
      const c = buildCorridor({ home, entry, entryHeadingDeg: heading, lengthNm: run % 3 ? 185 : 80, limits }, r);
      const pts = [entry, ...c.points.map((p) => p.pos)];
      // Distance along the track to every point
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + calculateDistanceNm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 3; j < pts.length; j++) {
          // Points that are 60 NM or more apart along the track are never close together in the air
          if (cum[j] - cum[i] < 60) continue;
          const d = pointToPolylineDistanceNm(pts[i], [pts[j - 1], pts[j]]);
          expect(d).toBeGreaterThan(2.5);
        }
      }
    }
  });
});

describe('low-level plans use the new outlines', () => {
  const corridorOf = (wps: FlightWaypoint[]) => {
    const a = wps.findIndex((w) => w.name === 'LLTR ENTRY');
    const b = wps.findIndex((w) => w.name === 'IP FOXTROT');
    return wps.slice(a, b + 1);
  };

  for (const cls of ['fighter_jet', 'cargo'] as const) {
    it(`${cls}: a route shape is set, named in the sector text, and the route never goes out and back`, () => {
      const seen = new Set<string>();
      for (const airport of [eplk, epwa]) {
        for (const duration of ['short', 'medium', 'long'] as const) {
          for (let run = 0; run < 12; run++) {
            const p = generateMilitaryFlightPlan(airport, 'low_level_mtr', duration, undefined, getNeutralWeather(airport), undefined, cls);
            expect(p.routeShape).toBeDefined();
            seen.add(p.routeShape as string);
            expect(p.sectorDescription).toContain(ROUTE_SHAPE_LABELS[p.routeShape as RouteShapeId]);

            const corridor = corridorOf(p.waypoints);
            expect(corridor.length).toBeGreaterThan(4);
            expect(corridor[corridor.length - 1].type).toBe('IP');
            // No leg flies close beside an earlier leg that is far back along the track
            for (let i = 0; i < corridor.length; i++) {
              for (let j = i + 3; j < corridor.length; j++) {
                if (corridor[j].cumulativeDistNm - corridor[i].cumulativeDistNm < 60) continue;
                const d = pointToPolylineDistanceNm(corridor[i], [corridor[j - 1], corridor[j]]);
                expect(d).toBeGreaterThan(2.5);
              }
            }
          }
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(4);
    });
  }
});

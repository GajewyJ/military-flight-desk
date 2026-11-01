import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { applyTerrainAgl } from '../utils/terrainService';
import { generateMsfs2020PlnXml } from '../utils/msfsExporter';
import { generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import { angularDiffDeg, calculateDistanceNm } from '../utils/geo';
import type { Airport, AirportWeather, GeneratedFlightPlan, SortieDuration } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const etar: Airport = {
  ident: 'ETAR', icao: 'ETAR', name: 'Ramstein Air Base', elevationFt: 776,
  magDecl: '2.1° East', longestRunwayFt: 10498, latitude: 49.4369, longitude: 7.6003, military: true,
};

function weatherWithRunway(airport: Airport, headingDeg: number): AirportWeather {
  return {
    ...getNeutralWeather(airport),
    activeRunway: `RWY ${String(Math.round(headingDeg / 10) || 36).padStart(2, '0')}`,
    activeRunwayHeadingDeg: headingDeg,
    activeRunwayTrueHeadingDeg: headingDeg,
  };
}

function cargoPlan(airport: Airport, rwyHeading: number, duration: SortieDuration = 'medium'): GeneratedFlightPlan {
  return generateMilitaryFlightPlan(
    airport, 'low_level_mtr', duration, undefined, weatherWithRunway(airport, rwyHeading), undefined, 'cargo'
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cargo low-level route', () => {
  it('is a Cargo plan that starts at DEP and ends at ARR on the home field', () => {
    for (const duration of ['short', 'medium', 'long'] as const) {
      const p = cargoPlan(eplk, 100, duration);
      expect(p.aircraftType).toBe('Cargo');
      expect(p.waypoints[0].type).toBe('DEP');
      const last = p.waypoints[p.waypoints.length - 1];
      expect(last.type).toBe('ARR');
      expect(calculateDistanceNm(last.lat, last.lon, eplk.latitude, eplk.longitude)).toBeLessThanOrEqual(3);
    }
  });

  it('only has the plain low-level profile', () => {
    expect(() =>
      generateMilitaryFlightPlan(eplk, 'lltr_tng', 'medium', etar, getNeutralWeather(eplk), undefined, 'cargo')
    ).toThrow();
  });

  it('flies slower than a fighter on the same sortie', () => {
    const t = cargoPlan(eplk, 100);
    const f = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, weatherWithRunway(eplk, 100));
    const maxT = Math.max(...t.waypoints.map((w) => w.speedKts));
    const maxF = Math.max(...f.waypoints.map((w) => w.speedKts));
    expect(maxT).toBeLessThanOrEqual(260);
    expect(maxF).toBeGreaterThan(maxT);
  });

  it('lines up with the active runway on short final, for every runway direction', () => {
    for (let hdg = 0; hdg < 360; hdg += 30) {
      for (let run = 0; run < 3; run++) {
        const p = cargoPlan(eplk, hdg);
        const i = p.waypoints.findIndex((w) => w.name.startsWith('SHORT FINAL'));
        expect(i).toBeGreaterThan(0);
        expect(Math.abs(angularDiffDeg(p.waypoints[i].bearingTrueDeg, hdg))).toBeLessThanOrEqual(12);
      }
    }
  });

  it('never needs a sharp turn between the egress and the recovery fixes', () => {
    for (let hdg = 0; hdg < 360; hdg += 45) {
      for (let run = 0; run < 5; run++) {
        const p = cargoPlan(eplk, hdg);
        const w = p.waypoints;
        const start = w.findIndex((x) => x.name === 'LLTR EGRESS');
        expect(start).toBeGreaterThan(0);
        for (let k = start; k < w.length - 1; k++) {
          // pattern fixes are standard 90° turns; everything before them is limited
          if (/^(BASE|DOWNWIND|FINAL|SHORT FINAL|PATTERN ENTRY|IAF)/.test(w[k].name)) break;
          expect(Math.abs(angularDiffDeg(w[k].bearingTrueDeg, w[k + 1].bearingTrueDeg))).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('has unique user waypoint idents in the MSFS and Little Navmap exports', () => {
    for (let i = 0; i < 10; i++) {
      const p = cargoPlan(etar, (i * 40) % 360);
      const msfs = [...generateMsfs2020PlnXml(p).matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);
      expect(new Set(msfs).size).toBe(msfs.length);
      const lnm = [...generateLittleNavmapXml(p).matchAll(/<Ident>([^<]*)<\/Ident>\s*<Type>USER/g)].map((m) => m[1]);
      expect(new Set(lnm).size).toBe(lnm.length);
    }
  });

  it('gets terrain-based altitudes like the fighter profile', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url);
      const lats = q.searchParams.get('latitude')!.split(',').map(Number);
      return { ok: true, status: 200, json: async () => ({ elevation: lats.map(() => 300) }) };
    });
    const out = await applyTerrainAgl(cargoPlan(eplk, 100));
    expect(out.terrainSource).toBe('DEM');
  });
});

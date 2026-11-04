import { describe, it, expect } from "vitest";
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { generateMsfs2020PlnXml, generateMsfs2024PlnXml } from '../utils/msfsExporter';
import { generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import { angularDiffDeg, destinationPoint } from '../utils/geo';
import { CARGO_PROFILE } from '../utils/cargoRoute';
import type { Airport, AirportWeather, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const epks: Airport = {
  ident: 'EPKS', icao: 'EPKS', name: 'Krzesiny', elevationFt: 279,
  magDecl: '4.8° East', longestRunwayFt: 8202, latitude: 52.3317, longitude: 16.9664, military: true,
};
const epwa: Airport = {
  ident: 'EPWA', icao: 'EPWA', name: 'Warsaw Chopin', elevationFt: 361,
  magDecl: '6.0° East', longestRunwayFt: 12467, latitude: 52.1657, longitude: 20.9671, military: false,
};

function weatherWithRunway(airport: Airport, headingDeg: number): AirportWeather {
  return {
    ...getNeutralWeather(airport),
    activeRunway: `RWY ${String(Math.round(headingDeg / 10) || 36).padStart(2, '0')}`,
    activeRunwayHeadingDeg: headingDeg,
    activeRunwayTrueHeadingDeg: headingDeg,
  };
}

function cargoTng(dep: Airport, tng: Airport, tngRunwayHeading?: number): GeneratedFlightPlan {
  const tngWeather = tngRunwayHeading === undefined ? getNeutralWeather(tng) : weatherWithRunway(tng, tngRunwayHeading);
  return generateMilitaryFlightPlan(dep, 'lltr_tng', 'medium', tng, getNeutralWeather(dep), tngWeather, 'cargo');
}

describe('cargo Touch & Go', () => {
  it('is a Cargo LLTR + Touch & Go plan from DEP to ARR on the home field', () => {
    const p = cargoTng(eplk, epks);
    expect(p.aircraftType).toBe('Cargo');
    expect(p.missionProfile).toBe('lltr_tng');
    expect(p.tngAirbase?.ident).toBe('EPKS');
    expect(p.operatingAirbase.ident).toBe('EPLK');
    expect(p.recoveryType).toBe('visual_pattern');
    expect(p.waypoints[0].type).toBe('DEP');
    expect(p.waypoints[p.waypoints.length - 1].type).toBe('ARR');
    expect(p.waypoints.filter((w) => w.type === 'TNG').length).toBe(1);
    expect(p.squawk).toMatch(/^[4-6][0-7]{3}$/);
  });

  it('flies cargo speeds and never an overhead break', () => {
    for (let i = 0; i < 20; i++) {
      const p = cargoTng(eplk, i % 2 === 0 ? epks : epwa);
      for (const w of p.waypoints) {
        expect(w.speedKts).toBeLessThanOrEqual(250);
        expect(w.name).not.toContain('BREAK');
        expect(w.name).not.toContain('OVERHEAD');
      }
      const tng = p.waypoints.find((w) => w.type === 'TNG')!;
      expect(tng.speedKts).toBe(120);
      const shortFinal = p.waypoints.find((w) => w.name === 'TNG SHORT FINAL')!;
      expect(shortFinal.speedKts).toBe(130);
      expect(p.cruiseSpeedKts).toBe(250);
    }
  });

  it('joins at 1,500 ft AGL by a 10 NM straight-in or a wide pattern, with a 3 NM final', () => {
    for (let i = 0; i < 30; i++) {
      const p = cargoTng(eplk, epks, [0, 90, 180, 270][i % 4] || 360);
      const entry = p.waypoints.find((w) => w.name === 'TNG IP' || w.name === 'TNG PATTERN ENTRY')!;
      expect(entry.altFt).toBe(epks.elevationFt + 1500);
      const final = p.waypoints.find((w) => w.name === 'TNG FINAL')!;
      expect(final.altFt).toBe(epks.elevationFt + 1000);
      expect(final.speedKts).toBe(145);
    }
  });

  it('lines up with the runway on final and flies the climb-out on the centerline, for every runway direction', () => {
    for (const heading of [360, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
      const p = cargoTng(eplk, epwa, heading);
      const idx = p.waypoints.findIndex((w) => w.name === 'TNG SHORT FINAL');
      expect(idx).toBeGreaterThan(0);
      const shortFinalToTouchdown = p.waypoints[idx + 1].bearingTrueDeg;
      const touchdownToClimbout = p.waypoints[idx + 2].bearingTrueDeg;
      expect(Math.abs(angularDiffDeg(heading, shortFinalToTouchdown))).toBeLessThan(5);
      expect(Math.abs(angularDiffDeg(heading, touchdownToClimbout))).toBeLessThan(5);
    }
  });

  it('keeps corridor turns gentle and never sharper than a pattern corner', () => {
    for (let i = 0; i < 25; i++) {
      const p = cargoTng(eplk, i % 2 === 0 ? epks : epwa);
      const w = p.waypoints;
      for (let k = 1; k < w.length - 1; k++) {
        const turn = Math.abs(angularDiffDeg(w[k].bearingTrueDeg, w[k + 1].bearingTrueDeg));
        if (w[k].name.startsWith('TNG')) expect(turn).toBeLessThanOrEqual(115);
        else if (['CHECKPOINT', 'IP', 'EGRESS', 'MTR_ENTRY'].includes(w[k].type)) {
          expect(turn).toBeLessThanOrEqual(CARGO_PROFILE.tngMaxCorridorTurnDeg + 15);
        }
      }
    }
  });

  it('builds a route for every bearing and runway direction beyond the minimum distance', () => {
    for (const distNm of [42, 70]) {
      for (let bearing = 0; bearing < 360; bearing += 45) {
        const pos = destinationPoint(eplk.latitude, eplk.longitude, distNm, bearing);
        const tng: Airport = { ...epks, ident: 'TEST', icao: 'TEST', latitude: pos.lat, longitude: pos.lon };
        for (const heading of [360, 60, 120, 180, 240, 300]) {
          expect(() => cargoTng(eplk, tng, heading), `${distNm} NM, bearing ${bearing}, runway ${heading}`).not.toThrow();
        }
      }
    }
  }, 120000);

  it('refuses a field closer than the minimum distance', () => {
    const pos = destinationPoint(eplk.latitude, eplk.longitude, CARGO_PROFILE.minTngDistanceNm - 5, 90);
    const near: Airport = { ...epks, ident: 'NEAR', icao: 'NEAR', latitude: pos.lat, longitude: pos.lon };
    expect(() => cargoTng(eplk, near)).toThrow('CARGO_TNG_TOO_CLOSE');
  });

  it('refuses a short runway but accepts an unknown runway length', () => {
    const short: Airport = { ...epks, ident: 'SHRT', icao: 'SHRT', longestRunwayFt: CARGO_PROFILE.minTngRunwayFt - 500 };
    expect(() => cargoTng(eplk, short)).toThrow('CARGO_TNG_RUNWAY_TOO_SHORT');
    const unknown: Airport = { ...epks, ident: 'UNKN', icao: 'UNKN', longestRunwayFt: undefined };
    expect(() => cargoTng(eplk, unknown)).not.toThrow();
  });

  it('exports with unique idents in the MSFS 2020, MSFS 2024 and Little Navmap files', () => {
    for (let i = 0; i < 5; i++) {
      const p = cargoTng(eplk, epks);
      const x20 = [...generateMsfs2020PlnXml(p).matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);
      const x24 = [...generateMsfs2024PlnXml(p).matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);
      expect(new Set(x20).size).toBe(x20.length);
      expect(x24).toEqual(x20);
      expect(x20).toContain('TNG');
      const lnm = [...generateLittleNavmapXml(p).matchAll(/<Ident>([^<]*)<\/Ident>\s*<Type>USER/g)].map((m) => m[1]);
      expect(new Set(lnm).size).toBe(lnm.length);
    }
  });
});

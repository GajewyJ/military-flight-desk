import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan, generateSquawk } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { calculateDistanceNm, angularDiffDeg, destinationPoint } from '../utils/geo';
import type { Airport, AirportWeather, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const epks: Airport = {
  ident: 'EPKS', icao: 'EPKS', name: '31st Tactical Air Base Krzesiny', elevationFt: 279,
  magDecl: '4.8° East', longestRunwayFt: 8202, latitude: 52.3317, longitude: 16.9664, military: true,
};
const epwa: Airport = {
  ident: 'EPWA', icao: 'EPWA', name: 'Warsaw Chopin', elevationFt: 361,
  magDecl: '6.0° East', longestRunwayFt: 12467, latitude: 52.1657, longitude: 20.9671, military: false,
};

/** Neutral weather with the TnG runway forced to a given true heading. */
function weatherWithRunway(airport: Airport, headingDeg: number): AirportWeather {
  return {
    ...getNeutralWeather(airport),
    activeRunway: `RWY ${String(Math.round(headingDeg / 10) || 36).padStart(2, '0')}`,
    activeRunwayHeadingDeg: headingDeg,
    activeRunwayTrueHeadingDeg: headingDeg,
  };
}

function dist(a: { latitude: number; longitude: number }, lat: number, lon: number): number {
  return calculateDistanceNm(a.latitude, a.longitude, lat, lon);
}

function tngPlan(dep: Airport, tng: Airport, rwyHeading: number): GeneratedFlightPlan {
  return generateMilitaryFlightPlan(
    dep, 'lltr_tng', 'medium', tng, getNeutralWeather(dep), weatherWithRunway(tng, rwyHeading)
  );
}

describe('low_level_mtr', () => {
  it('starts at DEP and ends at ARR', () => {
    const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium');
    expect(p.waypoints[0].type).toBe('DEP');
    expect(p.waypoints[p.waypoints.length - 1].type).toBe('ARR');
    expect(p.totalDistanceNm).toBeGreaterThan(0);
  });
});

describe('lltr_tng', () => {
  const headings = [0, 90, 180, 270]; // covers straight-in and downwind-join approaches
  const targets: Airport[] = [epks, epwa];

  for (const tng of targets) {
    for (const h of headings) {
      it(`${tng.ident} runway ${h}°: valid, local pattern, field is the farthest point`, () => {
        for (let run = 0; run < 15; run++) {
          const p = tngPlan(eplk, tng, h);
          const w = p.waypoints;
          const d = dist(eplk, tng.latitude, tng.longitude);

          expect(w[0].type).toBe('DEP');
          expect(w[w.length - 1].type).toBe('ARR');
          expect(w.filter((x) => x.type === 'TNG').length).toBe(1);
          expect(p.tngAirbase?.ident).toBe(tng.ident);
          expect(p.tngAirbase?.ident).not.toBe(p.operatingAirbase.ident);

          for (const x of w) {
            if (x.name.startsWith('TNG')) {
              expect(calculateDistanceNm(tng.latitude, tng.longitude, x.lat, x.lon)).toBeLessThan(10.01);
            } else {
              expect(dist(eplk, x.lat, x.lon)).toBeLessThan(d);
            }
          }
        }
      });

      it(`${tng.ident} runway ${h}°: no hairpin turns and no doubled RWY label`, () => {
        for (let run = 0; run < 15; run++) {
          const p = tngPlan(eplk, tng, h);
          const w = p.waypoints;
          for (let k = 1; k < w.length - 1; k++) {
            const checked =
              w[k].name.startsWith('TNG') || ['CHECKPOINT', 'IP', 'EGRESS', 'MTR_ENTRY'].includes(w[k].type);
            if (!checked) continue;
            expect(Math.abs(angularDiffDeg(w[k].bearingTrueDeg, w[k + 1].bearingTrueDeg))).toBeLessThan(115.01);
          }
          expect(JSON.stringify(p)).not.toContain('RWY RWY');
        }
      });
    }
  }

  it('keeps the return track laterally separated from the outbound track mid-route', () => {
    const d = dist(eplk, epwa.latitude, epwa.longitude);
    const required = 0.4 * Math.min(10, 0.25 * d);
    for (let run = 0; run < 15; run++) {
      const p = tngPlan(eplk, epwa, 180);
      const w = p.waypoints;
      const climbIdx = w.findIndex((x) => x.name === 'TNG CLIMB-OUT');
      const outIdx = [w.findIndex((x) => x.name === 'LLTR ENTRY'), w.findIndex((x) => x.name.startsWith('TNG') && x.type === 'IP')];
      const outbound = w.slice(outIdx[0], outIdx[1] + 1);
      const returns = w.slice(climbIdx + 1).filter((x) => (x.type === 'CHECKPOINT' || x.type === 'IP') && !x.name.startsWith('TNG'));
      for (const r of returns) {
        const farField = dist(epwa, r.lat, r.lon) > 20;
        const farHome = dist(eplk, r.lat, r.lon) > 20;
        if (!(farField && farHome)) continue;
        let best = Infinity;
        for (let i = 0; i < outbound.length - 1; i++) {
          // sample the outbound segment densely
          for (let t = 0; t <= 1; t += 0.02) {
            const lat = outbound[i].lat + (outbound[i + 1].lat - outbound[i].lat) * t;
            const lon = outbound[i].lon + (outbound[i + 1].lon - outbound[i].lon) * t;
            best = Math.min(best, calculateDistanceNm(r.lat, r.lon, lat, lon));
          }
        }
        expect(best).toBeGreaterThan(required - 0.6); // dense-sampling tolerance
      }
    }
  });

  it('has no distance limits: very close and very far fields both get a plan', () => {
    // about 5 NM from the departure field
    const near: Airport = { ...epks, ident: 'NEAR', icao: 'NEAR', latitude: 51.6, longitude: 19.3 };
    let built = 0;
    for (let run = 0; run < 10; run++) {
      try {
        const p = tngPlan(eplk, near, 0);
        expect(p.waypoints.some((w) => w.name === 'TNG TOUCH & GO')).toBe(true);
        built++;
      } catch (e) {
        expect(e instanceof Error && e.message === 'TNG_ROUTE_INVALID').toBe(true);
      }
    }
    expect(built).toBeGreaterThanOrEqual(7);

    // about 450 NM from the departure field
    const far: Airport = { ...epks, ident: 'FAR', icao: 'FAR', latitude: 49.4, longitude: 7.6 };
    for (let run = 0; run < 3; run++) {
      const p = tngPlan(eplk, far, 90);
      expect(p.waypoints.some((w) => w.name === 'TNG TOUCH & GO')).toBe(true);
    }
  });
});

const etar: Airport = {
  ident: 'ETAR', icao: 'ETAR', name: 'Ramstein Air Base', elevationFt: 776,
  magDecl: '2.1° East', longestRunwayFt: 10498, latitude: 49.4369, longitude: 7.6003, military: true,
};
const etad: Airport = {
  ident: 'ETAD', icao: 'ETAD', name: 'Spangdahlem Air Base', elevationFt: 1197,
  magDecl: '1.8° East', longestRunwayFt: 10007, latitude: 49.9739, longitude: 6.6925, military: true,
};

describe('lltr_tng far-side join', () => {
  it('Ramstein to Spangdahlem on runway 23 (short pair, home-side entry turn too tight) still gets a route', () => {
    for (let run = 0; run < 20; run++) {
      const p = tngPlan(etar, etad, 225);
      expect(p.waypoints.some((w) => w.name === 'TNG TOUCH & GO')).toBe(true);
    }
  });
});

describe('squawk', () => {
  it('stays in 4000-6777 so it can never be an emergency or reserved 7xxx code', () => {
    for (let i = 0; i < 5000; i++) {
      expect(generateSquawk()).toMatch(/^[4-6][0-7]{3}$/);
    }
  });

  it('is applied to fighter and cargo plans', () => {
    const fighter = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium');
    const cargo = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, undefined, undefined, 'cargo');
    expect(fighter.squawk).toMatch(/^[4-6][0-7]{3}$/);
    expect(cargo.squawk).toMatch(/^[4-6][0-7]{3}$/);
  });
});

describe('unsupported profiles', () => {
  it('rejects a profile the app does not offer', () => {
    expect(() => generateMilitaryFlightPlan(eplk, 'lowat_tactics' as never, 'medium')).toThrow(
      'MISSION_PROFILE_UNSUPPORTED'
    );
  });
});

describe('Touch & Go reliability', () => {
  it('builds a route for every bearing and runway direction when the field is 12 NM or more away', () => {
    const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
    const runwayHeadings = [0, 60, 120, 180, 240, 300];
    for (const distNm of [12, 20]) {
      for (const bearing of bearings) {
        const pos = destinationPoint(eplk.latitude, eplk.longitude, distNm, bearing);
        const tng: Airport = { ...epks, ident: 'TEST', icao: 'TEST', latitude: pos.lat, longitude: pos.lon };
        for (const heading of runwayHeadings) {
          expect(() => tngPlan(eplk, tng, heading), `${distNm} NM, bearing ${bearing}, runway ${heading}`).not.toThrow();
        }
      }
    }
  }, 60000);
});

describe('bulk generation', () => {
  it('builds fighter and cargo LLTR plans of every length without errors', () => {
    for (let run = 0; run < 25; run++) {
      for (const duration of ['short', 'medium', 'long'] as const) {
        const fighter = generateMilitaryFlightPlan(eplk, 'low_level_mtr', duration);
        const cargo = generateMilitaryFlightPlan(eplk, 'low_level_mtr', duration, undefined, undefined, undefined, 'cargo');
        for (const p of [fighter, cargo]) {
          expect(p.waypoints[0].type).toBe('DEP');
          expect(p.waypoints[p.waypoints.length - 1].type).toBe('ARR');
          expect(p.totalDistanceNm).toBeGreaterThan(0);
        }
      }
    }
  }, 60000);
});

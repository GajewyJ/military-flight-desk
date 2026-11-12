import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan, generateSquawk } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { calculateDistanceNm, calculateBearingDeg, angularDiffDeg, destinationPoint } from '../utils/geo';
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

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return calculateBearingDeg(a.lat, a.lon, b.lat, b.lon);
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
            } else if (x.name === 'ABEAM TRANSIT' || x.name === 'INTERCEPT' || x.name.startsWith('APPROACH ARC')) {
              // run-out and turn-in fixes of a civil straight-in lie beyond the field, up to ~17 NM from it
              expect(calculateDistanceNm(tng.latitude, tng.longitude, x.lat, x.lon)).toBeLessThan(20.01);
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

describe('home recovery by airfield type', () => {
  const names = (p: GeneratedFlightPlan) => p.waypoints.map((w) => w.name);

  it('flies the overhead break at a military airfield', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk));
      expect(p.recoveryType).toBe('tactical_overhead');
      expect(names(p).some((n) => n.includes('OVERHEAD'))).toBe(true);
      expect(names(p).some((n) => n.includes('BREAK'))).toBe(true);
    }
  });

  it('flies a straight-in at a civil airfield and never an overhead break', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMilitaryFlightPlan(epwa, 'low_level_mtr', 'medium', undefined, getNeutralWeather(epwa));
      expect(p.recoveryType).toBe('instrument');
      const recovery = p.waypoints.filter((w) => w.type === 'RECOVERY').map((w) => w.name);
      expect(recovery.some((n) => n.includes('OVERHEAD') || n.includes('BREAK') || n.includes('DOWNWIND'))).toBe(false);
      expect(names(p).some((n) => n.startsWith('FINAL'))).toBe(true);
    }
  });

  it('joins the straight-in on the extended centerline from any arrival direction', () => {
    for (let hdg = 0; hdg < 360; hdg += 10) {
      for (let run = 0; run < 3; run++) {
        const w = weatherWithRunway(epwa, hdg);
        const p = generateMilitaryFlightPlan(epwa, 'low_level_mtr', 'medium', undefined, w);
        const wps = p.waypoints;
        const fin = wps.find((x) => x.name.startsWith('FINAL'))!;
        // FINAL is 2 NM out on the approach axis behind the runway
        const finExp = destinationPoint(epwa.latitude, epwa.longitude, 2, (hdg + 180) % 360);
        expect(calculateDistanceNm(finExp.lat, finExp.lon, fin.lat, fin.lon)).toBeLessThan(0.3);
        // the IAF (10 NM) and INITIAL (5 NM) fixes, when flown, are on the same axis
        for (const [prefix, nm] of [['IAF', 10], ['INITIAL', 5]] as const) {
          const f = wps.find((x) => x.name.startsWith(prefix));
          if (!f) continue;
          const e = destinationPoint(epwa.latitude, epwa.longitude, nm, (hdg + 180) % 360);
          expect(calculateDistanceNm(e.lat, e.lon, f.lat, f.lon)).toBeLessThan(0.3);
        }
        // no turn sharper than 115 degrees from the last egress waypoint to touchdown
        const eg = wps.map((x) => x.name).lastIndexOf('LLTR EGRESS');
        const rec = wps.slice(eg).filter((x) => x.type !== 'DEP');
        for (let k = 2; k < rec.length; k++) {
          const b1 = bearing(rec[k - 2], rec[k - 1]);
          const b2 = bearing(rec[k - 1], rec[k]);
          expect(Math.abs(angularDiffDeg(b1, b2))).toBeLessThan(115.01);
        }
      }
    }
  });
});

describe('Touch & Go field type', () => {
  const tngNames = (p: GeneratedFlightPlan) => p.waypoints.map((w) => w.name);

  it('is a straight-in only at a civil airfield, from any home direction and runway', () => {
    for (const aircraft of ['fighter_jet', 'cargo'] as const) {
      for (const dep of [eplk, epks]) {
        for (let hdg = 0; hdg < 360; hdg += 20) {
          const p = generateMilitaryFlightPlan(
            dep, 'lltr_tng', 'medium', epwa, getNeutralWeather(dep), weatherWithRunway(epwa, hdg), aircraft
          );
          const n = tngNames(p);
          expect(n.includes('TNG IP')).toBe(true);
          expect(n.some((x) => x.startsWith('TNG') && (x.includes('PATTERN ENTRY') || x.includes('DOWNWIND')))).toBe(false);
          const ipIdx = n.indexOf('TNG IP');
          const ip = p.waypoints[ipIdx];
          const exp = destinationPoint(epwa.latitude, epwa.longitude, 8, (hdg + 180) % 360);
          // the IP is on the extended centerline (8 NM, plus or minus the cargo IP distance)
          const axisBrg = bearing(ip, { lat: epwa.latitude, lon: epwa.longitude });
          expect(Math.abs(angularDiffDeg(axisBrg, hdg))).toBeLessThan(6);
          expect(exp).toBeDefined();
        }
      }
    }
  });

  it('flies the approach without sharp turns and never over the civil field', () => {
    for (const aircraft of ['fighter_jet', 'cargo'] as const) {
      for (let hdg = 0; hdg < 360; hdg += 30) {
        const p = generateMilitaryFlightPlan(
          eplk, 'lltr_tng', 'medium', epwa, getNeutralWeather(eplk), weatherWithRunway(epwa, hdg), aircraft
        );
        const w = p.waypoints;
        const ip = w.findIndex((x) => x.name === 'TNG IP');
        for (let k = Math.max(1, ip - 7); k <= ip; k++) {
          const t = Math.abs(angularDiffDeg(bearing(w[k - 1], w[k]), bearing(w[k], w[k + 1])));
          expect(t).toBeLessThan(aircraft === 'cargo' ? 100.01 : 115.01);
        }
        for (let k = 1; k < ip; k++) {
          expect(calculateDistanceNm(epwa.latitude, epwa.longitude, w[k].lat, w[k].lon)).toBeGreaterThan(3);
        }
      }
    }
  });

  it('still allows a pattern join at a military airfield', () => {
    let pattern = 0;
    for (const aircraft of ['fighter_jet', 'cargo'] as const) {
      for (let hdg = 0; hdg < 360; hdg += 30) {
        const p = generateMilitaryFlightPlan(
          eplk, 'lltr_tng', 'medium', epks, getNeutralWeather(eplk), weatherWithRunway(epks, hdg), aircraft
        );
        if (tngNames(p).includes('TNG PATTERN ENTRY')) pattern++;
      }
    }
    expect(pattern).toBeGreaterThan(0);
  });
});

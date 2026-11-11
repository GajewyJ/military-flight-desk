import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { calculateBearingDeg, calculateDistanceNm, angularDiffDeg, destinationPoint } from '../utils/geo';
import {
  TRAINING_GROUNDS,
  TRAINING_REACH,
  findTrainingGround,
  trainingGroundsInReach,
} from '../data/trainingGrounds';
import { arcPoints, chooseRunInHeading, frameToLatLon, transitFixes } from '../utils/trainingGeometry';
import { generateMsfs2020PlnXml } from '../utils/msfsExporter';
import { generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import { generateKneeboardPdf } from '../utils/kneeboardPdfExporter';
import type { Airport, FlightWaypoint, GeneratedFlightPlan, TrainingGroundInfo } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const epkk: Airport = {
  ident: 'EPKK', icao: 'EPKK', name: 'Krakow Balice', elevationFt: 791,
  magDecl: '5.5° East', longestRunwayFt: 8366, latitude: 50.0777, longitude: 19.7848, military: false,
};
const home = (a: Airport) => ({ lat: a.latitude, lon: a.longitude });
const nowaDeba = findTrainingGround('nowa-deba')!;

function plan(a: Airport, profile: 'range_strafe' | 'cargo_drop', dur: 'short' | 'medium' | 'long', ground?: TrainingGroundInfo) {
  return generateMilitaryFlightPlan(
    a, profile, dur, undefined, getNeutralWeather(a), undefined,
    profile === 'cargo_drop' ? 'cargo' : 'fighter_jet', ground
  );
}
const names = (p: GeneratedFlightPlan) => p.waypoints.map((w) => w.name);
const turn = (a: FlightWaypoint, b: FlightWaypoint, c: FlightWaypoint) =>
  Math.abs(
    angularDiffDeg(
      calculateBearingDeg(a.lat, a.lon, b.lat, b.lon),
      calculateBearingDeg(b.lat, b.lon, c.lat, c.lon)
    )
  );

describe('training ground data', () => {
  it('has unique ids and plausible coordinates', () => {
    expect(new Set(TRAINING_GROUNDS.map((g) => g.id)).size).toBe(TRAINING_GROUNDS.length);
    for (const g of TRAINING_GROUNDS) {
      expect(Math.abs(g.lat)).toBeLessThan(90);
      expect(Math.abs(g.lon)).toBeLessThan(180);
      expect(g.radiusNm).toBeGreaterThan(0);
    }
  });

  it('lists the grounds within reach, nearest first', () => {
    const list = trainingGroundsInReach(home(eplk), 'fighter');
    expect(list.length).toBeGreaterThan(2);
    for (let i = 1; i < list.length; i++) expect(list[i].distanceNm).toBeGreaterThanOrEqual(list[i - 1].distanceNm);
    for (const g of list) {
      expect(g.distanceNm).toBeGreaterThanOrEqual(TRAINING_REACH.fighter.minNm);
      expect(g.distanceNm).toBeLessThanOrEqual(TRAINING_REACH.fighter.maxNm);
    }
    expect(list.some((g) => g.id === 'nowa-deba')).toBe(true);
  });
});

describe('training geometry', () => {
  const frame = { origin: { lat: 51, lon: 19 }, headingTrue: 90, sideSign: 1 as const };

  it('places points along the heading and towards the pattern side', () => {
    const ahead = frameToLatLon(frame, 3, 0);
    expect(Math.abs(calculateDistanceNm(51, 19, ahead.lat, ahead.lon) - 3)).toBeLessThan(0.02);
    expect(Math.abs(angularDiffDeg(90, calculateBearingDeg(51, 19, ahead.lat, ahead.lon)))).toBeLessThan(0.5);
    const side = frameToLatLon(frame, 0, 2); // right of an easterly heading is south
    expect(side.lat).toBeLessThan(51);
    const left = frameToLatLon({ ...frame, sideSign: -1 }, 0, 2);
    expect(left.lat).toBeGreaterThan(51);
  });

  it('turns a half circle in steps no larger than the step angle', () => {
    for (const step of [45, 60]) {
      const pts = arcPoints(1.6, 1.6, 1.6, -90, 180, step);
      expect(pts.length).toBe(180 / step);
      const last = pts[pts.length - 1];
      expect(Math.abs(last.x - 1.6)).toBeLessThan(0.001);
      expect(Math.abs(last.y - 3.2)).toBeLessThan(0.001);
    }
  });

  it('builds transit fixes of about the wanted length that end on the target', () => {
    const from = { lat: 51, lon: 19 };
    const to = destinationPoint(51, 19, 100, 70);
    const fixes = transitFixes(from, to, 20, 4);
    expect(fixes.length).toBe(5);
    expect(fixes[fixes.length - 1]).toEqual(to);
    let prev = from;
    for (const f of fixes) {
      const d = calculateDistanceNm(prev.lat, prev.lon, f.lat, f.lon);
      expect(d).toBeGreaterThan(15);
      expect(d).toBeLessThan(26);
      prev = f;
    }
  });

  it('flies the run-in into the wind within the allowed offset of the direct bearing', () => {
    expect(chooseRunInHeading(100, 110, 30)).toBe(110);
    expect(chooseRunInHeading(100, 200, 30)).toBe(130);
    expect(chooseRunInHeading(100, 20, 30)).toBe(70);
    const noWind = chooseRunInHeading(100, undefined, 30, () => 0.5);
    expect(noWind).toBe(100);
  });
});

describe('range strafing sortie (fighter)', () => {
  it('flies passes by sortie length with the target at the training ground', () => {
    for (const [dur, passes] of [['short', 2], ['medium', 3], ['long', 4]] as const) {
      const p = plan(eplk, 'range_strafe', dur, nowaDeba);
      expect(p.missionProfile).toBe('range_strafe');
      expect(p.passes).toBe(passes);
      expect(p.trainingGround?.id).toBe('nowa-deba');
      for (let n = 1; n <= passes; n++) {
        const t = p.waypoints.find((w) => w.name === `TARGET ${n}`)!;
        expect(calculateDistanceNm(t.lat, t.lon, nowaDeba.lat, nowaDeba.lon)).toBeLessThan(0.05);
        expect(t.aglFt).toBe(500);
        expect(t.type).toBe('RANGE');
      }
      expect(names(p).filter((x) => x.startsWith('TARGET')).length).toBe(passes);
      expect(names(p).includes('RANGE IP')).toBe(true);
      expect(names(p).includes('RANGE EXIT')).toBe(true);
    }
  });

  it('makes the first pass dry and rolls in on the run-in heading', () => {
    const p = plan(eplk, 'range_strafe', 'medium', nowaDeba);
    const roll = p.waypoints.find((w) => w.name === 'ROLL-IN 1')!;
    const tgt = p.waypoints.find((w) => w.name === 'TARGET 1')!;
    expect(roll.remarks).toContain('dry pass');
    expect(p.waypoints.find((w) => w.name === 'ROLL-IN 2')!.remarks).not.toContain('dry pass');
    const trueRunIn = calculateBearingDeg(roll.lat, roll.lon, tgt.lat, tgt.lon);
    const magDecl = 5.2;
    const mag = (trueRunIn - magDecl + 360) % 360;
    expect(Math.abs(angularDiffDeg(mag, p.runInHeadingMagDeg!))).toBeLessThan(2);
    const ip = p.waypoints.find((w) => w.name === 'RANGE IP')!;
    expect(Math.abs(calculateDistanceNm(ip.lat, ip.lon, tgt.lat, tgt.lon) - 10)).toBeLessThan(0.1);
  });

  it('keeps every turn in the pattern and the return at 90 degrees or less, and ends at home', () => {
    for (let i = 0; i < 15; i++) {
      const p = plan(eplk, 'range_strafe', 'long', nowaDeba);
      const w = p.waypoints;
      const from = w.findIndex((x) => x.name === 'LLTR ENTRY');
      const to = w.findIndex((x) => x.type === 'RECOVERY' || x.type === 'ARR');
      for (let k = from + 1; k <= to; k++) expect(turn(w[k - 1], w[k], w[k + 1])).toBeLessThan(115);
      expect(w[w.length - 1].name).toBe('EPLK');
      expect(p.recoveryType).toBe('tactical_overhead');
    }
  });

  it('gives range waypoints short export idents', () => {
    const p = plan(eplk, 'range_strafe', 'medium', nowaDeba);
    const range = p.waypoints.filter((w) => w.type === 'RANGE');
    expect(range.length).toBeGreaterThan(10);
    for (const w of range) expect(w.ident).toMatch(/^[A-Z0-9]{2,6}$/);
    expect(new Set(range.map((w) => w.ident)).size).toBe(range.length);
  });

  it('picks the nearest training ground in reach when none is chosen', () => {
    const p = plan(eplk, 'range_strafe', 'short');
    const nearest = trainingGroundsInReach(home(eplk), 'fighter')[0];
    expect(p.trainingGround?.id).toBe(nearest.id);
  });

  it('refuses a training ground that is too close or too far', () => {
    const near = { ...nowaDeba, ...(() => { const q = destinationPoint(eplk.latitude, eplk.longitude, 10, 90); return { lat: q.lat, lon: q.lon }; })() };
    expect(() => plan(eplk, 'range_strafe', 'short', near)).toThrow('RANGE_TOO_CLOSE');
    const far = { ...nowaDeba, lat: 37, lon: -115.5 };
    expect(() => plan(eplk, 'range_strafe', 'short', far)).toThrow('RANGE_TOO_FAR');
  });

  it('uses a straight-in recovery at a civil home airfield', () => {
    const p = plan(epkk, 'range_strafe', 'short');
    expect(p.recoveryType).toBe('instrument');
    expect(p.waypoints.filter((w) => w.type === 'RECOVERY').some((w) => w.name.includes('BREAK'))).toBe(false);
  });
});

describe('cargo drop sortie', () => {
  it('flies passes by sortie length with the drop zone at the training ground', () => {
    for (const [dur, passes] of [['short', 1], ['medium', 2], ['long', 3]] as const) {
      const p = plan(epkk, 'cargo_drop', dur, nowaDeba);
      expect(p.missionProfile).toBe('cargo_drop');
      expect(p.passes).toBe(passes);
      for (let n = 1; n <= passes; n++) {
        const z = p.waypoints.find((w) => w.name === `DZ ${n}`)!;
        expect(calculateDistanceNm(z.lat, z.lon, nowaDeba.lat, nowaDeba.lon)).toBeLessThan(0.05);
        expect(z.type).toBe('DROP');
        expect(z.aglFt).toBe(800);
        expect(z.speedKts).toBe(130);
      }
      expect(names(p).filter((x) => /^DZ \d$/.test(x)).length).toBe(passes);
    }
  });

  it('puts the release point 0.3 NM before the zone on the drop heading, slowed down', () => {
    const p = plan(epkk, 'cargo_drop', 'medium', nowaDeba);
    const carp = p.waypoints.find((w) => w.name === 'CARP 2')!;
    const dz = p.waypoints.find((w) => w.name === 'DZ 2')!;
    const runIn = p.waypoints.find((w) => w.name === 'RUN-IN 2')!;
    expect(Math.abs(calculateDistanceNm(carp.lat, carp.lon, dz.lat, dz.lon) - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(angularDiffDeg(calculateBearingDeg(carp.lat, carp.lon, dz.lat, dz.lon), calculateBearingDeg(runIn.lat, runIn.lon, dz.lat, dz.lon)))).toBeLessThan(1);
    expect(runIn.speedKts).toBe(150);
    expect(p.waypoints.find((w) => w.name === 'CARP 1')!.remarks).toContain('dry pass');
    expect(carp.remarks).not.toContain('dry pass');
  });

  it('keeps turns gentle and ends at home with a cargo recovery', () => {
    for (let i = 0; i < 15; i++) {
      const p = plan(epkk, 'cargo_drop', 'long', nowaDeba);
      const w = p.waypoints;
      const from = w.findIndex((x) => x.name === 'LLTR ENTRY');
      const to = w.findIndex((x) => x.type === 'RECOVERY' || x.type === 'ARR');
      for (let k = from + 1; k <= to; k++) expect(turn(w[k - 1], w[k], w[k + 1])).toBeLessThan(100);
      expect(w[w.length - 1].name).toBe('EPKK');
      expect(p.recoveryType).toBe('visual_pattern');
    }
  });

  it('is only available to cargo aircraft, and the strafing profile only to fighters', () => {
    expect(() =>
      generateMilitaryFlightPlan(eplk, 'cargo_drop', 'short', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet')
    ).toThrow('MISSION_PROFILE_UNSUPPORTED');
    expect(() =>
      generateMilitaryFlightPlan(epkk, 'range_strafe', 'short', undefined, getNeutralWeather(epkk), undefined, 'cargo')
    ).toThrow('CARGO_PROFILE_UNSUPPORTED');
  });
});

describe('exports and kneeboard of training sorties', () => {
  it('writes the short idents into the MSFS and Little Navmap files without duplicates', () => {
    for (const p of [plan(eplk, 'range_strafe', 'long', nowaDeba), plan(epkk, 'cargo_drop', 'long', nowaDeba)]) {
      const msfs = [...generateMsfs2020PlnXml(p).matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);
      expect(new Set(msfs).size).toBe(msfs.length);
      expect(msfs.some((id) => id === 'TGT1' || id === 'DZ1')).toBe(true);
      const lnm = [...generateLittleNavmapXml(p).matchAll(/<Ident>([^<]*)<\/Ident>\s*<Type>USER/g)].map((m) => m[1]);
      expect(new Set(lnm).size).toBe(lnm.length);
    }
  });

  it('builds a kneeboard with a range or drop-zone box and no doubled runway labels', () => {
    for (const p of [plan(eplk, 'range_strafe', 'medium', nowaDeba), plan(epkk, 'cargo_drop', 'medium', nowaDeba)]) {
      const doc = generateKneeboardPdf(p);
      expect(doc.getNumberOfPages()).toBeLessThan(4);
      const raw = doc.output();
      expect(raw.includes('RWY RWY')).toBe(false);
      expect(raw.includes('Nowa')).toBe(true);
    }
  });
});

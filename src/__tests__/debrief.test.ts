import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { computeProgress, type LiveProgress } from '../utils/liveFlight';
import { createFlightRecorder, LANDING_HOLD_MS } from '../utils/flightRecorder';
import { computeDebrief } from '../utils/debrief';
import { trackFileName, trackToGpx, trackToKml } from '../utils/trackExport';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const plan: GeneratedFlightPlan = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet');
const w = plan.waypoints;

interface Options {
  offsetNm?: number;
  /** Radar altitude by time (s since take-off). */
  agl?: (sec: number) => number;
  onGroundAtEnd?: boolean;
}

/** A simulated flight along the plan at 450 kt, one reading a second, with the recorder fed as the app does. */
function fly(opts: Options = {}) {
  const rec = createFlightRecorder();
  let prevLeg: number | undefined;
  let t = 1_700_000_000_000;
  let sec = 0;
  const landed: number[] = [];
  const phases: string[] = [];

  const feed = (sample: SimSample) => {
    const progress = computeProgress(plan, sample, prevLeg) as LiveProgress;
    prevLeg = progress.legIndex;
    const r = rec.feed(plan, sample, progress);
    if (r.justLanded) landed.push(t);
    phases.push(r.phase);
  };
  const base = (lat: number, lon: number, over: Partial<SimSample>): SimSample => ({
    lat, lon, altMslFt: 3000, aglFt: 1700, headingTrueDeg: 0, groundSpeedKts: 450, iasKts: 450, vsFpm: 0, onGround: false, t, ...over,
  });

  // On the ground at the start
  for (let i = 0; i < 5; i++) {
    feed(base(w[0].lat, w[0].lon, { onGround: true, groundSpeedKts: 0, aglFt: 0 }));
    t += 1000;
  }
  for (let i = 1; i < w.length; i++) {
    const brg = calculateBearingDeg(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    const len = calculateDistanceNm(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    for (let d = 0; d < len; d += 0.125) {
      let p = destinationPoint(w[i - 1].lat, w[i - 1].lon, d, brg);
      if (opts.offsetNm) p = destinationPoint(p.lat, p.lon, Math.abs(opts.offsetNm), (brg + (opts.offsetNm > 0 ? 90 : 270)) % 360);
      feed(base(p.lat, p.lon, { aglFt: opts.agl ? opts.agl(sec) : 1700, headingTrueDeg: brg }));
      t += 1000;
      sec += 1;
    }
  }
  // Landing and stopping
  const end = w[w.length - 1];
  for (let i = 0; i < 12; i++) {
    feed(base(end.lat, end.lon, { onGround: true, groundSpeedKts: 0, aglFt: 0 }));
    t += 1000;
  }
  return { rec, landed, phases, seconds: sec };
}

describe('flight recorder', () => {
  it('starts at take-off, records the air part and ends when the aircraft has stopped', () => {
    const f = fly();
    expect(f.phases[0]).toBe('idle');
    expect(f.rec.phase()).toBe('landed');
    expect(f.landed.length).toBe(1);
    const pts = f.rec.points();
    expect(pts.length).toBeGreaterThan(500);
    expect(pts.every((p) => p.aglFt > 0)).toBe(true); // nothing from the ground
    // Spaced about a second, in time order
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
  });

  it('does not end the flight at a touch-and-go, but does after a full stop', () => {
    const rec = createFlightRecorder();
    const progress = (s: SimSample) => computeProgress(plan, s, 3) as LiveProgress;
    const s = (t: number, over: Partial<SimSample>): SimSample => ({
      lat: w[3].lat, lon: w[3].lon, altMslFt: 3000, aglFt: 1700, headingTrueDeg: 0, groundSpeedKts: 150, iasKts: 150, vsFpm: 0, onGround: false, t, ...over,
    });
    let t = 0;
    for (let i = 0; i < 5; i++) rec.feed(plan, s((t += 1000), {}), progress(s(t, {})));
    // Wheels down for 8 s but still rolling fast
    for (let i = 0; i < 8; i++) rec.feed(plan, s((t += 1000), { onGround: true, groundSpeedKts: 120, aglFt: 0 }), progress(s(t, {})));
    expect(rec.phase()).toBe('airborne');
    // Stopped for longer than the hold time
    let landed = false;
    for (let i = 0; i < LANDING_HOLD_MS / 1000 + 2; i++) {
      landed = rec.feed(plan, s((t += 1000), { onGround: true, groundSpeedKts: 0, aglFt: 0 }), progress(s(t, {}))).justLanded || landed;
    }
    expect(landed).toBe(true);
    expect(rec.phase()).toBe('landed');
    // The next take-off is a new flight
    rec.feed(plan, s((t += 1000), {}), progress(s(t, {})));
    expect(rec.phase()).toBe('airborne');
    expect(rec.points().length).toBe(1);
  });
});

describe('computeDebrief', () => {
  it('measures time, distance and legs of a flight that follows the plan', () => {
    const f = fly();
    const d = computeDebrief(plan, f.rec.points())!;
    expect(d).not.toBe(null);
    expect(Math.abs(d.airborneSec - f.seconds)).toBeLessThan(f.seconds * 0.02 + 3);
    expect(Math.abs(d.distanceNm - d.plannedNm) / d.plannedNm).toBeLessThan(0.06);
    expect(d.avgGsKts).toBeGreaterThan(430);
    expect(d.maxGsKts).toBe(450);
    expect(d.maxAltFt).toBe(3000);
    expect(d.legsFlown).toBeGreaterThanOrEqual(d.legsTotal - 4);
    expect(d.deviation.maxXtkNm).toBeLessThan(2);
    expect(d.deviation.offTrackSec).toBe(0);
    expect(d.checked.lowSec).toBe(0);
    expect(d.checked.criticalSec).toBe(0);
    // Each leg reports a time close to its plan when flown at the planned speed
    // (corridor legs: they are planned at the speed the simulated aircraft flies; climbs and recovery legs are planned slower)
    const long = d.legs.filter((l) => l.flown && l.plannedSeconds > 60 && w[l.index].speedKts === 450 && w[l.index - 1].speedKts === 450);
    expect(long.length).toBeGreaterThan(2);
    for (const l of long) expect(Math.abs(l.seconds - l.plannedSeconds) / l.plannedSeconds).toBeLessThan(0.2);
  });

  it('adds up the time spent below the planned radar altitude on the checked legs', () => {
    // 30 s at 1,000 ft radar altitude and 10 s at 500 ft, in the middle of the low-level part
    // (20 NM into the corridor: one reading every 0.125 NM, so 8 per NM)
    const entryT = Math.round((w[w.findIndex((x) => x.name === 'LLTR ENTRY')].cumulativeDistNm + 20) * 8);
    const f = fly({ agl: (sec) => (sec >= entryT && sec < entryT + 30 ? 1000 : sec >= entryT + 30 && sec < entryT + 40 ? 500 : 1700) });
    const d = computeDebrief(plan, f.rec.points())!;
    expect(Math.abs(d.checked.lowSec - 30)).toBeLessThanOrEqual(3);
    expect(Math.abs(d.checked.criticalSec - 10)).toBeLessThanOrEqual(3);
    expect(d.checked.minAglFt).toBe(500);
    expect(d.minAglFt).toBe(500);
  });

  it('measures the distance from the planned track and the time off track', () => {
    const d = computeDebrief(plan, fly({ offsetNm: 2 }).rec.points())!;
    expect(d.deviation.avgXtkNm).toBeGreaterThan(1.4);
    expect(d.deviation.avgXtkNm).toBeLessThan(2.4);
    expect(d.deviation.offTrackSec).toBe(0); // 2 NM is inside the 3 NM limit
    const far = computeDebrief(plan, fly({ offsetNm: -6 }).rec.points())!;
    expect(far.deviation.offTrackSec).toBeGreaterThan(far.airborneSec * 0.5);
    expect(far.deviation.maxXtkNm).toBeGreaterThan(5);
  });

  it('is null when there is nothing to report', () => {
    expect(computeDebrief(plan, [])).toBe(null);
  });
});

describe('track export', () => {
  const pts = fly().rec.points().slice(0, 50);

  it('writes a GPX file with the track and the planned route', () => {
    const gpx = trackToGpx(plan, pts);
    expect(gpx.startsWith('<?xml')).toBe(true);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(50);
    expect((gpx.match(/<rtept /g) ?? []).length).toBe(w.length);
    expect(gpx).toMatch(/<time>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/time>/);
    // Altitude in metres: 3,000 ft is about 914 m
    expect(gpx).toContain('<ele>914.4</ele>');
  });

  it('writes a KML file with the flown track, the planned route and the waypoints', () => {
    const kml = trackToKml(plan, pts);
    expect(kml).toContain('<kml ');
    expect((kml.match(/<LineString>/g) ?? []).length).toBe(2);
    expect((kml.match(/<Placemark><name>/g) ?? []).length).toBe(w.length);
    // longitude first in KML
    const first = pts[0];
    expect(kml).toContain(`${first.lon.toFixed(6)},${first.lat.toFixed(6)},`);
  });

  it('escapes text in the files and makes safe file names', () => {
    const odd = { ...plan, callsign: 'A<B>&"C"' };
    expect(trackToGpx(odd, pts)).toContain('A&lt;B&gt;&amp;&quot;C&quot;');
    expect(trackFileName({ ...plan, callsign: 'VIPER 11/2' }, 'gpx')).toBe('VIPER-11-2-track.gpx');
    expect(trackFileName({ ...plan, callsign: '' }, 'kml')).toBe('flight-track.kml');
  });
});

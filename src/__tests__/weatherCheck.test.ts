import { describe, it, expect } from 'vitest';
import { checkVfr, parseMetar, sunTimes } from '../utils/weatherCheck';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import type { Airport, AirportWeather, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

const live = (over: Partial<AirportWeather>): AirportWeather => ({
  ...getNeutralWeather(eplk),
  source: 'NOAA_AWC',
  rawMetar: 'EPLK 151100Z 25008KT 9999 FEW040 15/08 Q1015',
  flightCategory: 'VFR',
  isCalm: false,
  windSpeedKts: 8,
  windDirDeg: 250,
  headwindKts: 8,
  crosswindKts: 2,
  ...over,
});

const plan = (w: AirportWeather): GeneratedFlightPlan =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, w);

const noon = new Date(Date.UTC(2026, 5, 15, 10, 0)); // 10:00Z in June: broad daylight at EPLK
const levels = (p: GeneratedFlightPlan, now = noon) => checkVfr(p, now).map((f) => f.level);

describe('parseMetar', () => {
  it('reads visibility and the cloud base', () => {
    const m = parseMetar('EPWA 151300Z 27014G22KT 9999 BKN012 OVC030 12/08 Q1013');
    expect(m.visibilityKm).toBe(10);
    expect(m.ceilingFtAgl).toBe(1200);
    expect(m.skyKnown).toBe(true);
  });
  it('ignores few and scattered cloud', () => {
    expect(parseMetar('XXXX 151300Z 27010KT 6000 SCT020 FEW040').ceilingFtAgl).toBe(undefined);
    expect(parseMetar('XXXX 151300Z 27010KT 6000 SCT020').visibilityKm).toBe(6);
  });
  it('reads statute miles, CAVOK and vertical visibility', () => {
    expect(parseMetar('KXXX 151300Z 27010KT 3SM BKN008').visibilityKm).toBeCloseTo(4.83, 1);
    expect(parseMetar('KXXX 151300Z 27010KT 1 1/2SM OVC005').visibilityKm).toBeCloseTo(2.41, 1);
    const cavok = parseMetar('XXXX 151300Z 00000KT CAVOK 20/10 Q1020');
    expect(cavok.visibilityKm).toBe(10);
    expect(cavok.skyKnown).toBe(true);
    expect(cavok.ceilingFtAgl).toBe(undefined);
    expect(parseMetar('XXXX 151300Z 00000KT 0300 FG VV002').ceilingFtAgl).toBe(200);
  });
  it('says the sky is unknown when the report has no cloud group', () => {
    expect(parseMetar('XXXX 151300Z 27010KT 9999').skyKnown).toBe(false);
  });
});

describe('sunTimes', () => {
  const near = (d: Date | null, h: number, m: number, tol = 12) => {
    expect(d === null).toBe(false);
    const diff = Math.abs(d!.getUTCHours() * 60 + d!.getUTCMinutes() - (h * 60 + m));
    expect(diff).toBeLessThanOrEqual(tol);
  };
  it('matches known sunrise and sunset in Warsaw', () => {
    const june = sunTimes(52.17, 20.97, new Date(Date.UTC(2026, 5, 21, 10)));
    near(june.sunrise, 2, 14);
    near(june.sunset, 19, 0);
    const december = sunTimes(52.17, 20.97, new Date(Date.UTC(2026, 11, 21, 10)));
    near(december.sunrise, 6, 43);
    near(december.sunset, 14, 27);
  });
  it('gives about twelve hours of day on the equator at an equinox', () => {
    const s = sunTimes(0, 10, new Date(Date.UTC(2026, 2, 20, 10)));
    const hours = (s.sunset!.getTime() - s.sunrise!.getTime()) / 3_600_000;
    expect(Math.abs(hours - 12)).toBeLessThan(0.3);
  });
  it('finds midnight sun and polar night', () => {
    expect(sunTimes(78, 15, new Date(Date.UTC(2026, 5, 21, 10))).polar).toBe('day');
    expect(sunTimes(78, 15, new Date(Date.UTC(2026, 11, 21, 10))).polar).toBe('night');
  });
  it('works for a field whose local day starts on the previous UTC day', () => {
    const s = sunTimes(-33.9, 151.2, new Date(Date.UTC(2026, 5, 15, 2))); // Sydney, midday there
    expect(s.sunrise!.getTime()).toBeLessThan(Date.UTC(2026, 5, 15, 2));
    expect(s.sunset!.getTime()).toBeGreaterThan(Date.UTC(2026, 5, 15, 2));
  });
});

describe('checkVfr', () => {
  it('finds no problem on a good day', () => {
    const l = levels(plan(live({})));
    expect(l.includes('alert')).toBe(false);
    expect(l.includes('warn')).toBe(false);
  });
  it('raises an alert when the report is IFR, the cloud is low or the visibility is poor', () => {
    expect(levels(plan(live({ flightCategory: 'IFR' })))[0]).toBe('alert');
    expect(levels(plan(live({ rawMetar: 'EPLK 151100Z 25008KT 9999 BKN008 15/08 Q1015' })))[0]).toBe('alert');
    expect(levels(plan(live({ rawMetar: 'EPLK 151100Z 25008KT 3000 FEW040 15/08 Q1015' })))[0]).toBe('alert');
  });
  it('warns about cloud close to the route and about low visibility', () => {
    const p = plan(live({ rawMetar: 'EPLK 151100Z 25008KT 9999 BKN025 15/08 Q1015' }));
    expect(checkVfr(p, noon).some((f) => f.level !== 'info' && f.text.includes('cloud'))).toBe(true);
    expect(levels(plan(live({ rawMetar: 'EPLK 151100Z 25008KT 6000 FEW040 15/08 Q1015' })))[0]).toBe('warn');
  });
  it('checks the crosswind, the tailwind and the gusts', () => {
    expect(levels(plan(live({ crosswindKts: 27 })))[0]).toBe('alert');
    expect(levels(plan(live({ crosswindKts: -17 })))[0]).toBe('warn');
    expect(levels(plan(live({ headwindKts: -11 })))[0]).toBe('alert');
    expect(levels(plan(live({ windGustKts: 30 })))[0]).toBe('warn');
  });
  it('does not check neutral weather', () => {
    const p = plan(getNeutralWeather(eplk));
    expect(levels(p).filter((x) => x !== 'info').length).toBe(0);
  });
  it('checks the daylight against the time of the sortie', () => {
    const p = plan(live({}));
    expect(checkVfr(p, new Date(Date.UTC(2026, 5, 15, 23, 0)))[0].level).toBe('alert'); // night
    const sun = sunTimes(eplk.latitude, eplk.longitude, noon);
    const lateStart = new Date(sun.sunset!.getTime() - 20 * 60_000);
    expect(checkVfr(p, lateStart).some((f) => f.level === 'alert' && f.text.includes('after sunset'))).toBe(true);
    const tightStart = new Date(sun.sunset!.getTime() - (p.totalFlightTimeMin + 10 + 10) * 60_000);
    expect(checkVfr(p, tightStart).some((f) => f.level === 'warn' && f.text.includes('30 minutes'))).toBe(true);
  });
  it('applies to VFR only', () => {
    const p = { ...plan(live({ flightCategory: 'IFR' })), flightRules: 'IFR' } as unknown as GeneratedFlightPlan;
    expect(checkVfr(p, noon)).toEqual([]);
  });
  it('lists alerts first', () => {
    const l = levels(plan(live({ flightCategory: 'MVFR', crosswindKts: 27 })));
    expect(l.indexOf('alert')).toBeLessThan(l.indexOf('warn'));
  });
});

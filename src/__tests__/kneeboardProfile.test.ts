import { describe, it, expect } from 'vitest';
import { generateKneeboardPdf } from '../utils/kneeboardPdfExporter';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import type { ProfilePoint } from '../utils/altitudeProfile';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

const plan = (duration: 'short' | 'medium' | 'long'): GeneratedFlightPlan =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', duration, undefined, getNeutralWeather(eplk), undefined, 'fighter_jet');

const terrainFor = (p: GeneratedFlightPlan): ProfilePoint[] => {
  const total = p.waypoints[p.waypoints.length - 1].cumulativeDistNm;
  const out: ProfilePoint[] = [];
  for (let d = 0; d <= total; d += 2) out.push({ distNm: d, elevFt: 300 + 250 * Math.sin(d / 9) });
  return out;
};

describe('kneeboard altitude profile', () => {
  for (const duration of ['short', 'medium', 'long'] as const) {
    it(`${duration}: is made with the terrain, without it, and with an empty terrain list`, () => {
      const p = plan(duration);
      for (const terrain of [terrainFor(p), null, undefined, []]) {
        const doc = generateKneeboardPdf(p, { terrain });
        expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
        expect(doc.getNumberOfPages()).toBeLessThan(4);
      }
    });
  }

  it('is made in metres and kilometres too, and in the print theme', () => {
    const p = plan('medium');
    const doc = generateKneeboardPdf(p, {
      terrain: terrainFor(p),
      print: true,
      units: { altitude: 'm', distance: 'km', speed: 'kmh', pressure: 'hpa' },
    });
    expect(doc.getNumberOfPages()).toBeLessThan(4);
  });
});

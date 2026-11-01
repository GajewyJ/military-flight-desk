import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchElevationsFt, applyTerrainAgl } from '../utils/terrainService';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import type { Airport } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

/** Fake Open-Meteo elevation endpoint: terrain height (m) as a function of position. */
const terrainM = (lat: number, lon: number): number =>
  Math.max(0, 250 + 220 * Math.sin(lat * 40) * Math.sin(lon * 40) + 150 * Math.sin(lat * 130 + lon * 90));

function elevationResponse(url: string) {
  const q = new URL(url);
  const lats = q.searchParams.get('latitude')!.split(',').map(Number);
  const lons = q.searchParams.get('longitude')!.split(',').map(Number);
  return { ok: true, status: 200, json: async () => ({ elevation: lats.map((la, i) => terrainM(la, lons[i])) }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchElevationsFt retry', () => {
  it('retries after an HTTP 429 and then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
      return elevationResponse(url);
    });
    const res = await fetchElevationsFt([{ lat: 10.1234, lon: 20.1234 }]);
    expect(res).not.toBe(null);
    expect(calls).toBe(2);
  });

  it('does not retry a 400 (bad request)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return { ok: false, status: 400, json: async () => ({}) };
    });
    const res = await fetchElevationsFt([{ lat: 11.1234, lon: 21.1234 }]);
    expect(res).toBe(null);
    expect(calls).toBe(1);
  });

  it('gives up with null after the retries when the service keeps failing', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return { ok: false, status: 503, json: async () => ({}) };
    });
    const res = await fetchElevationsFt([{ lat: 12.1234, lon: 22.1234 }]);
    expect(res).toBe(null);
    expect(calls).toBe(3);
  });
});

describe('applyTerrainAgl labels', () => {
  it('labels each waypoint with its true height above the ground under it', async () => {
    vi.stubGlobal('fetch', async (url: string) => elevationResponse(url));
    const plan = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk));
    const out = await applyTerrainAgl(plan);
    expect(out.terrainSource).toBe('DEM');

    let checked = 0;
    for (const wp of out.waypoints) {
      const m = wp.altDisplay.match(/\(([\d,]+) ft AGL\)/);
      if (!m || !wp.altDisplay.includes('ft MSL')) continue;
      if (!['MTR_ENTRY', 'CHECKPOINT', 'IP', 'EGRESS'].includes(wp.type)) continue;
      const labelAgl = parseInt(m[1].replace(/,/g, ''), 10);
      const trueAgl = wp.altFt - Math.round(terrainM(wp.lat, wp.lon) * 3.28084);
      expect(Math.abs(labelAgl - trueAgl)).toBeLessThanOrEqual(60); // label is rounded to 50 ft
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('flags the plan ESTIMATED when terrain data cannot be fetched', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, json: async () => ({}) }));
    const plan = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'short', undefined, getNeutralWeather(eplk));
    const out = await applyTerrainAgl(plan);
    expect(out.terrainSource).toBe('ESTIMATED');
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { applyTerrainAgl } from '../utils/terrainService';
import { isDraggableWaypoint, moveWaypoint, MIN_WAYPOINT_SPACING_NM } from '../utils/routeEdit';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const epks: Airport = {
  ident: 'EPKS', icao: 'EPKS', name: '31st Tactical Air Base Krzesiny', elevationFt: 279,
  magDecl: '4.8° East', longestRunwayFt: 8202, latitude: 52.3317, longitude: 16.9664, military: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const lowLevel = (cls: 'fighter_jet' | 'cargo' = 'fighter_jet'): GeneratedFlightPlan =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk), undefined, cls);

describe('isDraggableWaypoint', () => {
  it('allows the corridor fixes and nothing around the runways', () => {
    for (const cls of ['fighter_jet', 'cargo'] as const) {
      const p = lowLevel(cls);
      const last = p.waypoints.length - 1;
      expect(isDraggableWaypoint(p, 0)).toBe(false);
      expect(isDraggableWaypoint(p, last)).toBe(false);
      p.waypoints.forEach((w, i) => {
        if (w.type === 'DEP' || w.type === 'CLIMB' || w.type === 'RECOVERY' || w.type === 'ARR') {
          expect(isDraggableWaypoint(p, i)).toBe(false);
        }
        if (w.type === 'CHECKPOINT' || w.type === 'IP' || w.name === 'LLTR ENTRY' || w.name === 'LLTR EGRESS') {
          expect(isDraggableWaypoint(p, i)).toBe(true);
        }
      });
    }
  });

  it('keeps the Touch & Go pattern and the final approach where they are', () => {
    const p = generateMilitaryFlightPlan(eplk, 'lltr_tng', 'medium', epks, getNeutralWeather(eplk), getNeutralWeather(epks));
    p.waypoints.forEach((w, i) => {
      if (w.name.startsWith('TNG') || w.type === 'TNG' || w.type === 'IP') expect(isDraggableWaypoint(p, i)).toBe(false);
    });
  });
});

describe('moveWaypoint', () => {
  const pickCheckpoint = (p: GeneratedFlightPlan) => p.waypoints.findIndex((w, i) => w.type === 'CHECKPOINT' && i > 2 && isDraggableWaypoint(p, i));

  it('recalculates the two legs, the totals and the headings named in the remarks', () => {
    const p = lowLevel();
    const before = JSON.parse(JSON.stringify(p)) as GeneratedFlightPlan;
    const i = pickCheckpoint(p);
    const w = p.waypoints[i];
    const target = destinationPoint(w.lat, w.lon, 5, 40);
    const out = moveWaypoint(p, w.id, target.lat, target.lon);
    expect(out).not.toBe(null);
    const q = out as GeneratedFlightPlan;

    // The plan that was passed in is not changed
    expect(JSON.parse(JSON.stringify(p))).toEqual(before);

    expect(q.routeEdited).toBe(true);
    expect(q.waypoints[i].lat).toBeCloseTo(target.lat, 6);
    const prev = q.waypoints[i - 1];
    expect(q.waypoints[i].legDistNm).toBeCloseTo(Math.round(calculateDistanceNm(prev.lat, prev.lon, target.lat, target.lon) * 10) / 10, 5);
    expect(q.waypoints[i].bearingTrueDeg).toBe(Math.round(calculateBearingDeg(prev.lat, prev.lon, target.lat, target.lon)));
    const next = q.waypoints[i + 1];
    expect(next.bearingTrueDeg).toBe(Math.round(calculateBearingDeg(target.lat, target.lon, next.lat, next.lon)));

    // Totals follow the legs
    const sum = q.waypoints.reduce((s, x) => s + x.legDistNm, 0);
    const last = q.waypoints[q.waypoints.length - 1];
    expect(Math.abs(last.cumulativeDistNm - sum)).toBeLessThan(1.5);
    expect(q.totalDistanceNm).toBe(Math.round(last.cumulativeDistNm));
    expect(q.totalFlightTimeMin).toBe(Math.round(last.cumulativeTimeSeconds / 60));
    // Waypoints before the move are untouched
    expect(q.waypoints[i - 2]).toEqual(p.waypoints[i - 2]);

    // Time keeps adding up
    for (let k = 1; k < q.waypoints.length; k++) {
      expect(q.waypoints[k].cumulativeTimeSeconds - q.waypoints[k - 1].cumulativeTimeSeconds).toBe(q.waypoints[k].legEteSeconds);
    }

    // The remark of the moved checkpoint names the new heading to the next fix
    const hdg = String(Math.round(next.bearingMagDeg) % 360);
    expect(q.waypoints[i].remarks).toContain(`${hdg}°M`);
  });

  it('refuses to move the airfield, the departure, the recovery or a waypoint next to its neighbour', () => {
    const p = lowLevel();
    expect(moveWaypoint(p, p.waypoints[0].id, 51, 19)).toBe(null);
    expect(moveWaypoint(p, p.waypoints[p.waypoints.length - 1].id, 51, 19)).toBe(null);
    expect(moveWaypoint(p, p.waypoints[1].id, 51, 19)).toBe(null);
    expect(moveWaypoint(p, 'no-such-id', 51, 19)).toBe(null);

    const i = pickCheckpoint(p);
    const w = p.waypoints[i];
    const prev = p.waypoints[i - 1];
    const tooClose = destinationPoint(prev.lat, prev.lon, MIN_WAYPOINT_SPACING_NM / 2, 10);
    expect(moveWaypoint(p, w.id, tooClose.lat, tooClose.lon)).toBe(null);
    expect(moveWaypoint(p, w.id, Number.NaN, 19)).toBe(null);
  });

  it('works for cargo plans too, move after move', () => {
    let p = lowLevel('cargo');
    for (let n = 0; n < 4; n++) {
      const i = pickCheckpoint(p);
      const w = p.waypoints[i];
      const to = destinationPoint(w.lat, w.lon, 3, n * 90);
      const q = moveWaypoint(p, w.id, to.lat, to.lon);
      expect(q).not.toBe(null);
      p = q as GeneratedFlightPlan;
    }
    expect(p.routeEdited).toBe(true);
  });
});

describe('terrain step after a move', () => {
  it('can run again on an edited plan without repeating the clearance sentence', async () => {
    const terrainM = (lat: number, lon: number) => 200 + 100 * Math.sin(lat * 50) * Math.cos(lon * 50);
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url);
      const lats = q.searchParams.get('latitude')!.split(',').map(Number);
      const lons = q.searchParams.get('longitude')!.split(',').map(Number);
      return { ok: true, status: 200, json: async () => ({ elevation: lats.map((la, i) => terrainM(la, lons[i])) }) };
    });
    const p = await applyTerrainAgl(lowLevel());
    const i = p.waypoints.findIndex((w, k) => w.type === 'CHECKPOINT' && k > 2 && isDraggableWaypoint(p, k));
    const w = p.waypoints[i];
    const to = destinationPoint(w.lat, w.lon, 4, 120);
    const moved = moveWaypoint(p, w.id, to.lat, to.lon) as GeneratedFlightPlan;
    const again = await applyTerrainAgl(moved);
    expect(again.terrainSource).toBe('DEM');
    for (const x of again.waypoints) {
      const count = (x.remarks.match(/Clearance/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});

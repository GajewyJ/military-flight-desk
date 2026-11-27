import { describe, it, expect, afterEach } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { findTrainingGround } from '../data/trainingGrounds';
import { listItems, readItem, removeItem, writeItem, libraryAvailable, newItemId } from '../utils/library';
import { defaultMissionName, isValidPlan, missionMeta, packMission, unpackMission } from '../utils/missions';
import { flightId, flightMeta, packFlight, packPoints, unpackFlight, unpackPoints } from '../utils/flightHistory';
import { createFlightRecorder, type RecPoint } from '../utils/flightRecorder';
import { computeProgress } from '../utils/liveFlight';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const g = globalThis as unknown as { window?: unknown };

afterEach(() => {
  delete g.window;
});

const lowLevel = (): GeneratedFlightPlan =>
  generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'short', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet');

/** The Windows app side: a library in memory behind the same calls as the preload script. */
function installElectron() {
  const kinds: Record<string, Map<string, { meta: Record<string, unknown>; data: unknown }>> = { missions: new Map(), flights: new Map() };
  const library = {
    list: async (kind: string) => ({
      ok: true as const,
      items: [...kinds[kind].entries()].map(([id, v]) => ({ id, meta: v.meta })).sort((a, b) => Number(b.meta.savedAt) - Number(a.meta.savedAt)),
    }),
    read: async (kind: string, id: string) =>
      kinds[kind].has(id) ? { ok: true as const, data: kinds[kind].get(id)!.data } : { ok: false as const, error: 'Not found' },
    write: async (kind: string, id: string, meta: Record<string, unknown>, data: unknown) => {
      kinds[kind].set(id, { meta, data: JSON.parse(JSON.stringify(data)) });
      return { ok: true as const };
    },
    remove: async (kind: string, id: string) => {
      kinds[kind].delete(id);
      return { ok: true as const };
    },
  };
  g.window = { electronSim: { library } };
  return kinds;
}

function installBrowser() {
  const mem = new Map<string, string>();
  g.window = {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    },
  };
  return mem;
}

describe('library (Windows app)', () => {
  it('saves, lists newest first, reads and removes', async () => {
    installElectron();
    await writeItem('missions', 'a', { name: 'A', savedAt: 1 }, { x: 1 });
    await writeItem('missions', 'b', { name: 'B', savedAt: 2 }, { x: 2 });
    expect((await listItems('missions')).map((i) => i.id)).toEqual(['b', 'a']);
    expect(await readItem('missions', 'a')).toEqual({ x: 1 });
    await removeItem('missions', 'a');
    expect((await listItems('missions')).map((i) => i.id)).toEqual(['b']);
    expect(libraryAvailable('flights')).toBe(true);
  });

  it('turns an error of the main process into an Error with its message', async () => {
    installElectron();
    await expect(readItem('missions', 'missing')).rejects.toThrow('Not found');
  });
});

describe('library (browser)', () => {
  it('keeps missions in the browser storage, and says flights need the Windows app', async () => {
    installBrowser();
    expect(libraryAvailable('missions')).toBe(true);
    expect(libraryAvailable('flights')).toBe(false);
    await writeItem('missions', 'a', { name: 'A', savedAt: 5 }, { x: 1 });
    await writeItem('missions', 'b', { name: 'B', savedAt: 9 }, { x: 2 });
    expect((await listItems('missions')).map((i) => i.id)).toEqual(['b', 'a']);
    expect(await readItem('missions', 'b')).toEqual({ x: 2 });
    await removeItem('missions', 'b');
    expect((await listItems('missions')).map((i) => i.id)).toEqual(['a']);
    await expect(listItems('flights')).rejects.toThrow(/cannot be saved here/);
  });

  it('says so when the browser storage is full', async () => {
    g.window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    };
    await expect(writeItem('missions', 'a', { savedAt: 1 }, {})).rejects.toThrow(/storage is full/);
  });

  it('gives new names that are valid for the store and different each time', () => {
    const a = newItemId('m');
    const b = newItemId('m');
    expect(a).toMatch(/^m-[a-z0-9]+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe('saved missions', () => {
  it('keeps a plan of every kind exactly, hand-moved waypoints included', () => {
    const plans: GeneratedFlightPlan[] = [
      lowLevel(),
      generateMilitaryFlightPlan(eplk, 'range_strafe', 'short', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet', findTrainingGround('nowa-deba')!),
      generateMilitaryFlightPlan(eplk, 'cargo_drop', 'short', undefined, getNeutralWeather(eplk), undefined, 'cargo', findTrainingGround('nowa-deba')!),
    ];
    plans[0] = { ...plans[0], routeEdited: true };
    for (const plan of plans) {
      expect(isValidPlan(plan)).toBe(true);
      const back = unpackMission(JSON.parse(JSON.stringify(packMission(plan))));
      expect(back).toEqual(plan);
    }
  });

  it('refuses things that are not a mission', () => {
    const plan = lowLevel();
    expect(unpackMission(null)).toBe(null);
    expect(unpackMission({})).toBe(null);
    expect(unpackMission({ schema: 2, plan })).toBe(null);
    expect(unpackMission({ schema: 1, plan: { ...plan, waypoints: [] } })).toBe(null);
    expect(unpackMission({ schema: 1, plan: { ...plan, waypoints: [plan.waypoints[0], { ...plan.waypoints[1], lat: 'x' }] } })).toBe(null);
    expect(unpackMission({ schema: 1, plan: { ...plan, operatingAirbase: undefined } })).toBe(null);
    expect(unpackMission({ schema: 1, plan: { ...plan, departureWeather: undefined } })).toBe(null);
  });

  it('names a mission and describes it for the list', () => {
    const plan = lowLevel();
    expect(defaultMissionName(plan)).toBe(`EPLK Low-level route \u00b7 ${plan.callsign}`);
    const meta = missionMeta(plan, '  My route  ', 1234);
    expect(meta).toMatchObject({ name: 'My route', savedAt: 1234, callsign: plan.callsign, depIdent: 'EPLK', edited: false });
    expect(meta.waypoints).toBe(plan.waypoints.length);
    // An empty name falls back to the default one
    expect(missionMeta(plan, '   ').name).toBe(defaultMissionName(plan));
    expect(missionMeta({ ...plan, routeEdited: true }, 'x').edited).toBe(true);
  });
});

/** A short recorded flight along the plan. */
function recordFlight(plan: GeneratedFlightPlan): RecPoint[] {
  const rec = createFlightRecorder();
  let prev: number | undefined;
  let t = 1_700_000_000_000;
  const w = plan.waypoints;
  for (let i = 1; i < w.length; i++) {
    const brg = calculateBearingDeg(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    const len = calculateDistanceNm(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
    for (let d = 0; d < len; d += 0.25) {
      const p = destinationPoint(w[i - 1].lat, w[i - 1].lon, d, brg);
      const sample = { lat: p.lat, lon: p.lon, altMslFt: 3000.4, aglFt: 900.6, headingTrueDeg: brg, groundSpeedKts: 450, iasKts: 450, vsFpm: 0, onGround: false, t };
      const progress = computeProgress(plan, sample, prev);
      prev = progress?.legIndex;
      rec.feed(plan, sample, progress);
      t += 2000;
    }
  }
  return rec.points();
}

describe('flight history', () => {
  const plan = lowLevel();
  const points = recordFlight(plan);

  it('stores the points as short rounded rows and brings them back', () => {
    expect(points.length).toBeGreaterThan(50);
    const rows = packPoints(points);
    expect(rows[0].length).toBe(13);
    const back = unpackPoints(JSON.parse(JSON.stringify(rows)));
    expect(back.length).toBe(points.length);
    back.forEach((p, i) => {
      expect(p.t).toBe(points[i].t);
      expect(Math.abs(p.lat - points[i].lat)).toBeLessThan(1e-5);
      expect(Math.abs(p.altMslFt - points[i].altMslFt)).toBeLessThanOrEqual(0.5);
      expect(p.leg).toBe(points[i].leg);
      expect(p.agl).toBe(points[i].agl);
      expect(p.high).toBe(points[i].high);
      expect(p.offTrack).toBe(points[i].offTrack);
    });
    // Small: a point is far under 150 bytes
    expect(JSON.stringify(rows).length / points.length).toBeLessThan(150);
  });

  it('keeps all states and flags', () => {
    const base = points[0];
    const odd: RecPoint[] = [
      { ...base, agl: 'low', high: true, offTrack: false },
      { ...base, agl: 'critical', high: false, offTrack: true },
      { ...base, agl: 'none', high: true, offTrack: true },
    ];
    const back = unpackPoints(packPoints(odd));
    expect(back.map((p) => [p.agl, p.high, p.offTrack])).toEqual([
      ['low', true, false],
      ['critical', false, true],
      ['none', true, true],
    ]);
  });

  it('saves a flight with its plan and reads it back; the same flight has the same name', () => {
    const saved = packFlight(plan, points);
    const back = unpackFlight(JSON.parse(JSON.stringify(saved)));
    expect(back).not.toBe(null);
    expect(back!.plan).toEqual(plan);
    expect(back!.points.length).toBe(points.length);
    expect(flightId(points)).toBe(flightId(points.slice()));
    expect(flightId(points)).toMatch(/^f-[a-z0-9]+$/);
  });

  it('describes a flight for the list', () => {
    const meta = flightMeta(plan, points, 99)!;
    expect(meta).toMatchObject({ savedAt: 99, startedAt: points[0].t, callsign: plan.callsign, depIdent: 'EPLK', samples: points.length });
    expect(meta.airborneSec).toBeGreaterThan(60);
    expect(meta.distanceNm).toBeGreaterThan(20);
    expect(flightMeta(plan, points.slice(0, 1))).toBe(null);
  });

  it('refuses damaged flights', () => {
    expect(unpackFlight(null)).toBe(null);
    expect(unpackFlight({ schema: 1, plan, rows: [] })).toBe(null);
    expect(unpackFlight({ schema: 1, plan: {}, rows: packPoints(points) })).toBe(null);
    expect(unpackPoints([[1, 2, 3], ['a', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]])).toEqual([]);
    expect(unpackPoints('nope')).toEqual([]);
  });
});

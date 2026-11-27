import { describe, it, expect } from 'vitest';
import { createStore, KINDS, type StoreFs } from '../../electron/store.cjs';

/** A file system in memory, with the few calls the store uses. */
function memoryFs() {
  const files = new Map<string, string>();
  const fs: StoreFs = {
    mkdirSync: () => undefined,
    readdirSync: (dir) => [...files.keys()].filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')).map((f) => f.slice(dir.length + 1)),
    readFileSync: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFileSync: (p, d) => void files.set(p, d),
    renameSync: (a, b) => {
      files.set(b, files.get(a) as string);
      files.delete(a);
    },
    unlinkSync: (p) => {
      if (!files.delete(p)) throw new Error('ENOENT');
    },
    existsSync: (p) => files.has(p),
  };
  return { files, fs };
}

function setup() {
  const m = memoryFs();
  const store = createStore({ root: '/data', fs: m.fs, path: { join: (...p) => p.join('/') } });
  return { ...m, store };
}

describe('library store', () => {
  it('saves an item and reads it back, with its summary in the list', () => {
    const { store } = setup();
    store.write('missions', 'm1', { name: 'Low level 1', savedAt: 100 }, { waypoints: [1, 2, 3] });
    expect(store.read('missions', 'm1')).toEqual({ waypoints: [1, 2, 3] });
    expect(store.list('missions')).toEqual([{ id: 'm1', meta: { name: 'Low level 1', savedAt: 100 } }]);
  });

  it('lists the newest first and an empty list for a kind that has nothing', () => {
    const { store } = setup();
    expect(store.list('flights')).toEqual([]);
    store.write('flights', 'a', { savedAt: 1 }, {});
    store.write('flights', 'b', { savedAt: 3 }, {});
    store.write('flights', 'c', { savedAt: 2 }, {});
    expect(store.list('flights').map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('writes the same item again (replacing it) and removes items', () => {
    const { store, files } = setup();
    store.write('missions', 'm1', { savedAt: 1, name: 'one' }, { v: 1 });
    store.write('missions', 'm1', { savedAt: 2, name: 'two' }, { v: 2 });
    expect(store.list('missions').length).toBe(1);
    expect(store.read('missions', 'm1')).toEqual({ v: 2 });
    store.remove('missions', 'm1');
    expect(store.list('missions')).toEqual([]);
    expect([...files.keys()].filter((f) => f.includes('/missions/'))).toEqual([]);
    // Removing something that is not there is fine
    expect(() => store.remove('missions', 'm1')).not.toThrow();
  });

  it('leaves no temporary file behind and skips damaged or unfinished items', () => {
    const { store, files } = setup();
    store.write('missions', 'good', { savedAt: 1 }, { ok: true });
    expect([...files.keys()].some((f) => f.endsWith('.tmp'))).toBe(false);
    // A damaged summary, and a summary whose data is missing
    files.set('/data/missions/bad.meta.json', '{not json');
    files.set('/data/missions/orphan.meta.json', JSON.stringify({ savedAt: 5 }));
    expect(store.list('missions').map((i) => i.id)).toEqual(['good']);
  });

  it('refuses names that could reach other files, unknown kinds and bad content', () => {
    const { store } = setup();
    for (const id of ['../x', 'a/b', 'a\\b', '', 'a b', 'x'.repeat(65), '.hidden']) {
      expect(() => store.write('missions', id, {}, {})).toThrow();
      expect(() => store.read('missions', id)).toThrow();
      expect(() => store.remove('missions', id)).toThrow();
    }
    expect(() => store.write('secrets', 'a', {}, {})).toThrow();
    expect(() => store.list('..')).toThrow();
    expect(() => store.write('missions', 'a', [] as unknown as Record<string, unknown>, {})).toThrow();
    expect(() => store.write('missions', 'a', {}, undefined)).toThrow();
    expect(() => store.write('missions', 'a', { big: 'x'.repeat(20000) }, {})).toThrow(/Summary/);
  });

  it('refuses an item that is too large', () => {
    const { store } = setup();
    const big = 'x'.repeat(KINDS.missions.maxBytes + 10);
    expect(() => store.write('missions', 'big', { savedAt: 1 }, { big })).toThrow(/too large/);
    expect(store.list('missions')).toEqual([]);
  });

  it('removes the oldest flights beyond the limit, but never missions', () => {
    const { store } = setup();
    const limit = KINDS.flights.max;
    for (let i = 0; i < limit + 3; i++) store.write('flights', `f${i}`, { savedAt: i + 1 }, { i });
    const flights = store.list('flights');
    expect(flights.length).toBe(limit);
    expect(flights[0].id).toBe(`f${limit + 2}`);
    expect(flights.some((f) => f.id === 'f0')).toBe(false);
    expect(() => store.read('flights', 'f0')).toThrow();

    // Missions: full means "delete some first"
    const small = createStore({ root: '/d2', fs: memoryFs().fs, path: { join: (...p) => p.join('/') } });
    const max = KINDS.missions.max;
    for (let i = 0; i < max; i++) small.write('missions', `m${i}`, { savedAt: i }, {});
    expect(() => small.write('missions', 'one-more', { savedAt: 1 }, {})).toThrow(/full/);
    // An existing one can still be replaced
    expect(() => small.write('missions', 'm0', { savedAt: 9999 }, { changed: true })).not.toThrow();
  });
});

import type { LibraryKind } from '../types/electronSim';

/**
 * The library of the app (saved missions, history of flown flights) as the screens use it. In the Windows app the items are
 * files in the application's data folder, kept by the main process (electron/store.cjs); the pilot does not choose a place.
 * In the browser, saved missions are kept in the browser's own storage; the flight history needs the Windows app (the live
 * link that records flights is only there).
 */

export type { LibraryKind };

export interface LibraryItem<M> {
  id: string;
  meta: M;
}

const BROWSER_KEY = 'mfd.library.missions';
const BROWSER_MAX_ITEMS = 100;

const api = () => (typeof window !== 'undefined' ? window.electronSim?.library : undefined);

/** Can this kind of item be kept here? */
export function libraryAvailable(kind: LibraryKind): boolean {
  if (api()) return true;
  return kind === 'missions' && typeof window !== 'undefined' && !!window.localStorage;
}

type BrowserStore = Record<string, { meta: Record<string, unknown>; data: unknown }>;

function readBrowser(): BrowserStore {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BROWSER_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeBrowser(store: BrowserStore) {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(store));
  } catch {
    throw new Error('The browser storage is full: delete some saved missions first');
  }
}

function assertKind(kind: LibraryKind) {
  if (!libraryAvailable(kind)) throw new Error('This cannot be saved here');
}

/** The items of a kind, newest first. Throws an Error with a message for the pilot when the library cannot be read. */
export async function listItems<M extends object>(kind: LibraryKind): Promise<Array<LibraryItem<M>>> {
  assertKind(kind);
  const a = api();
  if (a) {
    const r = await a.list(kind);
    if (!r.ok) throw new Error(r.error);
    return r.items as unknown as Array<LibraryItem<M>>;
  }
  const store = readBrowser();
  return Object.entries(store)
    .map(([id, v]) => ({ id, meta: v.meta as unknown as M }))
    .sort((x, y) => Number((y.meta as Record<string, unknown>).savedAt ?? 0) - Number((x.meta as Record<string, unknown>).savedAt ?? 0));
}

export async function readItem<T>(kind: LibraryKind, id: string): Promise<T> {
  assertKind(kind);
  const a = api();
  if (a) {
    const r = await a.read(kind, id);
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  }
  const entry = readBrowser()[id];
  if (!entry) throw new Error('Not found');
  return entry.data as T;
}

export async function writeItem(kind: LibraryKind, id: string, meta: object, data: unknown): Promise<void> {
  assertKind(kind);
  const a = api();
  if (a) {
    const r = await a.write(kind, id, meta as Record<string, unknown>, data);
    if (!r.ok) throw new Error(r.error);
    return;
  }
  const store = readBrowser();
  if (!store[id] && Object.keys(store).length >= BROWSER_MAX_ITEMS) {
    throw new Error(`The library is full (${BROWSER_MAX_ITEMS} missions): delete some first`);
  }
  store[id] = { meta: meta as Record<string, unknown>, data };
  writeBrowser(store);
}

export async function removeItem(kind: LibraryKind, id: string): Promise<void> {
  assertKind(kind);
  const a = api();
  if (a) {
    const r = await a.remove(kind, id);
    if (!r.ok) throw new Error(r.error);
    return;
  }
  const store = readBrowser();
  delete store[id];
  writeBrowser(store);
}

/** A new name for an item: prefix, the time and a few random characters. */
export function newItemId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

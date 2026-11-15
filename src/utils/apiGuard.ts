import { fetchWithTimeout } from './http';

/**
 * Keeps the app polite to the free web services it uses (METAR, ATIS, Open-Meteo, GitHub):
 *  - answers a repeated GET from a short-lived cache instead of asking again;
 *  - shares one request between identical requests that are in flight at the same time;
 *  - spaces the requests to one host and limits how many run at once;
 *  - after HTTP 429 (or 503 with Retry-After) stops asking that host until the wait is over;
 *  - after a network failure does not repeat the same request for a few seconds.
 * Pressing buttons quickly can therefore never turn into a flood of requests.
 */

export interface GuardOptions {
  /** Keep a successful GET answer this long (ms). 0 or missing: no cache. */
  ttlMs?: number;
}

export interface ApiGuardDeps {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostPolicy {
  /** Least time between the start of two requests to the host. */
  minIntervalMs: number;
}

const HOST_POLICIES: Record<string, HostPolicy> = {
  'api.open-meteo.com': { minIntervalMs: 600 },
  'metar.vatsim.net': { minIntervalMs: 500 },
  'data.vatsim.net': { minIntervalMs: 1000 },
  'datis.clowd.io': { minIntervalMs: 500 },
  'api.github.com': { minIntervalMs: 1000 },
};
const DEFAULT_POLICY: HostPolicy = { minIntervalMs: 300 };

const MAX_CONCURRENT = 4; // requests running at once, over all hosts
const MAX_CACHE_ENTRIES = 200;
const FAILURE_COOLDOWN_MS = 15_000; // no repeat of a request that just failed on the network
const DEFAULT_BLOCK_MS = 60_000; // 429 without a Retry-After header
const MAX_BLOCK_MS = 5 * 60_000;

interface Snapshot {
  status: number;
  statusText: string;
  body: string;
}

const toResponse = (s: Snapshot): Response => new Response(s.body, { status: s.status, statusText: s.statusText });

export class ApiGuard {
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private cache = new Map<string, { snap: Snapshot; expires: number }>();
  private inflight = new Map<string, Promise<Snapshot>>();
  private failedAt = new Map<string, number>();
  private nextStart = new Map<string, number>(); // host -> earliest start of its next request
  private blockedUntil = new Map<string, number>(); // host -> no requests before this
  private running = 0;
  private waiters: Array<() => void> = [];

  constructor(deps: ApiGuardDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** Forgets the cached answers only; pacing and the wait after HTTP 429 stay in force. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Forgets everything (used by tests). */
  reset(): void {
    this.cache.clear();
    this.inflight.clear();
    this.failedAt.clear();
    this.nextStart.clear();
    this.blockedUntil.clear();
  }

  async fetch(url: string, init: RequestInit = {}, timeoutMs = 6000, opts: GuardOptions = {}): Promise<Response> {
    const isGet = !init.method || init.method.toUpperCase() === 'GET';
    if (!isGet) return toResponse(await this.run(url, init, timeoutMs, false));

    const ttl = opts.ttlMs ?? 0;
    const hit = this.cache.get(url);
    if (hit && hit.expires > this.now()) return toResponse(hit.snap);

    const shared = this.inflight.get(url);
    if (shared) return toResponse(await shared);

    const promise = this.run(url, init, timeoutMs, true).then((snap) => {
      if (ttl > 0 && snap.status >= 200 && snap.status < 300) this.store(url, snap, ttl);
      return snap;
    });
    this.inflight.set(url, promise);
    try {
      return toResponse(await promise);
    } finally {
      this.inflight.delete(url);
    }
  }

  private store(url: string, snap: Snapshot, ttl: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(url, { snap, expires: this.now() + ttl });
  }

  private async run(url: string, init: RequestInit, timeoutMs: number, remember: boolean): Promise<Snapshot> {
    const host = this.hostOf(url);

    const blocked = this.blockedUntil.get(host) ?? 0;
    if (blocked > this.now()) {
      return { status: 429, statusText: 'Too Many Requests (waiting before the next try)', body: '' };
    }
    const failed = this.failedAt.get(url);
    if (remember && failed !== undefined && this.now() - failed < FAILURE_COOLDOWN_MS) {
      throw new Error(`Request failed a moment ago, not repeating it yet: ${host}`);
    }

    await this.acquire();
    try {
      // Space the requests to one host
      const policy = HOST_POLICIES[host] ?? DEFAULT_POLICY;
      const start = Math.max(this.now(), this.nextStart.get(host) ?? 0);
      this.nextStart.set(host, start + policy.minIntervalMs);
      const wait = start - this.now();
      if (wait > 0) await this.sleep(wait);

      const controller = new AbortController();
      const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (e) {
        if (remember) this.failedAt.set(url, this.now());
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (res.status === 429 || (res.status === 503 && res.headers?.get?.('Retry-After'))) {
        const retryAfter = Number(res.headers?.get?.('Retry-After'));
        const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_BLOCK_MS;
        this.blockedUntil.set(host, this.now() + Math.min(ms, MAX_BLOCK_MS));
      }
      this.failedAt.delete(url);
      return { status: res.status, statusText: res.statusText, body: await res.text() };
    } finally {
      this.release();
    }
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'unknown';
    }
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next(); // hands the free slot straight to the next request
    else this.running--;
  }
}

/**
 * True in the app (browser or Electron window), false in tests and other non-browser runs.
 * There the guard stays out of the way, so tests that replace fetch behave as before.
 */
export function isRealBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent));
}

const appGuard = new ApiGuard();

/** fetch() for the web services: a timeout, plus the protections above when running in the app. */
export function guardedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6000,
  opts: GuardOptions = {}
): Promise<Response> {
  if (!isRealBrowser()) return fetchWithTimeout(url, init, timeoutMs);
  return appGuard.fetch(url, init, timeoutMs, opts);
}

/** Drops the cached answers, so the next request asks the service again (the Refresh button). */
export function clearApiCache(): void {
  appGuard.clearCache();
}

/** How long answers are kept (ms). */
export const TTL = {
  metar: 5 * 60_000,
  atis: 3 * 60_000,
  vatsimData: 60_000,
  forecast: 10 * 60_000,
  releaseNotes: 10 * 60_000,
};

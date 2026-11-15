import { describe, it, expect } from 'vitest';
import { ApiGuard } from '../utils/apiGuard';

/** A guard with a fake clock and a fake network, so the waiting takes no real time. */
function makeGuard(respond: (url: string, calls: number) => Response | Promise<Response> | Error) {
  let t = 1_000_000;
  const urls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const guard = new ApiGuard({
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    fetchImpl: async (url) => {
      urls.push(url);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
      const out = respond(url, urls.length);
      if (out instanceof Error) throw out;
      return out;
    },
  });
  return { guard, urls, advance: (ms: number) => (t += ms), starts: () => t, maxActive: () => maxActive };
}

const ok = (body = 'x') => new Response(body, { status: 200 });

describe('ApiGuard', () => {
  it('answers a repeated request from the cache until it expires', async () => {
    const { guard, urls, advance } = makeGuard(() => ok('first'));
    expect(await (await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 })).text()).toBe('first');
    expect(await (await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 })).text()).toBe('first');
    expect(urls.length).toBe(1);
    advance(61_000);
    await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 });
    expect(urls.length).toBe(2);
  });

  it('shares one request between identical requests that run at the same time', async () => {
    const { guard, urls } = makeGuard(() => ok());
    const [a, b, c] = await Promise.all([
      guard.fetch('https://a.test/x', {}, 0),
      guard.fetch('https://a.test/x', {}, 0),
      guard.fetch('https://a.test/x', {}, 0),
    ]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(urls.length).toBe(1);
  });

  it('does not cache failed answers or anything that is not a GET', async () => {
    const { guard, urls } = makeGuard((_u, n) => (n === 1 ? new Response('no', { status: 500 }) : ok()));
    expect((await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 })).status).toBe(500);
    expect((await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 })).status).toBe(200);
    await guard.fetch('https://a.test/p', { method: 'POST' }, 0, { ttlMs: 60_000 });
    await guard.fetch('https://a.test/p', { method: 'POST' }, 0, { ttlMs: 60_000 });
    expect(urls.length).toBe(4);
  });

  it('spaces the requests to one host', async () => {
    const { guard, starts } = makeGuard(() => ok());
    const t0 = starts();
    await guard.fetch('https://api.open-meteo.com/a', {}, 0);
    await guard.fetch('https://api.open-meteo.com/b', {}, 0);
    await guard.fetch('https://api.open-meteo.com/c', {}, 0);
    expect(starts() - t0).toBeGreaterThanOrEqual(1200); // 600 ms between starts
  });

  it('stops asking a host after HTTP 429 until the wait is over', async () => {
    const { guard, urls, advance } = makeGuard((_u, n) =>
      n === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '30' } }) : ok()
    );
    expect((await guard.fetch('https://a.test/x', {}, 0)).status).toBe(429);
    expect((await guard.fetch('https://a.test/y', {}, 0)).status).toBe(429); // answered without a request
    expect(urls.length).toBe(1);
    advance(31_000);
    expect((await guard.fetch('https://a.test/y', {}, 0)).status).toBe(200);
    expect(urls.length).toBe(2);
  });

  it('does not repeat a request that failed on the network a moment ago', async () => {
    const { guard, urls, advance } = makeGuard((_u, n) => (n === 1 ? new Error('offline') : ok()));
    await expect(guard.fetch('https://a.test/x', {}, 0)).rejects.toThrow('offline');
    await expect(guard.fetch('https://a.test/x', {}, 0)).rejects.toThrow('not repeating');
    expect(urls.length).toBe(1);
    advance(16_000);
    expect((await guard.fetch('https://a.test/x', {}, 0)).status).toBe(200);
  });

  it('runs at most four requests at once', async () => {
    const { guard, urls, maxActive } = makeGuard(() => ok());
    await Promise.all(Array.from({ length: 10 }, (_, i) => guard.fetch(`https://h${i}.test/x`, {}, 0)));
    expect(urls.length).toBe(10);
    expect(maxActive()).toBeLessThanOrEqual(4);
  });

  it('clearCache makes the next request go out again', async () => {
    const { guard, urls } = makeGuard(() => ok());
    await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 });
    guard.clearCache();
    await guard.fetch('https://a.test/x', {}, 0, { ttlMs: 60_000 });
    expect(urls.length).toBe(2);
  });
});

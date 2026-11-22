import { describe, it, expect } from 'vitest';
import { createSimLink, toSample, VARIABLES } from '../../electron/simLink.cjs';

type Handler = (arg?: unknown) => void;

/** A stand-in for the node-simconnect library: records what the link asks for and lets the test send data. */
function fakeLib(options: { failOpen?: () => boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const calls: string[] = [];
  const handle = {
    addToDataDefinition: (_id: number, name: string, units: string) => calls.push(`define ${name} [${units}]`),
    requestDataOnSimObject: () => calls.push('request'),
    on: (event: string, fn: Handler) => handlers.set(event, fn),
    close: () => calls.push('close'),
  };
  const lib = {
    Protocol: { FSX_SP2: 'sp2' },
    SimConnectDataType: { FLOAT64: 'f64' },
    SimConnectPeriod: { SECOND: 'second' },
    SimConnectConstants: { OBJECT_ID_USER: 0 },
    open: async () => {
      if (options.failOpen?.()) throw new Error('no simulator');
      return { recvOpen: { applicationName: 'KittyHawk' }, handle };
    },
  };
  const send = (values: number[]) => {
    let i = 0;
    handlers.get('simObjectData')!({ requestID: 1, data: { readFloat64: () => values[i++] } });
  };
  return { lib, handlers, calls, send };
}

function setup(options: { failOpen?: () => boolean; loadFails?: boolean } = {}) {
  const f = fakeLib(options);
  const messages: Array<[string, any]> = [];
  const timers: Array<() => void> = [];
  const link = createSimLink({
    loadLib: async () => {
      if (options.loadFails) throw Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' });
      return f.lib;
    },
    emit: (channel, payload) => messages.push([channel, payload]),
    now: () => 1234,
    setTimer: (fn) => timers.push(fn) as unknown as number,
    clearTimer: () => {},
  });
  const statuses = () => messages.filter((m) => m[0] === 'sim:link-status').map((m) => m[1].status);
  const samples = () => messages.filter((m) => m[0] === 'sim:link-sample').map((m) => m[1]);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { ...f, link, messages, timers, statuses, samples, settle };
}

// lat, lon, alt MSL, AGL, heading, ground speed, IAS, vertical speed, on ground
const VALUES = [51.55, 19.18, 2200, 1480, 372.5, 451, 440, -120, 0];

describe('SimConnect link', () => {
  it('asks for the variables in a fixed order and passes the readings on', async () => {
    const t = setup();
    t.link.setEnabled(true);
    await t.settle();
    expect(t.calls.filter((c) => c.startsWith('define')).length).toBe(VARIABLES.length);
    expect(t.calls[0]).toBe('define PLANE LATITUDE [degrees]');
    expect(t.calls).toContain('request');
    expect(t.statuses()).toEqual(['waiting', 'connected']);

    t.send(VALUES);
    expect(t.samples()).toEqual([
      {
        lat: 51.55, lon: 19.18, altMslFt: 2200, aglFt: 1480, headingTrueDeg: 12.5,
        groundSpeedKts: 451, iasKts: 440, vsFpm: -120, onGround: false, t: 1234,
      },
    ]);
  });

  it('ignores readings without a position and readings of other requests', async () => {
    const t = setup();
    t.link.setEnabled(true);
    await t.settle();
    t.send([0, 0, 0, 0, 0, 0, 0, 0, 1]); // aircraft not placed yet
    t.send([NaN, 19, 1, 1, 1, 1, 1, 1, 0]);
    expect(t.samples()).toEqual([]);
    expect(toSample([95, 19, 1, 1, 1, 1, 1, 1, 0], () => 0)).toBe(null);
  });

  it('keeps trying while the simulator is not running, then connects', async () => {
    let running = false;
    const t = setup({ failOpen: () => !running });
    t.link.setEnabled(true);
    await t.settle();
    expect(t.statuses()).toEqual(['waiting']);
    expect(t.timers.length).toBe(1);

    running = true;
    t.timers.shift()!();
    await t.settle();
    expect(t.statuses()).toEqual(['waiting', 'connected']);
  });

  it('goes back to waiting when the simulator quits, and closes the connection when switched off', async () => {
    const t = setup();
    t.link.setEnabled(true);
    await t.settle();
    t.handlers.get('quit')!();
    expect(t.statuses()).toEqual(['waiting', 'connected', 'waiting']);
    expect(t.timers.length).toBe(1);

    t.timers.shift()!();
    await t.settle();
    expect(t.statuses().slice(-1)).toEqual(['connected']);
    t.link.setEnabled(false);
    expect(t.calls).toContain('close');
    expect(t.statuses().slice(-1)).toEqual(['off']);
    expect(t.link.getStatus().status).toBe('off');
  });

  it('says so once, and stops trying, when the library is not part of the build', async () => {
    const t = setup({ loadFails: true });
    t.link.setEnabled(true);
    await t.settle();
    expect(t.statuses()).toEqual(['waiting', 'unavailable']);
    expect(t.timers.length).toBe(0);
  });

  it('does nothing when switched on twice, and nothing after dispose', async () => {
    const t = setup();
    t.link.setEnabled(true);
    t.link.setEnabled(true);
    await t.settle();
    expect(t.calls.filter((c) => c === 'request').length).toBe(1);
    t.link.dispose();
    expect(t.calls).toContain('close');
  });
});

'use strict';

/**
 * Live link to Microsoft Flight Simulator (2020 and 2024) through SimConnect, using the node-simconnect library
 * (a pure TypeScript SimConnect client: no SDK files and no native build step).
 *
 * The link runs in the Electron main process and only reads: it asks the simulator for the position, altitude, height
 * above the ground, heading and speed of the user's aircraft once a second and passes them on. Nothing is written to the
 * simulator. While the link is switched on and the simulator is not running, it tries again every few seconds, so it
 * can be switched on before MSFS has started.
 *
 * Status: 'off' (switched off) | 'waiting' (switched on, simulator not found yet) | 'connected' | 'unavailable'
 * (the SimConnect library is missing from this build, so it is not tried again).
 */

// The variables read once a second. The order matters: the values arrive in this order.
const VARIABLES = [
  ['PLANE LATITUDE', 'degrees'],
  ['PLANE LONGITUDE', 'degrees'],
  ['PLANE ALTITUDE', 'feet'],
  ['PLANE ALT ABOVE GROUND', 'feet'],
  ['PLANE HEADING DEGREES TRUE', 'degrees'],
  ['GROUND VELOCITY', 'knots'],
  ['AIRSPEED INDICATED', 'knots'],
  ['VERTICAL SPEED', 'feet per minute'],
  ['SIM ON GROUND', 'bool'],
];

const DEFINITION_ID = 1;
const REQUEST_ID = 1;

/** Turns the raw values (in the order of VARIABLES) into a sample, or null if the position is not valid. */
function toSample(values, now) {
  const [lat, lon, altMslFt, aglFt, headingTrueDeg, groundSpeedKts, iasKts, vsFpm, onGround] = values;
  if (![lat, lon, altMslFt, aglFt, headingTrueDeg, groundSpeedKts].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Both 0/0 means the simulator has not placed the aircraft yet (loading screen)
  if (lat === 0 && lon === 0) return null;
  return {
    lat,
    lon,
    altMslFt,
    aglFt: Math.max(0, aglFt),
    headingTrueDeg: ((headingTrueDeg % 360) + 360) % 360,
    groundSpeedKts: Math.max(0, groundSpeedKts),
    iasKts: Number.isFinite(iasKts) ? Math.max(0, iasKts) : 0,
    vsFpm: Number.isFinite(vsFpm) ? vsFpm : 0,
    onGround: onGround >= 0.5,
    t: now(),
  };
}

/**
 * @param {object} opts
 * @param {() => Promise<any>} opts.loadLib       loads node-simconnect (injected so the link can be tested)
 * @param {(channel: string, payload: any) => void} opts.emit  sends a message to the window
 * @param {number} [opts.retryMs]                 delay between tries while the simulator is not found
 * @param {() => number} [opts.now]
 * @param {(fn: () => void, ms: number) => any} [opts.setTimer]
 * @param {(id: any) => void} [opts.clearTimer]
 * @param {(msg: string, err?: unknown) => void} [opts.log]
 */
function createSimLink(opts) {
  const {
    loadLib,
    emit,
    retryMs = 4000,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    log = () => {},
  } = opts;

  let enabled = false;
  let status = 'off';
  let detail = '';
  let lib = null;
  let handle = null;
  let connecting = false;
  let timer = null;
  // Each connection gets a number: events from an older connection are ignored
  let generation = 0;

  function setStatus(next, text = '') {
    if (next === status && text === detail) return;
    status = next;
    detail = text;
    emit('sim:link-status', { status, detail });
  }

  function clearRetry() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function scheduleRetry() {
    clearRetry();
    if (!enabled || status === 'unavailable') return;
    timer = setTimer(() => {
      timer = null;
      void connect();
    }, retryMs);
  }

  function closeHandle() {
    generation++;
    const h = handle;
    handle = null;
    if (h) {
      try {
        h.close();
      } catch (err) {
        log('SimConnect close failed', err);
      }
    }
  }

  function onLost(myGeneration) {
    if (myGeneration !== generation) return;
    handle = null;
    generation++;
    if (!enabled) return;
    setStatus('waiting', 'Simulator closed or connection lost');
    scheduleRetry();
  }

  async function connect() {
    if (!enabled || connecting || handle) return;
    connecting = true;
    try {
      if (!lib) lib = await loadLib();
      const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = lib;
      // FSX_SP2 works with MSFS 2020 and MSFS 2024
      const { recvOpen, handle: h } = await open('Military Flight Desk', Protocol.FSX_SP2);
      if (!enabled) {
        // Switched off while connecting
        try {
          h.close();
        } catch {
          /* ignore */
        }
        return;
      }
      const myGeneration = ++generation;
      handle = h;

      VARIABLES.forEach(([name, units]) => h.addToDataDefinition(DEFINITION_ID, name, units, SimConnectDataType.FLOAT64));
      h.on('simObjectData', (recv) => {
        if (myGeneration !== generation || recv.requestID !== REQUEST_ID) return;
        const values = VARIABLES.map(() => recv.data.readFloat64());
        const sample = toSample(values, now);
        if (sample) emit('sim:link-sample', sample);
      });
      h.on('exception', (e) => log('SimConnect exception', e));
      h.on('quit', () => onLost(myGeneration));
      h.on('close', () => onLost(myGeneration));
      h.requestDataOnSimObject(REQUEST_ID, DEFINITION_ID, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND);

      const app = recvOpen && recvOpen.applicationName ? String(recvOpen.applicationName) : 'Microsoft Flight Simulator';
      setStatus('connected', app);
    } catch (err) {
      const code = err && typeof err === 'object' ? err.code : undefined;
      if (!lib && (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')) {
        // The library is not part of this build: say so once and stop trying
        setStatus('unavailable', 'The SimConnect library is not included in this build');
        return;
      }
      // Normal while MSFS is not running (or still starting)
      setStatus('waiting', 'Waiting for Microsoft Flight Simulator');
      scheduleRetry();
    } finally {
      connecting = false;
    }
  }

  return {
    /** Switches the link on or off. */
    setEnabled(on) {
      const want = Boolean(on);
      if (want === enabled) return status;
      enabled = want;
      if (enabled) {
        if (status === 'off') setStatus('waiting', 'Waiting for Microsoft Flight Simulator');
        void connect();
      } else {
        clearRetry();
        closeHandle();
        setStatus('off', '');
      }
      return status;
    },
    getStatus() {
      return { status, detail };
    },
    /** Closes everything (app quitting). */
    dispose() {
      enabled = false;
      clearRetry();
      closeHandle();
    },
  };
}

module.exports = { createSimLink, VARIABLES, toSample };

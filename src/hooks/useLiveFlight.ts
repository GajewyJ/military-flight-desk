import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimLinkStatus, SimSample } from '../types/electronSim';
import type { GeneratedFlightPlan } from '../types/flightDesk';
import { appendTrail, computeProgress, type LiveProgress } from '../utils/liveFlight';

const STORAGE_KEY = 'mfd.livelink';

/** What the map needs to show the live link. */
export interface LiveFlightView {
  enabled: boolean;
  status: SimLinkStatus;
  sample: SimSample | null;
  /** Where the aircraft has been, as [lat, lon] points. */
  trail: Array<[number, number]>;
  progress: LiveProgress | null;
  onToggle: () => void;
  onClearTrail: () => void;
}

function readSaved(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The live link to the simulator (Electron app only): the aircraft's position and progress along `plan`.
 * Returns null in the browser or in a build without the link, so nothing about it is shown there.
 * The choice to have it on is remembered; the link itself starts and stops in the Electron main process.
 */
export function useLiveFlight(plan: GeneratedFlightPlan | null): LiveFlightView | null {
  const api = typeof window !== 'undefined' ? window.electronSim?.simLink : undefined;

  const [enabled, setEnabled] = useState<boolean>(() => readSaved());
  const [status, setStatus] = useState<SimLinkStatus>({ status: 'off', detail: '' });
  const [sample, setSample] = useState<SimSample | null>(null);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);
  const [progress, setProgress] = useState<LiveProgress | null>(null);

  const planRef = useRef(plan);
  planRef.current = plan;
  const legRef = useRef<number | undefined>(undefined);

  // A new flight plan starts with a clean track and finds its first leg again
  const planKey = plan ? `${plan.sortieId}|${plan.callsign}|${plan.generatedAt}` : '';
  useEffect(() => {
    legRef.current = undefined;
    setTrail([]);
    setProgress(null);
  }, [planKey]);

  // Subscribe to the readings and the status; switch the link on or off as chosen
  useEffect(() => {
    if (!api) return;
    const offStatus = api.onStatus((s) => setStatus(s));
    const offSample = api.onSample((s) => {
      setSample(s);
      setTrail((t) => appendTrail(t, s));
      const p = planRef.current;
      if (p) {
        const next = computeProgress(p, s, legRef.current);
        legRef.current = next?.legIndex;
        setProgress(next);
      }
    });
    return () => {
      offStatus();
      offSample();
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .setEnabled(enabled)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    if (!enabled) {
      setSample(null);
      setProgress(null);
      legRef.current = undefined;
    }
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);

  const onToggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* the choice is just not remembered */
      }
      return next;
    });
  }, []);

  const onClearTrail = useCallback(() => setTrail([]), []);

  if (!api) return null;
  return { enabled, status, sample, trail, progress, onToggle, onClearTrail };
}

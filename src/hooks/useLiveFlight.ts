import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimLinkStatus, SimSample } from '../types/electronSim';
import type { GeneratedFlightPlan } from '../types/flightDesk';
import { appendTrail, computeProgress, type LiveProgress } from '../utils/liveFlight';
import { appendProfileTrace, routeDistanceNm, type ProfileTracePoint } from '../utils/altitudeProfile';
import { initialAlertState, nextAlerts, type SpeechFormat } from '../utils/alerts';
import { createSystemSpeaker, type Speaker } from '../utils/speech';
import { createFlightRecorder, type FlightPhase, type RecPoint } from '../utils/flightRecorder';
import { altValue, distValue, unitLabels, type Units } from '../utils/units';

const STORAGE_KEY = 'mfd.livelink';

/** A flight shorter than this (s) is not worth a debrief that opens by itself. */
const MIN_DEBRIEF_SEC = 60;

/** What the map needs to show the live link. */
export interface LiveFlightView {
  enabled: boolean;
  status: SimLinkStatus;
  sample: SimSample | null;
  /** Where the aircraft has been, as [lat, lon] points. */
  trail: Array<[number, number]>;
  progress: LiveProgress | null;
  /** The altitude flown, by distance along the route (for the altitude profile). */
  profileTrace: ProfileTracePoint[];
  onToggle: () => void;
  onClearTrail: () => void;
  /** Spoken alerts (switched on or off in Settings): whether an English voice is there to speak with, and whether they are on. */
  voice: { available: boolean; enabled: boolean };
  lastAlert: string | null;
  /** The recorded flight and its debrief. */
  flight: {
    phase: FlightPhase;
    /** There is a recorded flight to look at. */
    canDebrief: boolean;
    getPoints: () => RecPoint[];
    debriefOpen: boolean;
    onOpenDebrief: () => void;
    onCloseDebrief: () => void;
  };
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* the choice is just not remembered */
  }
}

const DIST_WORDS: Record<string, string> = { NM: 'nautical miles', km: 'kilometers', mi: 'miles' };
const ALT_WORDS: Record<string, string> = { ft: 'feet', m: 'meters' };
const speakNumber = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)));

/**
 * The live link to the simulator (Electron app only): the aircraft's position and progress along `plan`, spoken alerts,
 * and the recording of the flight for the debrief.
 * Returns null in the browser or in a build without the link, so nothing about it is shown there.
 * The choice to have the link on is remembered; the link itself starts and stops in the Electron main process.
 * `options` are the settings that matter here: the units the alerts are spoken in and whether they are spoken at all.
 */
export function useLiveFlight(
  plan: GeneratedFlightPlan | null,
  options: {
    units: Units;
    voiceAlerts: boolean;
    /** A flight ended (the aircraft landed and stopped): the plan and the recorded points, for the history. */
    onLanded?: (plan: GeneratedFlightPlan, points: RecPoint[]) => void;
  }
): LiveFlightView | null {
  const api = typeof window !== 'undefined' ? window.electronSim?.simLink : undefined;
  const { units, voiceAlerts: voiceEnabled } = options;
  const onLandedRef = useRef(options.onLanded);
  onLandedRef.current = options.onLanded;

  const [enabled, setEnabled] = useState<boolean>(() => readFlag(STORAGE_KEY, false));
  const [status, setStatus] = useState<SimLinkStatus>({ status: 'off', detail: '' });
  const [sample, setSample] = useState<SimSample | null>(null);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);
  const [progress, setProgress] = useState<LiveProgress | null>(null);
  const [profileTrace, setProfileTrace] = useState<ProfileTracePoint[]>([]);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [phase, setPhase] = useState<FlightPhase>('idle');
  const [recorded, setRecorded] = useState(false);
  const [debriefOpen, setDebriefOpen] = useState(false);

  const planRef = useRef(plan);
  planRef.current = plan;
  const legRef = useRef<number | undefined>(undefined);
  const voiceRef = useRef(voiceEnabled);
  voiceRef.current = voiceEnabled;

  // Units as they are spoken
  const sayRef = useRef<SpeechFormat>({ dist: String, alt: String });
  const labels = unitLabels(units);
  sayRef.current = {
    dist: (nm) => `${speakNumber(distValue(nm, units))} ${DIST_WORDS[labels.dist] ?? labels.dist}`,
    alt: (ft) => `${Math.round(altValue(ft, units))} ${ALT_WORDS[labels.alt] ?? labels.alt}`,
  };

  const speakerRef = useRef<Speaker | null>(null);
  if (speakerRef.current === null && typeof window !== 'undefined') speakerRef.current = createSystemSpeaker();
  // The voices of the system load late: show again when they are there
  const [, setVoicesVersion] = useState(0);
  useEffect(() => speakerRef.current?.subscribe(() => setVoicesVersion((v) => v + 1)), []);
  const alertStateRef = useRef(initialAlertState());
  const alertTimerRef = useRef<number | undefined>(undefined);
  const recorderRef = useRef(createFlightRecorder());
  // Whether a flight has been recorded (a ref, so the readings do not set the state every second)
  const recordedFlag = useRef(false);

  // A new flight plan starts with a clean track, alerts and recording, and finds its first leg again
  const planKey = plan ? `${plan.sortieId}|${plan.callsign}|${plan.generatedAt}` : '';
  useEffect(() => {
    legRef.current = undefined;
    alertStateRef.current = initialAlertState();
    recorderRef.current.reset();
    recordedFlag.current = false;
    setTrail([]);
    setProfileTrace([]);
    setProgress(null);
    setPhase('idle');
    setRecorded(false);
    setDebriefOpen(false);
  }, [planKey]);

  // Subscribe to the readings and the status; switch the link on or off as chosen
  useEffect(() => {
    if (!api) return;
    const offStatus = api.onStatus((s) => setStatus(s));
    const offSample = api.onSample((s) => {
      setSample(s);
      setTrail((t) => appendTrail(t, s));
      const p = planRef.current;
      if (!p) return;
      // The flight is about to start, or has just started (before take-off, or the take-off itself): the leg is found anew,
      // so a flight that begins where the last one ended (same airfield, the end of the route on top of its start) starts
      // on the first legs and not on the last ones
      const phaseBefore = recorderRef.current.phase();
      if (phaseBefore !== 'airborne' && (s.onGround ? phaseBefore === 'idle' : true)) legRef.current = undefined;
      const next = computeProgress(p, s, legRef.current);
      legRef.current = next?.legIndex;
      setProgress(next);
      if (next) {
        const point = { distNm: routeDistanceNm(p, next), altFt: s.altMslFt };
        setProfileTrace((t) => appendProfileTrace(t, point));
      }

      // The recording of the flight; a landing opens the debrief
      const rec = recorderRef.current;
      const before = phaseBefore;
      const r = rec.feed(p, s, next);
      if (r.phase !== before) setPhase(r.phase);
      if (r.phase === 'airborne' && !recordedFlag.current) {
        recordedFlag.current = true;
        setRecorded(true);
      }
      if (r.justLanded) {
        const pts = rec.points();
        if (pts.length >= MIN_DEBRIEF_SEC) {
          setDebriefOpen(true);
          onLandedRef.current?.(p, pts);
        }
      }

      // Spoken alerts
      const result = nextAlerts(alertStateRef.current, { plan: p, sample: s, progress: next, nowMs: s.t, say: sayRef.current });
      alertStateRef.current = result.state;
      if (voiceRef.current && result.alerts.length > 0) {
        const speaker = speakerRef.current;
        for (const alert of [...result.alerts].sort((a, b) => b.priority - a.priority)) {
          if (speaker?.speak(alert.text, alert.priority)) {
            setLastAlert(alert.text);
            window.clearTimeout(alertTimerRef.current);
            alertTimerRef.current = window.setTimeout(() => setLastAlert(null), 8000);
            break;
          }
        }
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
      // The track and the recording stay for a look afterwards; the aircraft and the voice go
      setSample(null);
      setProgress(null);
      legRef.current = undefined;
      alertStateRef.current = initialAlertState();
      speakerRef.current?.cancel();
    }
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);

  useEffect(() => () => window.clearTimeout(alertTimerRef.current), []);

  // Switching the voice on or off in Settings: a short call so the pilot hears that it works, or silence at once
  const voiceBefore = useRef(voiceEnabled);
  useEffect(() => {
    if (voiceBefore.current === voiceEnabled) return;
    voiceBefore.current = voiceEnabled;
    const speaker = speakerRef.current;
    if (voiceEnabled) speaker?.speak('Voice alerts on', 1);
    else speaker?.cancel();
  }, [voiceEnabled]);

  const onToggle = useCallback(() => {
    setEnabled((on) => {
      saveFlag(STORAGE_KEY, !on);
      return !on;
    });
  }, []);

  const onClearTrail = useCallback(() => {
    setTrail([]);
    setProfileTrace([]);
  }, []);

  const getPoints = useCallback(() => recorderRef.current.points(), []);
  const onOpenDebrief = useCallback(() => setDebriefOpen(true), []);
  const onCloseDebrief = useCallback(() => setDebriefOpen(false), []);

  if (!api) return null;
  return {
    enabled,
    status,
    sample,
    trail,
    progress,
    profileTrace,
    onToggle,
    onClearTrail,
    voice: { available: speakerRef.current?.available ?? false, enabled: voiceEnabled },
    lastAlert,
    flight: { phase, canDebrief: recorded && phase !== 'idle', getPoints, debriefOpen, onOpenDebrief, onCloseDebrief },
  };
}

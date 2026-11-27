import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { computeProgress, type LiveProgress } from '../utils/liveFlight';
import {
  initialAlertState,
  nextAlerts,
  spellHeading,
  speakableName,
  REPEAT_MS,
  type AlertState,
  type SpeechFormat,
} from '../utils/alerts';
import { createSpeaker, pickEnglishVoice } from '../utils/speech';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from '../utils/geo';
import type { Airport, GeneratedFlightPlan } from '../types/flightDesk';
import type { SimSample } from '../types/electronSim';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};
const say: SpeechFormat = {
  dist: (nm) => `${nm.toFixed(0)} miles`,
  alt: (ft) => `${Math.round(ft)} feet`,
};

const plan: GeneratedFlightPlan = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk), undefined, 'fighter_jet');
const w = plan.waypoints;
// The middle of a long leg between two corridor fixes
const k = w.findIndex((x, i) => i > 4 && x.type === 'CHECKPOINT' && w[i - 1].type === 'CHECKPOINT' && w[i].legDistNm > 10);
const a = w[k - 1];
const b = w[k];
const legBrg = calculateBearingDeg(a.lat, a.lon, b.lat, b.lon);
const mid = destinationPoint(a.lat, a.lon, calculateDistanceNm(a.lat, a.lon, b.lat, b.lon) / 2, legBrg);

function reading(over: Partial<SimSample> = {}, offsetNm = 0): { sample: SimSample; progress: LiveProgress } {
  const p = offsetNm === 0 ? mid : destinationPoint(mid.lat, mid.lon, Math.abs(offsetNm), (legBrg + (offsetNm > 0 ? 90 : 270)) % 360);
  const sample: SimSample = {
    lat: p.lat, lon: p.lon, altMslFt: 3000, aglFt: 1700, headingTrueDeg: legBrg, groundSpeedKts: 450, iasKts: 450,
    vsFpm: 0, onGround: false, t: 0, ...over,
  };
  return { sample, progress: computeProgress(plan, sample, k) as LiveProgress };
}

function step(state: AlertState, r: { sample: SimSample; progress: LiveProgress | null }, nowMs: number) {
  return nextAlerts(state, { plan, sample: r.sample, progress: r.progress, nowMs, say });
}

describe('spoken text', () => {
  it('says headings digit by digit', () => {
    expect(spellHeading(270)).toBe('two seven zero');
    expect(spellHeading(5)).toBe('zero zero five');
    expect(spellHeading(360)).toBe('zero zero zero');
  });
  it('spells airfield codes and abbreviations', () => {
    expect(speakableName('LLTR ENTRY')).toBe('low level entry');
    expect(speakableName('IP FOXTROT')).toBe('I P foxtrot');
    expect(speakableName('EPLK')).toBe('E P L K');
  });
});

describe('nextAlerts', () => {
  it('says nothing while all is well, and nothing on the ground', () => {
    let s = initialAlertState();
    for (let i = 0; i < 5; i++) {
      const r = step(s, reading(), 1000 * i);
      expect(r.alerts).toEqual([]);
      s = r.state;
    }
    const ground = step(s, reading({ onGround: true, aglFt: 0 }), 9000);
    expect(ground.alerts).toEqual([]);
  });

  it('warns once when the height drops, repeats a critical warning calmly, and is quiet again when back', () => {
    let s = initialAlertState();
    s = step(s, reading(), 0).state;

    let r = step(s, reading({ aglFt: 1100 }), 1000);
    expect(r.alerts.map((x) => x.kind)).toEqual(['low']);
    expect(r.alerts[0].text).toBe('Low altitude, 1100 feet');
    s = r.state;
    // Still low a moment later: no second warning
    r = step(s, reading({ aglFt: 1100 }), 3000);
    expect(r.alerts).toEqual([]);
    s = r.state;
    // Still low after the repeat time: spoken again
    r = step(s, reading({ aglFt: 1100 }), 1000 + REPEAT_MS.low + 10);
    expect(r.alerts.map((x) => x.kind)).toEqual(['low']);
    s = r.state;

    // Critical: urgent, repeated every few seconds
    const t0 = 40000;
    r = step(s, reading({ aglFt: 500 }), t0);
    expect(r.alerts.map((x) => x.kind)).toEqual(['critical']);
    expect(r.alerts[0].priority).toBe(3);
    s = r.state;
    expect(step(s, reading({ aglFt: 500 }), t0 + 2000).alerts).toEqual([]);
    r = step(s, reading({ aglFt: 500 }), t0 + REPEAT_MS.critical + 10);
    expect(r.alerts.map((x) => x.kind)).toEqual(['critical']);
    s = r.state;

    // Back to low from critical: no new "low" call, then fine again: nothing is said
    r = step(s, reading({ aglFt: 1100 }), t0 + 12000);
    expect(r.alerts).toEqual([]);
    r = step(r.state, reading(), t0 + 14000);
    expect(r.alerts).toEqual([]);
  });

  it('calls off track with side and distance, repeats slowly and says when back on track', () => {
    let s = initialAlertState();
    s = step(s, reading(), 0).state;
    let r = step(s, reading({}, 5), 1000);
    expect(r.alerts.map((x) => x.kind)).toEqual(['off_track']);
    expect(r.alerts[0].text).toBe('Off track, 5 miles right');
    s = r.state;
    expect(step(s, reading({}, 5), 5000).alerts).toEqual([]);
    r = step(s, reading({}, -5), 1000 + REPEAT_MS.off_track + 10);
    expect(r.alerts[0].text).toBe('Off track, 5 miles left');
    r = step(r.state, reading(), 80000);
    expect(r.alerts.map((x) => x.kind)).toEqual(['back_on_track']);
  });

  it('warns when well above the planned altitude', () => {
    let s = initialAlertState();
    s = step(s, reading(), 0).state;
    const plannedMsl = reading().progress.plannedMslFt;
    const r = step(s, reading({ altMslFt: plannedMsl + 1500 }), 1000);
    expect(r.alerts.map((x) => x.kind)).toEqual(['high']);
    expect(r.alerts[0].text).toContain('above plan');
  });

  it('announces a main fix when it is passed, and a turn with the new heading', () => {
    // Fly past each waypoint in turn: collect what is said
    const spoken: string[] = [];
    let s = initialAlertState();
    let prevLeg: number | undefined;
    let now = 0;
    for (let i = 1; i < w.length; i++) {
      const brg = calculateBearingDeg(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
      const len = calculateDistanceNm(w[i - 1].lat, w[i - 1].lon, w[i].lat, w[i].lon);
      for (let d = 0; d < len; d += 1) {
        const p = destinationPoint(w[i - 1].lat, w[i - 1].lon, d, brg);
        const sample: SimSample = { lat: p.lat, lon: p.lon, altMslFt: w[i].altFt, aglFt: 2000, headingTrueDeg: brg, groundSpeedKts: 450, iasKts: 450, vsFpm: 0, onGround: false, t: 0 };
        const progress = computeProgress(plan, sample, prevLeg);
        prevLeg = progress?.legIndex;
        now += 1000;
        const r = nextAlerts(s, { plan, sample, progress, nowMs: now, say });
        s = r.state;
        for (const al of r.alerts) if (al.kind === 'waypoint') spoken.push(al.text);
      }
    }
    expect(spoken.length).toBeGreaterThan(2);
    expect(spoken.some((t) => t.startsWith('low level entry'))).toBe(true);
    expect(spoken.some((t) => /turn (left|right), heading [a-z ]+/.test(t))).toBe(true);
    expect(spoken.some((t) => t.includes('I P foxtrot'))).toBe(true);
  });
});

describe('English voice', () => {
  const voices = [
    { lang: 'pl-PL', name: 'Microsoft Paulina', localService: true },
    { lang: 'en-GB', name: 'Microsoft George', localService: true },
    { lang: 'en-US', name: 'Microsoft Zira', localService: true },
    { lang: 'en-US', name: 'Online English', localService: false },
    { lang: 'de-DE', name: 'Microsoft Hedda', localService: true },
  ];

  it('picks US English first, then British, an installed voice before an online one, never another language', () => {
    expect(pickEnglishVoice(voices)?.name).toBe('Microsoft Zira');
    expect(pickEnglishVoice(voices.filter((v) => v.name !== 'Microsoft Zira'))?.name).toBe('Online English');
    expect(pickEnglishVoice(voices.filter((v) => v.lang === 'en-GB' || v.lang === 'pl-PL'))?.name).toBe('Microsoft George');
    expect(pickEnglishVoice([{ lang: 'en_AU', name: 'Australian' }])?.name).toBe('Australian');
    expect(pickEnglishVoice(voices.filter((v) => !v.lang.startsWith('en')))).toBe(null);
    expect(pickEnglishVoice([])).toBe(null);
    // "en" must not match other languages that start with the same letters
    expect(pickEnglishVoice([{ lang: 'enx-XX', name: 'odd' }])).toBe(null);
  });
});

describe('createSpeaker', () => {
  function fake(voiceList: Array<{ lang: string; name: string; localService?: boolean }> = [{ lang: 'en-US', name: 'Zira', localService: true }]) {
    const spoken: string[] = [];
    const utterances: any[] = [];
    let cancels = 0;
    const listeners: Array<() => void> = [];
    let list = voiceList;
    const synth = {
      speak: (u: any) => {
        spoken.push(u.text);
        utterances.push(u);
      },
      cancel: () => {
        cancels++;
      },
      getVoices: () => list,
      addEventListener: (_t: 'voiceschanged', l: () => void) => void listeners.push(l),
      removeEventListener: (_t: 'voiceschanged', l: () => void) => {
        listeners.splice(listeners.indexOf(l), 1);
      },
    };
    return {
      spoken, utterances, synth, cancels: () => cancels,
      setVoices: (v: typeof voiceList) => {
        list = v;
        listeners.slice().forEach((l) => l());
      },
      listenerCount: () => listeners.length,
    };
  }

  it('says that it is not available without a speech system', () => {
    const sp = createSpeaker(undefined, undefined);
    expect(sp.available).toBe(false);
    expect(sp.supported).toBe(false);
    expect(sp.speak('hello', 1)).toBe(false);
  });

  it('speaks with the English voice, in its language', () => {
    const f = fake([
      { lang: 'pl-PL', name: 'Paulina', localService: true },
      { lang: 'en-US', name: 'Zira', localService: true },
    ]);
    const sp = createSpeaker(f.synth, (text) => ({ text }));
    expect(sp.available).toBe(true);
    expect(sp.voiceName).toBe('Zira');
    expect(sp.speak('Low altitude, 1100 feet', 1)).toBe(true);
    expect(f.utterances[0].voice.name).toBe('Zira');
    expect(f.utterances[0].lang).toBe('en-US');
  });

  it('is silent, not wrong, when only voices of other languages are installed, and wakes up when an English one appears', () => {
    const f = fake([{ lang: 'pl-PL', name: 'Paulina', localService: true }]);
    const sp = createSpeaker(f.synth, (text) => ({ text }));
    let changes = 0;
    const stop = sp.subscribe(() => changes++);
    expect(sp.supported).toBe(true);
    expect(sp.available).toBe(false);
    expect(sp.voiceName).toBe(null);
    expect(sp.speak('Too low. Pull up.', 3)).toBe(false);
    expect(f.spoken).toEqual([]);
    // The voices load late
    f.setVoices([{ lang: 'pl-PL', name: 'Paulina' }, { lang: 'en-GB', name: 'George', localService: true }]);
    expect(changes).toBe(1);
    expect(sp.available).toBe(true);
    expect(sp.speak('Too low. Pull up.', 3)).toBe(true);
    stop();
    expect(f.listenerCount()).toBe(0);
  });

  it('drops an alert while the voice is busy, unless it is more urgent', () => {
    const f = fake();
    const sp = createSpeaker(f.synth, (text) => ({ text }));
    expect(sp.speak('first', 1)).toBe(true);
    expect(sp.speak('same level', 1)).toBe(false);
    expect(sp.speak('urgent', 3)).toBe(true);
    expect(f.cancels()).toBe(1);
    expect(f.spoken).toEqual(['first', 'urgent']);
    // The interrupted utterance reports its end late: it must not free the voice for the next one
    f.utterances[0].onend();
    expect(sp.speak('after', 2)).toBe(false);
    // The current one ends: the voice is free again
    f.utterances[1].onend();
    expect(sp.speak('after', 1)).toBe(true);
  });
});

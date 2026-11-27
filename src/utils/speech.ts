/**
 * Speaking the alerts with the voices of the system (the Web Speech API, which the Electron app has on Windows).
 *
 * Everything that is said is English: an English voice is chosen on purpose. Without that the system's default voice is
 * used, which on a Windows with another language reads English words and numbers in that language. When no English
 * voice is installed nothing is spoken (the Settings tell how to add one) rather than speaking with the wrong voice.
 *
 * One thing is spoken at a time: while the voice is busy a new alert is dropped unless it is more urgent, in which case
 * it interrupts.
 */

export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

export interface SpeechSynthLike {
  speak: (utterance: any) => void;
  cancel: () => void;
  getVoices?: () => VoiceLike[];
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
}

export interface Speaker {
  /** True when there is a speech system and an English voice to use. */
  available: boolean;
  /** Does the system have any speech at all (an English voice or not)? */
  supported: boolean;
  /** The voice that is used, if any. */
  voiceName: string | null;
  /** Returns true if the text was spoken (or is being spoken now). */
  speak: (text: string, priority: number) => boolean;
  cancel: () => void;
  /** Called when the list of voices of the system changes (they load late). Returns a function that stops listening. */
  subscribe: (listener: () => void) => () => void;
}

const isEnglish = (v: VoiceLike) => /^en([-_]|$)/i.test(v.lang);

/**
 * The English voice to use: US English first, then British, then any other English; a voice installed on the computer
 * before an online one. Null when there is none.
 */
export function pickEnglishVoice<T extends VoiceLike>(voices: T[]): T | null {
  const english = voices.filter(isEnglish);
  if (english.length === 0) return null;
  const rank = (v: VoiceLike) => {
    const lang = v.lang.replace('_', '-').toLowerCase();
    const region = lang === 'en-us' ? 0 : lang === 'en-gb' ? 1 : 2;
    return region * 2 + (v.localService === false ? 1 : 0);
  };
  return english.reduce((best, v) => (rank(v) < rank(best) ? v : best), english[0]);
}

export function createSpeaker(synth: SpeechSynthLike | undefined, makeUtterance: ((text: string) => any) | undefined): Speaker {
  if (!synth || !makeUtterance) {
    return { available: false, supported: false, voiceName: null, speak: () => false, cancel: () => {}, subscribe: () => () => {} };
  }
  let currentId = 0;
  let currentPriority = 0;
  let busy = false;

  const voice = () => pickEnglishVoice(synth.getVoices?.() ?? []);

  return {
    get available() {
      return voice() !== null;
    },
    supported: true,
    get voiceName() {
      return voice()?.name ?? null;
    },
    speak(text, priority) {
      const v = voice();
      // No English voice: better silent than read in the wrong language
      if (!v) return false;
      if (busy && priority <= currentPriority) return false;
      if (busy) synth.cancel();
      const id = ++currentId;
      const u = makeUtterance(text);
      u.voice = v;
      u.lang = v.lang;
      u.rate = 1.05;
      u.volume = 1;
      // An interrupted utterance reports its end late: only the newest one may clear the busy flag
      const done = () => {
        if (id === currentId) {
          busy = false;
          currentPriority = 0;
        }
      };
      u.onend = done;
      u.onerror = done;
      busy = true;
      currentPriority = priority;
      synth.speak(u);
      return true;
    },
    cancel() {
      currentId++;
      busy = false;
      currentPriority = 0;
      synth.cancel();
    },
    subscribe(listener) {
      synth.addEventListener?.('voiceschanged', listener);
      return () => synth.removeEventListener?.('voiceschanged', listener);
    },
  };
}

/** The speaker of the system, or one that says it is not available (browser without speech, tests). */
export function createSystemSpeaker(): Speaker {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : undefined;
  return createSpeaker(synth, Utterance ? (text) => new Utterance(text) : undefined);
}

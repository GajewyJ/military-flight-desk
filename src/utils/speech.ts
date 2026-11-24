/**
 * Speaking the alerts with the voices of the system (the Web Speech API, which the Electron app has on Windows).
 * One thing is spoken at a time: while the voice is busy a new alert is dropped unless it is more urgent, in which
 * case it interrupts.
 */

export interface SpeechSynthLike {
  speak: (utterance: any) => void;
  cancel: () => void;
}

export interface Speaker {
  /** False when the system has no speech voice. */
  available: boolean;
  /** Returns true if the text was spoken (or is being spoken now). */
  speak: (text: string, priority: number) => boolean;
  cancel: () => void;
}

export function createSpeaker(
  synth: SpeechSynthLike | undefined,
  makeUtterance: ((text: string) => any) | undefined,
  lang = 'en-US'
): Speaker {
  if (!synth || !makeUtterance) {
    return { available: false, speak: () => false, cancel: () => {} };
  }
  let currentId = 0;
  let currentPriority = 0;
  let busy = false;

  return {
    available: true,
    speak(text, priority) {
      if (busy && priority <= currentPriority) return false;
      if (busy) synth.cancel();
      const id = ++currentId;
      const u = makeUtterance(text);
      u.lang = lang;
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
  };
}

/** The speaker of the system, or one that says it is not available (browser without speech, tests). */
export function createSystemSpeaker(): Speaker {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : undefined;
  return createSpeaker(synth, Utterance ? (text) => new Utterance(text) : undefined);
}

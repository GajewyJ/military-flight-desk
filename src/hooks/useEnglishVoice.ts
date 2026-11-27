import { useEffect, useMemo, useState } from 'react';
import { createSystemSpeaker } from '../utils/speech';

/** Does this computer have an English voice for the spoken alerts, and which one is used? Follows the voices as they load. */
export function useEnglishVoice(): { supported: boolean; available: boolean; voiceName: string | null } {
  const speaker = useMemo(() => createSystemSpeaker(), []);
  const [, setVersion] = useState(0);
  useEffect(() => speaker.subscribe(() => setVersion((v) => v + 1)), [speaker]);
  return { supported: speaker.supported, available: speaker.available, voiceName: speaker.voiceName };
}

import { useCallback, useState } from 'react';
import { DEFAULT_UNITS, parseUnits, type Units } from '../utils/units';

export type Theme = 'day' | 'night';

/** Kneeboard PDF: in the colours of the theme, or black on white for printing. */
export type KneeboardStyle = 'theme' | 'print';

/** The simulator the Export button makes the flight plan for. */
export type Simulator = '2020' | '2024';

/** Everything the user can set in the Settings window. */
export interface Settings {
  theme: Theme;
  units: Units;
  kneeboard: KneeboardStyle;
  simulator: Simulator;
  /** Spoken alerts of the live link to the simulator (Windows app). */
  voiceAlerts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'day',
  units: DEFAULT_UNITS,
  kneeboard: 'theme',
  simulator: '2024',
  voiceAlerts: true,
};

const STORAGE_KEY = 'mfd.settings';

/** A fresh copy of the defaults (the units object included). */
function defaults(): Settings {
  return { ...DEFAULT_SETTINGS, units: { ...DEFAULT_UNITS } };
}

/** Reads saved settings; anything missing or invalid falls back to the defaults. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return defaults();
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>> | null;
    return {
      theme: data?.theme === 'night' ? 'night' : 'day',
      units: parseUnits(data?.units),
      kneeboard: data?.kneeboard === 'print' ? 'print' : 'theme',
      simulator: data?.simulator === '2020' ? '2020' : '2024',
      voiceAlerts: data?.voiceAlerts !== false,
    };
  } catch {
    return defaults();
  }
}

function load(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaults();
  }
}

/**
 * Saved user settings. A change is applied to the page at once (the theme is set on the
 * document before any component reads its colours) and stored for the next start.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      document.documentElement.setAttribute('data-theme', next.theme);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: the setting just is not remembered
      }
      return next;
    });
  }, []);

  return { settings, update };
}

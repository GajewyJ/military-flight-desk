import { useCallback, useState } from 'react';

export type Theme = 'day' | 'night';

/** Everything the user can set in the Settings window. For now that is the theme. */
export interface Settings {
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'day' };

const STORAGE_KEY = 'mfd.settings';

/** Reads saved settings; anything missing or invalid falls back to the defaults. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Partial<Settings> | null;
    return {
      theme: data?.theme === 'night' ? 'night' : 'day',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function load(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
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

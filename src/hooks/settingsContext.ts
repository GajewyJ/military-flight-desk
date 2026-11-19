import { createContext, useContext } from 'react';
import { DEFAULT_SETTINGS, type Settings } from './useSettings';

/** The saved settings, available to every component without passing them down. */
export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);

export function useSettingsValue(): Settings {
  return useContext(SettingsContext);
}

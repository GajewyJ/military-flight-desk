import { useSettingsValue } from './settingsContext';
import {
  altValue,
  convertText,
  distValue,
  formatAlt,
  formatDist,
  formatPressure,
  formatSpeed,
  speedValue,
  unitLabels,
  type Units,
} from '../utils/units';

/** The display units from the settings, with the helpers that format values in them. */
export function useUnits() {
  const { units } = useSettingsValue();
  return {
    units,
    labels: unitLabels(units),
    /** Converts the numbers with ft, kt, KIAS or NM inside a text. */
    text: (s: string) => convertText(s, units),
    alt: (ft: number) => formatAlt(ft, units),
    altValue: (ft: number) => altValue(ft, units),
    speed: (kts: number) => formatSpeed(kts, units),
    speedValue: (kts: number) => speedValue(kts, units),
    dist: (nm: number, decimals = 1) => formatDist(nm, units, decimals),
    distValue: (nm: number) => distValue(nm, units),
    pressure: (inHg: number, hPa: number) => formatPressure(inHg, hPa, units),
  } satisfies Record<string, unknown> & { units: Units };
}

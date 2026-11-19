/**
 * Display units. The flight plan, the exports for the sim and all the calculations stay in feet,
 * knots and nautical miles; these helpers only change what the user reads on screen and in the
 * kneeboard.
 */
export interface Units {
  altitude: 'ft' | 'm';
  speed: 'kt' | 'kmh';
  distance: 'nm' | 'km';
  pressure: 'inhg' | 'hpa';
}

export const DEFAULT_UNITS: Units = { altitude: 'ft', speed: 'kt', distance: 'nm', pressure: 'inhg' };

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;
const NM_TO_KM = 1.852;

export function isDefaultUnits(u: Units): boolean {
  return u.altitude === 'ft' && u.speed === 'kt' && u.distance === 'nm';
}

/** Reads saved units; anything missing or invalid falls back to the defaults. */
export function parseUnits(raw: unknown): Units {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Units, unknown>>;
  return {
    altitude: r.altitude === 'm' ? 'm' : 'ft',
    speed: r.speed === 'kmh' ? 'kmh' : 'kt',
    distance: r.distance === 'km' ? 'km' : 'nm',
    pressure: r.pressure === 'hpa' ? 'hpa' : 'inhg',
  };
}

/** Short names of the units, for column headings. */
export function unitLabels(u: Units): { alt: string; spd: string; dist: string; press: string } {
  return {
    alt: u.altitude === 'm' ? 'm' : 'ft',
    spd: u.speed === 'kmh' ? 'km/h' : 'kt',
    dist: u.distance === 'km' ? 'km' : 'NM',
    press: u.pressure === 'hpa' ? 'hPa' : 'inHg',
  };
}

const withCommas = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A height in feet as a number in the chosen unit (rounded). */
export function altValue(ft: number, u: Units): number {
  return u.altitude === 'm' ? Math.round(ft * FT_TO_M) : Math.round(ft);
}

/** A speed in knots as a number in the chosen unit (rounded). */
export function speedValue(kts: number, u: Units): number {
  return u.speed === 'kmh' ? Math.round(kts * KT_TO_KMH) : Math.round(kts);
}

/** A distance in nautical miles as a number in the chosen unit. */
export function distValue(nm: number, u: Units): number {
  return u.distance === 'km' ? nm * NM_TO_KM : nm;
}

export function formatAlt(ft: number, u: Units): string {
  return `${withCommas(altValue(ft, u))} ${unitLabels(u).alt}`;
}

export function formatSpeed(kts: number, u: Units): string {
  return `${withCommas(speedValue(kts, u))} ${unitLabels(u).spd}`;
}

export function formatDist(nm: number, u: Units, decimals = 1): string {
  return `${distValue(nm, u).toFixed(decimals)} ${unitLabels(u).dist}`;
}

/** Pressure from the inHg and hPa values of a report. */
export function formatPressure(inHg: number, hPa: number, u: Units): string {
  return u.pressure === 'hpa' ? `${Math.round(hPa)} hPa` : `${inHg.toFixed(2)} inHg`;
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const TEXT_RE = new RegExp(String.raw`(${NUM})(?:(\s*[–-]\s*)(${NUM}))?(\s*)(ft|KIAS|kt|NM)\b`, 'gi');

const toNumber = (s: string): number => Number(s.replace(/,/g, ''));

/**
 * Converts the numbers that are followed by ft, kt, KIAS or NM inside a sentence or a label, such
 * as "2,900 ft MSL (1,500 ft AGL)", "350 – 400 KIAS" or "35-300 NM from home".
 */
export function convertText(text: string, u: Units): string {
  if (!text || isDefaultUnits(u)) return text;
  return text.replace(TEXT_RE, (match, a: string, sep: string | undefined, b: string | undefined, space: string, unit: string) => {
    const kind = unit.toLowerCase();
    let conv: (n: number) => string;
    let label: string;
    if (kind === 'ft') {
      if (u.altitude !== 'm') return match;
      conv = (n) => withCommas(n * FT_TO_M);
      label = 'm';
    } else if (kind === 'kt' || kind === 'kias') {
      if (u.speed !== 'kmh') return match;
      conv = (n) => withCommas(n * KT_TO_KMH);
      label = 'km/h';
    } else {
      if (u.distance !== 'km') return match;
      conv = (n) => {
        const km = n * NM_TO_KM;
        return km < 10 ? km.toFixed(1) : withCommas(km);
      };
      label = 'km';
    }
    const first = conv(toNumber(a));
    const second = b !== undefined ? `${sep ?? '-'}${conv(toNumber(b))}` : '';
    return `${first}${second}${space}${label}`;
  });
}

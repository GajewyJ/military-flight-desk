import type { AirportWeather, FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';

/**
 * Weather and daylight check of a VFR sortie. It compares the METAR of the home field (and of the
 * Touch & Go field) and the sun with the plan: cloud base against the planned heights, visibility,
 * wind on the runway, and sunrise and sunset against the time of the sortie. It is a help for the
 * planner, not a weather briefing: the METAR describes the airfield, not the whole route.
 */

export type FindingLevel = 'alert' | 'warn' | 'info';

export interface Finding {
  level: FindingLevel;
  text: string;
}

export interface ParsedMetar {
  /** Visibility in km (10 means 10 km or more). Undefined when the report does not give one. */
  visibilityKm?: number;
  /** Lowest broken or overcast layer, or vertical visibility, in feet above the airfield. */
  ceilingFtAgl?: number;
  /** True when the report says what the sky is like (clouds, CAVOK, clear). */
  skyKnown: boolean;
}

const SM_TO_KM = 1.609344;

export function parseMetar(raw: string): ParsedMetar {
  const text = (raw || '').toUpperCase();
  const out: ParsedMetar = { skyKnown: false };

  if (/\bCAVOK\b/.test(text)) {
    out.visibilityKm = 10;
    out.skyKnown = true;
  } else {
    const sm = text.match(/\b(P|M)?(\d+(?: \d\/\d)?|\d\/\d)SM\b/);
    if (sm) {
      const parts = sm[2].split(' ');
      const frac = (s: string) => (s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s));
      out.visibilityKm = parts.reduce((sum, p) => sum + frac(p), 0) * SM_TO_KM;
    } else {
      const m = text.match(/(?:^|\s)(\d{4})(?:NDV)?(?=\s|$)/);
      if (m) out.visibilityKm = Number(m[1]) >= 9999 ? 10 : Number(m[1]) / 1000;
    }
  }

  if (/\b(NSC|NCD|SKC|CLR)\b/.test(text)) out.skyKnown = true;
  let ceiling: number | undefined;
  for (const m of text.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})/g)) {
    out.skyKnown = true;
    if (m[1] === 'BKN' || m[1] === 'OVC') {
      const ft = Number(m[2]) * 100;
      ceiling = ceiling === undefined ? ft : Math.min(ceiling, ft);
    }
  }
  const vv = text.match(/\bVV(\d{3})\b/);
  if (vv) {
    out.skyKnown = true;
    const ft = Number(vv[1]) * 100;
    ceiling = ceiling === undefined ? ft : Math.min(ceiling, ft);
  }
  out.ceilingFtAgl = ceiling;
  return out;
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Set when the sun does not rise or does not set at this latitude on this day. */
  polar?: 'day' | 'night';
}

/** Sunrise and sunset (NOAA formulas, 0.833° below the horizon) around the local solar noon nearest to `date`. */
export function sunTimes(lat: number, lon: number, date: Date): SunTimes {
  const rad = Math.PI / 180;
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // Local solar noon (UTC) nearest to the given time
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let noon = midnight + (720 - 4 * lon - eqTime) * 60_000;
  if (noon - date.getTime() > 12 * 3_600_000) noon -= 86_400_000;
  else if (date.getTime() - noon > 12 * 3_600_000) noon += 86_400_000;

  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const haMin = (Math.acos(cosHa) / rad) * 4;
  return { sunrise: new Date(noon - haMin * 60_000), sunset: new Date(noon + haMin * 60_000) };
}

const formatZ = (d: Date): string =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Height above ground in feet from a label such as "2,900 ft MSL (1,500 ft AGL)". */
function aglOf(wp: FlightWaypoint): number | undefined {
  const m = wp.altDisplay.match(/\(([\d,]+) ft AGL\)/);
  return m ? Number(m[1].replace(/,/g, '')) : wp.aglFt;
}

const LOW_LEVEL_TYPES = new Set(['CHECKPOINT', 'MTR_ENTRY', 'IP', 'RANGE', 'DROP', 'TNG', 'RECOVERY']);

/** Highest planned height above ground on the low-level part, and over the whole route. */
function routeTops(plan: GeneratedFlightPlan): { lowLevel: number; all: number } {
  let lowLevel = 0;
  let all = 0;
  for (const wp of plan.waypoints) {
    const agl = aglOf(wp);
    if (agl === undefined) continue;
    all = Math.max(all, agl);
    if (LOW_LEVEL_TYPES.has(wp.type)) lowLevel = Math.max(lowLevel, agl);
  }
  return { lowLevel, all: Math.max(all, lowLevel) };
}

function checkAirfield(
  ident: string,
  w: AirportWeather,
  tops: { lowLevel: number; all: number },
  out: Finding[]
): void {
  if (w.source === 'STANDARD_ISA') {
    out.push({ level: 'info', text: `${ident}: neutral weather (standard atmosphere, calm), so the weather is not checked.` });
    return;
  }

  if (w.flightCategory === 'IFR' || w.flightCategory === 'LIFR') {
    out.push({ level: 'alert', text: `${ident}: the report is ${w.flightCategory}, below the minimums for VFR.` });
  } else if (w.flightCategory === 'MVFR') {
    out.push({ level: 'warn', text: `${ident}: marginal VFR (MVFR). Watch the cloud base and the visibility.` });
  }

  const m = parseMetar(w.rawMetar);
  if (m.visibilityKm !== undefined) {
    if (m.visibilityKm < 5) {
      out.push({ level: 'alert', text: `${ident}: visibility ${m.visibilityKm.toFixed(1)} km is below the 5 km needed for VFR.` });
    } else if (m.visibilityKm < 8) {
      out.push({ level: 'warn', text: `${ident}: visibility ${m.visibilityKm.toFixed(1)} km is low for fast low-level flying (8 km or more is comfortable).` });
    }
  }

  if (m.ceilingFtAgl !== undefined) {
    const ceiling = m.ceilingFtAgl;
    if (ceiling < 1000) {
      out.push({ level: 'alert', text: `${ident}: cloud base ${fmt(ceiling)} ft is below 1,000 ft, not a VFR day.` });
    } else if (ceiling < tops.lowLevel + 500) {
      out.push({
        level: 'alert',
        text: `${ident}: cloud base ${fmt(ceiling)} ft is lower than the planned ${fmt(tops.lowLevel)} ft plus 500 ft. The route would not stay clear of cloud.`,
      });
    } else if (ceiling < tops.all + 500) {
      out.push({
        level: 'warn',
        text: `${ident}: cloud base ${fmt(ceiling)} ft is lower than the climb to ${fmt(tops.all)} ft later in the sortie. Stay lower on the return.`,
      });
    } else if (ceiling < tops.lowLevel + 1500) {
      out.push({ level: 'warn', text: `${ident}: cloud base ${fmt(ceiling)} ft leaves little room above the planned ${fmt(tops.lowLevel)} ft.` });
    }
  } else if (!m.skyKnown) {
    out.push({ level: 'info', text: `${ident}: this report gives no cloud base, so the cloud is not checked.` });
  }

  if (!w.isCalm) {
    const xw = Math.abs(w.crosswindKts);
    if (xw >= 25) out.push({ level: 'alert', text: `${ident}: crosswind ${fmt(xw)} kt on runway ${w.activeRunway.replace(/^RWY\s*/i, '')} is too strong.` });
    else if (xw >= 15) out.push({ level: 'warn', text: `${ident}: crosswind ${fmt(xw)} kt on runway ${w.activeRunway.replace(/^RWY\s*/i, '')}.` });

    if (w.headwindKts <= -10) out.push({ level: 'alert', text: `${ident}: tailwind ${fmt(-w.headwindKts)} kt on the active runway.` });
    else if (w.headwindKts <= -5) out.push({ level: 'warn', text: `${ident}: tailwind ${fmt(-w.headwindKts)} kt on the active runway.` });

    if (w.windGustKts && w.windGustKts >= 25) out.push({ level: 'warn', text: `${ident}: gusts to ${fmt(w.windGustKts)} kt.` });
  }
}

/**
 * Checks a VFR plan against the weather and the daylight. `now` is the time of the sortie
 * (the computer clock); the sortie is taken to last the planned flight time plus 10 minutes
 * for start-up and taxi. For other flight rules the check does not apply (IFR comes later).
 */
export function checkVfr(plan: GeneratedFlightPlan, now: Date = new Date()): Finding[] {
  if (plan.flightRules !== 'VFR') return [];
  const out: Finding[] = [];
  const tops = routeTops(plan);

  if (plan.departureWeather) checkAirfield(plan.operatingAirbase.ident, plan.departureWeather, tops, out);
  if (plan.tngWeather && plan.tngAirbase && plan.tngAirbase.ident !== plan.operatingAirbase.ident) {
    checkAirfield(plan.tngAirbase.ident, plan.tngWeather, tops, out);
  }

  // Daylight at the home field
  const home = plan.operatingAirbase;
  const sun = sunTimes(home.latitude, home.longitude, now);
  const end = new Date(now.getTime() + (plan.totalFlightTimeMin + 10) * 60_000);
  if (sun.polar === 'night') {
    out.push({ level: 'alert', text: `${home.ident}: the sun does not rise today. It is dark all day.` });
  } else if (sun.polar === 'day') {
    out.push({ level: 'info', text: `${home.ident}: the sun does not set today.` });
  } else if (sun.sunrise && sun.sunset) {
    const rise = formatZ(sun.sunrise);
    const set = formatZ(sun.sunset);
    if (now < sun.sunrise || now > sun.sunset) {
      out.push({ level: 'alert', text: `It is night at ${home.ident} now (sunrise ${rise}, sunset ${set}). VFR low-level flying needs daylight.` });
    } else if (end > sun.sunset) {
      out.push({ level: 'alert', text: `The sortie would end about ${formatZ(end)}, after sunset at ${set}.` });
    } else if (end.getTime() > sun.sunset.getTime() - 30 * 60_000) {
      out.push({ level: 'warn', text: `Sunset is at ${set} and the sortie ends about ${formatZ(end)}: less than 30 minutes of daylight left.` });
    } else {
      out.push({ level: 'info', text: `Daylight at ${home.ident}: sunrise ${rise}, sunset ${set}. The sortie ends about ${formatZ(end)}.` });
    }
  }

  const rank: Record<FindingLevel, number> = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

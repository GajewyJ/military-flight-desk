import { AtisReport } from '../types/flightDesk';
import { fetchWithTimeout } from './http';

interface CachedAtis {
  report: AtisReport | null;
  timestamp: number;
}

const atisCache = new Map<string, CachedAtis>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// VATSIM ATIS full list cache
let vatsimAtisListCache: Array<{
  callsign: string;
  frequency?: string;
  atis_code?: string;
  text_atis?: string[];
  last_updated?: string;
}> | null = null;
let vatsimAtisListTime = 0;

/**
 * Extracts active departure and arrival runways from raw ATIS broadcast text.
 */
export function parseAtisRunways(text: string): {
  depRunways: string[];
  arrRunways: string[];
  allRunways: string[];
} {
  const clean = text.toUpperCase();
  const depRunways: string[] = [];
  const arrRunways: string[] = [];
  const allRunways: string[] = [];

  const addUnique = (arr: string[], item: string) => {
    const formatted = item.trim();
    if (formatted && !arr.includes(formatted)) {
      arr.push(formatted);
    }
    if (formatted && !allRunways.includes(formatted)) {
      allRunways.push(formatted);
    }
  };

  // Departure runways regex
  const depRegex =
    /(?:DEPG|DEP|DEPARTING|DEPARTURES?)\s+(?:RY|RWY|RUNWAY|RUNWAYS)?\s*([0-9]{1,2}[LRC]?)(?:\s*(?:AND|&|,|\/)\s*([0-9]{1,2}[LRC]?))?/gi;
  let m: RegExpExecArray | null;
  while ((m = depRegex.exec(clean)) !== null) {
    if (m[1]) addUnique(depRunways, m[1]);
    if (m[2]) addUnique(depRunways, m[2]);
  }

  // Arrival / Approach runways regex
  const arrRegex =
    /(?:ARR|ARRIVALS?|LANDING|APPROACH(?:ES)?|APCH|ILS|VISUAL|EXP(?:ECT)?)\s+(?:IN USE\s+)?(?:(?:RY|RWY|RUNWAY|RUNWAYS|NAV\s+ILS\s+[A-Z]|VIS\s+APCH)\s*)?([0-9]{1,2}[LRC]?)(?:\s*(?:AND|&|,|\/)\s*([0-9]{1,2}[LRC]?))?/gi;
  while ((m = arrRegex.exec(clean)) !== null) {
    // Avoid matching wind directions like "WIND 240/04KTS"
    const prefix = clean.slice(Math.max(0, m.index - 8), m.index);
    if (!prefix.includes('WIND') && !prefix.includes('TDZ')) {
      if (m[1]) addUnique(arrRunways, m[1]);
      if (m[2]) addUnique(arrRunways, m[2]);
    }
  }

  // General "RWY IN USE" or "ACTIVE RUNWAYS"
  const genRegex =
    /(?:RWY|RUNWAY|RY)\s*(?:IN USE|ACTIVE)?\s*([0-9]{1,2}[LRC]?)(?:\s*(?:AND|&|,|\/)\s*([0-9]{1,2}[LRC]?))?/gi;
  while ((m = genRegex.exec(clean)) !== null) {
    const prefix = clean.slice(Math.max(0, m.index - 8), m.index);
    if (!prefix.includes('WIND') && !prefix.includes('TDZ')) {
      if (m[1]) addUnique(allRunways, m[1]);
      if (m[2]) addUnique(allRunways, m[2]);
    }
  }

  return { depRunways, arrRunways, allRunways };
}

/**
 * Extracts the single-letter ATIS code (e.g. "INFO J", "ATIS INFO BRAVO", "ATIS G").
 */
export function extractAtisLetter(rawText: string): string {
  const match = rawText.match(/\b(?:ATIS|INFO(?:RMATION)?)\s+([A-Z])\b/i);
  if (match) return match[1].toUpperCase();

  const codeMatch = rawText.match(/\bINFO\s+([A-Z]{3,10})\b/i);
  if (codeMatch) return codeMatch[1].toUpperCase();

  return 'LIVE';
}

/**
 * Fetches real-world live ATIS for an airport:
 * 1. FAA Digital ATIS (D-ATIS) for US airfields via datis.clowd.io
 * 2. VATSIM global live ATIS feed via data.vatsim.net
 */
export async function fetchLiveAtis(icao: string): Promise<AtisReport | null> {
  const cleanIcao = icao.trim().toUpperCase();
  if (cleanIcao.length < 3) return null;

  const now = Date.now();
  const cached = atisCache.get(cleanIcao);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.report;
  }

  // 1. Check FAA D-ATIS for US ICAO codes (e.g. KJFK, KLSV, KEDW, KSAN, etc.)
  if (cleanIcao.startsWith('K') || cleanIcao.startsWith('P') || cleanIcao.startsWith('T')) {
    try {
      const datisRes = await fetchWithTimeout(`https://datis.clowd.io/api/${cleanIcao}`, {
        headers: { Accept: 'application/json' },
      });

      if (datisRes.ok) {
        const data = await datisRes.json();
        if (Array.isArray(data) && data.length > 0) {
          // Find arrival or combined ATIS
          const item =
            data.find((d: Record<string, unknown>) => d.type === 'arr' || d.type === 'combined') || data[0];

          if (item && item.datis) {
            const raw = String(item.datis);
            const { depRunways, arrRunways } = parseAtisRunways(raw);
            const code = String(item.code || extractAtisLetter(raw));

            const report: AtisReport = {
              icao: cleanIcao,
              code: code.toUpperCase(),
              type: item.type === 'dep' ? 'DEP' : item.type === 'arr' ? 'ARR' : 'COMBINED',
              source: 'FAA_DATIS',
              rawText: raw,
              depRunways,
              arrRunways,
              updatedTime: item.updatedAt ? String(item.updatedAt) : undefined,
            };

            atisCache.set(cleanIcao, { report, timestamp: now });
            return report;
          }
        }
      }
    } catch {
      // Proceed to VATSIM check
    }
  }

  // 2. Check VATSIM Global ATIS feed (covers worldwide airports: EGLL, LFPG, EDDF, EYVI, etc.)
  try {
    if (!vatsimAtisListCache || now - vatsimAtisListTime > 30 * 1000) {
      const vatsimRes = await fetchWithTimeout('https://data.vatsim.net/v3/afv-atis-data.json');
      if (vatsimRes.ok) {
        vatsimAtisListCache = await vatsimRes.json();
        vatsimAtisListTime = now;
      }
    }

    if (vatsimAtisListCache && Array.isArray(vatsimAtisListCache)) {
      // Match by callsign prefix e.g. "EGLL_ATIS", "EGLL_A_ATIS", "EYVI_ATIS"
      const match = vatsimAtisListCache.find(
        (entry) =>
          entry.callsign &&
          (entry.callsign.startsWith(`${cleanIcao}_`) || entry.callsign.startsWith(cleanIcao))
      );

      if (match && match.text_atis && match.text_atis.length > 0) {
        const fullText = match.text_atis.join(' ');
        const { depRunways, arrRunways } = parseAtisRunways(fullText);
        const code = (match.atis_code || extractAtisLetter(fullText)).toUpperCase();

        const report: AtisReport = {
          icao: cleanIcao,
          code,
          frequency: match.frequency ? `${match.frequency} MHz` : undefined,
          type: 'COMBINED',
          source: 'VATSIM_ATIS',
          rawText: fullText,
          depRunways,
          arrRunways,
          updatedTime: match.last_updated,
        };

        atisCache.set(cleanIcao, { report, timestamp: now });
        return report;
      }
    }
  } catch (err) {
    console.warn(`[ATIS] VATSIM ATIS lookup failed for ${cleanIcao}:`, err);
  }

  // No active digital ATIS broadcast found
  atisCache.set(cleanIcao, { report: null, timestamp: now });
  return null;
}

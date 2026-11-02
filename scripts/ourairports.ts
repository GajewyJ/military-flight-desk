/**
 * Pure conversion helpers: OurAirports CSV data (public domain) -> the JSON files used by the app.
 * Data source: https://ourairports.com/data/
 */

export type CsvRow = Record<string, string>;

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(input: string): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift() ?? [];
  return rows.map((r) => {
    const o: CsvRow = {};
    header.forEach((h, i) => {
      o[h] = r[i] ?? '';
    });
    return o;
  });
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "5.2° East" / "3.1° West" (the format the app already uses). */
export function formatMagDecl(decl: number): string {
  return `${Math.abs(decl).toFixed(1)}° ${decl >= 0 ? 'East' : 'West'}`;
}

/** Name-based hint that an airfield is military (OurAirports has no military flag). */
export function looksMilitary(name: string): boolean {
  const n = ` ${name.toLowerCase()} `;
  return (
    /\bair ?base\b/.test(n) ||
    /\bafb\b/.test(n) ||
    /\braf\b/.test(n) ||
    /\bair station\b/.test(n) ||
    /\bnaval air\b/.test(n) ||
    /\bmilitary\b/.test(n) ||
    /\barmy (air|heli)/.test(n) ||
    /\bmcas\b|\bnas\b|\baaf\b/.test(n) ||
    /\btactical\b/.test(n)
  );
}

export interface RunwayRecord {
  le: string;
  he: string;
  leHdg?: number;
  heHdg?: number;
  len?: number;
  width?: number;
  surface?: string;
}

/** Open runways per airport ident, longest first. Closed runways are skipped. */
export function buildRunways(rows: CsvRow[]): Record<string, RunwayRecord[]> {
  const out: Record<string, RunwayRecord[]> = {};
  for (const r of rows) {
    if (r.closed === '1') continue;
    const ident = (r.airport_ident || '').trim().toUpperCase();
    const le = (r.le_ident || '').trim();
    const he = (r.he_ident || '').trim();
    if (!ident || (!le && !he)) continue;
    const rec: RunwayRecord = { le, he };
    const leHdg = num(r.le_heading_degT);
    const heHdg = num(r.he_heading_degT);
    const len = num(r.length_ft);
    const width = num(r.width_ft);
    if (leHdg !== undefined) rec.leHdg = leHdg;
    if (heHdg !== undefined) rec.heHdg = heHdg;
    if (len !== undefined) rec.len = len;
    if (width !== undefined) rec.width = width;
    if (r.surface) rec.surface = r.surface.trim();
    (out[ident] ||= []).push(rec);
  }
  for (const list of Object.values(out)) list.sort((a, b) => (b.len ?? 0) - (a.len ?? 0));
  return out;
}

export interface BuiltAirport {
  ident: string;
  name: string;
  city?: string;
  stateOrProvince?: string;
  countryOrAreaCode?: string;
  elevationFt: number;
  magDecl?: string;
  towerMhz?: string;
  longestRunwayFt?: number;
  latitude: number;
  longitude: number;
  military: boolean;
}

export const INCLUDED_TYPES = ['large_airport', 'medium_airport', 'small_airport'];

/** Builds the app's airports.json rows. `declination(lat, lon)` returns degrees east, or undefined. */
export function buildAirports(
  airportRows: CsvRow[],
  runways: Record<string, RunwayRecord[]>,
  frequencyRows: CsvRow[],
  declination: (lat: number, lon: number) => number | undefined
): BuiltAirport[] {
  const tower = new Map<string, string>();
  for (const f of frequencyRows) {
    const ident = (f.airport_ident || '').trim().toUpperCase();
    const mhz = num(f.frequency_mhz);
    if (!ident || mhz === undefined) continue;
    const type = (f.type || '').toUpperCase();
    if (type === 'TWR' && !tower.has(ident)) tower.set(ident, mhz.toFixed(3));
  }
  // CTAF as a fallback for fields without a tower
  for (const f of frequencyRows) {
    const ident = (f.airport_ident || '').trim().toUpperCase();
    const mhz = num(f.frequency_mhz);
    if (!ident || mhz === undefined || tower.has(ident)) continue;
    if ((f.type || '').toUpperCase() === 'CTAF') tower.set(ident, mhz.toFixed(3));
  }

  const seen = new Set<string>();
  const out: BuiltAirport[] = [];
  for (const r of airportRows) {
    if (!INCLUDED_TYPES.includes(r.type)) continue;
    const ident = (r.ident || '').trim().toUpperCase();
    const lat = num(r.latitude_deg);
    const lon = num(r.longitude_deg);
    if (!ident || ident.length < 2 || ident.length > 6 || lat === undefined || lon === undefined) continue;
    if (seen.has(ident)) continue;
    seen.add(ident);

    const name = (r.name || `${ident} Airfield`).trim();
    const rwys = runways[ident];
    const longest = rwys && rwys.length > 0 ? Math.max(...rwys.map((x) => x.len ?? 0)) : 0;
    const decl = declination(lat, lon);

    const a: BuiltAirport = {
      ident,
      name,
      elevationFt: Math.round(num(r.elevation_ft) ?? 0),
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      military: looksMilitary(name),
    };
    if (r.municipality) a.city = r.municipality.trim();
    if (r.iso_region) a.stateOrProvince = r.iso_region.trim();
    if (r.iso_country) a.countryOrAreaCode = r.iso_country.trim();
    if (decl !== undefined) a.magDecl = formatMagDecl(decl);
    const twr = tower.get(ident);
    if (twr) a.towerMhz = twr;
    if (longest > 0) a.longestRunwayFt = Math.round(longest);
    out.push(a);
  }
  out.sort((x, y) => (x.ident < y.ident ? -1 : x.ident > y.ident ? 1 : 0));
  return out;
}

/** Drops runway rows of airports that are not in the airport list (heliports, seaplane bases, closed fields). */
export function keepRunwaysFor(
  runways: Record<string, RunwayRecord[]>,
  airports: { ident: string }[]
): Record<string, RunwayRecord[]> {
  const idents = new Set(airports.map((a) => a.ident));
  const out: Record<string, RunwayRecord[]> = {};
  for (const [ident, list] of Object.entries(runways)) {
    if (idents.has(ident)) out[ident] = list;
  }
  return out;
}

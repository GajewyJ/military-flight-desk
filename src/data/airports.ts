import { Airport } from '../types/flightDesk';

// In-memory global MSFS database (loaded statically from /public/airports.json, /public/airports.csv, or IndexedDB)
let globalAirportsList: Airport[] = [];
const globalMap = new Map<string, Airport>();
let isDatabaseLoaded = false;
let isDatabaseLoading = false;

function rebuildGlobalIndex() {
  globalMap.clear();
  for (const a of globalAirportsList) {
    globalMap.set(a.ident.toUpperCase(), a);
    if (a.icao && a.icao !== a.ident) {
      globalMap.set(a.icao.toUpperCase(), a);
    }
  }
}

// --- Native IndexedDB helper for persisting huge airport databases locally ---
const DB_NAME = 'MSFS_MIL_FLIGHT_DESK';
const STORE_NAME = 'airports_store';
const STORAGE_KEY = 'static_airports_raw';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToIndexedDb(dataText: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dataText, STORAGE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Could not cache airports to IndexedDB:', e);
  }
}

async function getFromIndexedDb(): Promise<string | null> {
  try {
    const db = await openDatabase();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STORAGE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// In-memory registry for Real Physical Runways (loaded from /public/runways.json)
export interface RawRunwayItem {
  le: string;
  he: string;
  leHdg?: number;
  heHdg?: number;
  len?: number;
  width?: number;
  surface?: string;
}

let runwaysDatabaseMap: Record<string, RawRunwayItem[]> = {};
let runwaysDatabaseLoaded = false;

export async function loadRunwaysDatabase(): Promise<boolean> {
  if (runwaysDatabaseLoaded) return true;
  try {
    const res = await fetch('./runways.json');
    if (res.ok) {
      runwaysDatabaseMap = await res.json();
      runwaysDatabaseLoaded = true;
      return true;
    }
  } catch (e) {
    console.warn('Failed to load runways.json:', e);
  }
  return false;
}

export function getAirportRealRunways(ident: string): RawRunwayItem[] | undefined {
  if (!ident) return undefined;
  const clean = ident.trim().toUpperCase();
  return runwaysDatabaseMap[clean];
}

// Initial bootstrap trigger for the runways database
loadRunwaysDatabase();

/**
 * Parses MSFS airports from a JSON array.
 * Supports both camelCase keys (ident, name, elevationFt, etc.)
 * AND original CSV/bgl column titles (Ident, Name, Elevation ft, Longest Runway Length ft, etc.)
 */
export function loadAirportsFromJson(
  items: Record<string, unknown>[],
  persistToStorage = true
): { count: number; error?: string } {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { count: 0, error: 'JSON does not contain an array of airport objects.' };
    }

    const parsed: Airport[] = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      if (!row || typeof row !== 'object') continue;

      // Match ident/icao across variations
      const identRaw = (row.ident || row.Ident || row.icao || row.ICAO || row.code || row.Code) as string;
      if (!identRaw || typeof identRaw !== 'string') continue;
      const ident = identRaw.trim().toUpperCase();
      if (ident.length < 2 || ident.length > 6) continue;

      const name = ((row.name || row.Name || row.airport_name || `${ident} Airfield`) as string).trim();
      const city = ((row.city || row.City || row.municipality || '') as string).trim() || undefined;
      const stateOrProvince = ((row.stateOrProvince || row['State or Province'] || row.state || row.State || '') as string).trim() || undefined;
      const countryOrAreaCode = ((row.countryOrAreaCode || row['Country or Area Code'] || row.country || row.Country || '') as string).trim() || undefined;
      const rating = ((row.rating || row.Rating || '') as string).trim() || undefined;

      const elevRaw = row.elevationFt ?? row['Elevation ft'] ?? row.elevation ?? row.alt ?? 0;
      const elevationFt = typeof elevRaw === 'number' ? elevRaw : parseFloat(String(elevRaw).replace(/[^0-9.-]/g, '')) || 0;

      const magDecl = ((row.magDecl || row['Mag. Decl.°'] || row['Mag. Decl.'] || '') as string).trim() || undefined;
      const towerMhz = ((row.towerMhz || row['Tower MHz'] || row.tower || '') as string).trim() || undefined;
      const largestRamp = ((row.largestRamp || row['Largest Ramp'] || row.ramp || '') as string).trim() || undefined;
      const largestGate = ((row.largestGate || row['Largest Gate'] || '') as string).trim() || undefined;

      const rwyRaw = row.longestRunwayFt ?? row['Longest Runway Length ft'] ?? row.runway ?? row.runwayLength;
      const longestRunwayFt = typeof rwyRaw === 'number' ? rwyRaw : rwyRaw ? parseFloat(String(rwyRaw).replace(/[^0-9.-]/g, '')) || undefined : undefined;

      const files = ((row.files || row.Files || row.file || '') as string).trim() || undefined;

      const lonRaw = row.longitude ?? row.Longitude ?? row.lon ?? row.Lon ?? 0;
      const latRaw = row.latitude ?? row.Latitude ?? row.lat ?? row.Lat ?? 0;
      const lon = typeof lonRaw === 'number' ? lonRaw : parseFloat(String(lonRaw)) || 0;
      const lat = typeof latRaw === 'number' ? latRaw : parseFloat(String(latRaw)) || 0;

      const lowerName = name.toLowerCase();
      const military =
        Boolean(row.military) ||
        lowerName.includes('afb') ||
        lowerName.includes('air base') ||
        lowerName.includes('air station') ||
        lowerName.includes('raf ') ||
        lowerName.includes('base') ||
        lowerName.includes('tactical') ||
        lowerName.includes('naval air') ||
        (largestRamp?.toLowerCase().includes('mil') ?? false);

      parsed.push({
        ident,
        icao: ident,
        name,
        city,
        stateOrProvince,
        countryOrAreaCode,
        rating,
        elevationFt: isNaN(elevationFt) ? 0 : elevationFt,
        magDecl,
        towerMhz,
        largestRamp,
        largestGate,
        longestRunwayFt,
        files,
        longitude: isNaN(lon) ? 0 : lon,
        latitude: isNaN(lat) ? 0 : lat,
        military,
      });
    }

    if (parsed.length > 0) {
      globalAirportsList = parsed;
      rebuildGlobalIndex();
      isDatabaseLoaded = true;

      if (persistToStorage) {
        saveToIndexedDb(JSON.stringify(items));
      }

      return { count: parsed.length };
    }

    return { count: 0, error: 'No valid airport objects were identified in the JSON array.' };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown JSON parsing error' };
  }
}

/**
 * Searches the airport database (airports.json) by ICAO code prefix.
 */
export function searchAirports(rawQuery: string, maxResults = 8): Airport[] {
  const query = rawQuery.trim().toUpperCase();
  if (!query) {
    return [];
  }

  const matches: Airport[] = [];

  for (let i = 0; i < globalAirportsList.length; i++) {
    const apt = globalAirportsList[i];
    if (apt.ident.toUpperCase().startsWith(query)) {
      matches.push(apt);
      if (matches.length >= maxResults * 2) break;
    }
  }

  // Rank matches: exact ident > startsWith ident > longest runway
  return matches
    .sort((a, b) => {
      const aIdent = a.ident.toUpperCase();
      const bIdent = b.ident.toUpperCase();

      if (aIdent === query) return -1;
      if (bIdent === query) return 1;

      const aStarts = aIdent.startsWith(query);
      const bStarts = bIdent.startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      const aRwy = a.longestRunwayFt || 0;
      const bRwy = b.longestRunwayFt || 0;
      if (aRwy !== bRwy) return bRwy - aRwy;

      return aIdent.localeCompare(bIdent);
    })
    .slice(0, maxResults);
}

/**
 * Looks up an airport by ICAO code in the global database and fills in runway data.
 */
export function getAirportByIcao(rawCode: string): Airport | undefined {
  if (!rawCode) return undefined;
  const code = rawCode.trim().toUpperCase();

  const apt = globalMap.get(code);
  if (apt) {
    if (!apt.runwayDesignator) {
      const realRwys = getAirportRealRunways(code);
      if (realRwys && realRwys.length > 0) {
        const desigs = realRwys.map((r) => (r.he ? `${r.le}/${r.he}` : r.le)).filter(Boolean);
        apt.runwayDesignator = desigs.join(', ');
        const maxLen = Math.max(...realRwys.map((r) => r.len || 0));
        if (maxLen > 0 && (!apt.longestRunwayFt || maxLen > apt.longestRunwayFt)) {
          apt.longestRunwayFt = maxLen;
        }
      }
    }
    return apt;
  }

  return undefined;
}

/**
 * Automatically initializes both static databases on startup:
 * 1. Real runways database from /public/runways.json
 * 2. Big JSON database from /public/airports.json (or fallback /airports.csv or IndexedDB)
 */
export async function initStaticCsv(): Promise<{ count: number; loaded: boolean; source?: string }> {
  // Ensure the real runways database is loaded
  await loadRunwaysDatabase();

  if (isDatabaseLoaded) {
    return { count: globalAirportsList.length, loaded: true, source: 'memory' };
  }
  if (isDatabaseLoading) {
    return { count: 0, loaded: false };
  }

  try {
    isDatabaseLoading = true;

    // 1. Try public static JSON file ./airports.json (Preferred)
    try {
      const jsonRes = await fetch('./airports.json', { method: 'GET' });
      if (jsonRes.ok) {
        const jsonData = await jsonRes.json();
        if (Array.isArray(jsonData) && jsonData.length > 0) {
          const result = loadAirportsFromJson(jsonData, false);
          isDatabaseLoading = false;
          if (result.count > 0) {
            isDatabaseLoaded = true;
            return { count: result.count, loaded: true, source: 'public/airports.json' };
          }
        }
      }
    } catch {
      // Continue to CSV or IndexedDB
    }

    // 2. Try IndexedDB persistent storage
    const cachedText = await getFromIndexedDb();
    if (cachedText) {
      if (cachedText.trim().startsWith('[') || cachedText.trim().startsWith('{')) {
        try {
          const parsedJson = JSON.parse(cachedText);
          const result = loadAirportsFromJson(parsedJson, false);
          isDatabaseLoading = false;
          if (result.count > 0) {
            isDatabaseLoaded = true;
            return { count: result.count, loaded: true, source: 'local_storage_json' };
          }
        } catch {
          // fallback to CSV parsing
        }
      }

      const result = loadAirportsFromCsv(cachedText, false);
      isDatabaseLoading = false;
      if (result.count > 0) {
        isDatabaseLoaded = true;
        return { count: result.count, loaded: true, source: 'local_storage_csv' };
      }
    }

    isDatabaseLoading = false;
    return { count: 0, loaded: false };
  } catch {
    isDatabaseLoading = false;
    return { count: 0, loaded: false };
  }
}

/**
 * Universal file loader: accepts raw text (JSON or CSV)
 */
export function loadAirportsFromAnyText(
  rawText: string,
  persistToStorage = true
): { count: number; error?: string } {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : Object.values(parsed);
      return loadAirportsFromJson(arr as Record<string, unknown>[], persistToStorage);
    } catch (e) {
      return { count: 0, error: 'Invalid JSON file: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  return loadAirportsFromCsv(trimmed, persistToStorage);
}

/**
 * Parses user MSFS CSV export matching exact columns shown in MSFS bgl dump
 */
export function loadAirportsFromCsv(
  csvText: string,
  persistToStorage = true
): { count: number; error?: string } {
  try {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return { count: 0, error: 'CSV file is empty or missing data rows.' };
    }

    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

    const header = firstLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

    const identIdx = header.findIndex((h) => h === 'ident' || h === 'icao' || h === 'code');
    const nameIdx = header.findIndex((h) => h === 'name' || h === 'airport_name');
    const cityIdx = header.findIndex((h) => h === 'city' || h === 'municipality');
    const stateIdx = header.findIndex((h) => h === 'state or province' || h === 'state' || h === 'province');
    const countryIdx = header.findIndex((h) => h === 'country or area code' || h === 'country' || h === 'iso_country');
    const ratingIdx = header.findIndex((h) => h === 'rating');
    const elevIdx = header.findIndex((h) => h === 'elevation ft' || h === 'elevation' || h === 'alt' || h === 'elev');
    const magDeclIdx = header.findIndex((h) => h.includes('mag') || h.includes('decl'));
    const towerIdx = header.findIndex((h) => h.includes('tower'));
    const rampIdx = header.findIndex((h) => h.includes('ramp'));
    const gateIdx = header.findIndex((h) => h.includes('gate'));
    const rwyIdx = header.findIndex((h) => h.includes('longest runway') || h.includes('runway'));
    const filesIdx = header.findIndex((h) => h === 'files' || h === 'file');
    const lonIdx = header.findIndex((h) => h === 'longitude' || h === 'lon');
    const latIdx = header.findIndex((h) => h === 'latitude' || h === 'lat');

    if (identIdx === -1) {
      return { count: 0, error: 'Could not find "Ident" column in CSV header.' };
    }

    const newAirports: Airport[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      let parts: string[];
      if (delimiter === '\t') {
        parts = line.split('\t').map((p) => p.trim().replace(/^["']|["']$/g, ''));
      } else {
        parts = [];
        let inQuotes = false;
        let cur = '';
        for (let c = 0; c < line.length; c++) {
          const char = line[c];
          if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
          } else if (char === delimiter && !inQuotes) {
            parts.push(cur.trim().replace(/^["']|["']$/g, ''));
            cur = '';
          } else {
            cur += char;
          }
        }
        parts.push(cur.trim().replace(/^["']|["']$/g, ''));
      }

      const ident = parts[identIdx]?.toUpperCase();
      if (!ident || ident.length < 2 || ident.length > 6) continue;

      const name = nameIdx !== -1 && parts[nameIdx] ? parts[nameIdx] : `${ident} Airfield`;
      const city = cityIdx !== -1 && parts[cityIdx] ? parts[cityIdx] : undefined;
      const stateOrProvince = stateIdx !== -1 && parts[stateIdx] ? parts[stateIdx] : undefined;
      const countryOrAreaCode = countryIdx !== -1 && parts[countryIdx] ? parts[countryIdx] : undefined;
      const rating = ratingIdx !== -1 && parts[ratingIdx] ? parts[ratingIdx] : undefined;

      const elevationRaw = elevIdx !== -1 ? parts[elevIdx] : '0';
      const elevationFt = parseFloat(elevationRaw.replace(/[^0-9.-]/g, '')) || 0;

      const magDecl = magDeclIdx !== -1 && parts[magDeclIdx] ? parts[magDeclIdx] : undefined;
      const towerMhz = towerIdx !== -1 && parts[towerIdx] ? parts[towerIdx] : undefined;
      const largestRamp = rampIdx !== -1 && parts[rampIdx] ? parts[rampIdx] : undefined;
      const largestGate = gateIdx !== -1 && parts[gateIdx] ? parts[gateIdx] : undefined;

      const rwyRaw = rwyIdx !== -1 ? parts[rwyIdx] : undefined;
      const longestRunwayFt = rwyRaw ? parseFloat(rwyRaw.replace(/[^0-9.-]/g, '')) || undefined : undefined;

      const files = filesIdx !== -1 && parts[filesIdx] ? parts[filesIdx] : undefined;
      const lon = lonIdx !== -1 ? parseFloat(parts[lonIdx]) : 0;
      const lat = latIdx !== -1 ? parseFloat(parts[latIdx]) : 0;

      const lowerName = name.toLowerCase();
      const military =
        lowerName.includes('afb') ||
        lowerName.includes('air base') ||
        lowerName.includes('air station') ||
        lowerName.includes('raf ') ||
        lowerName.includes('base') ||
        lowerName.includes('tactical') ||
        lowerName.includes('naval air') ||
        (largestRamp?.toLowerCase().includes('mil') ?? false);

      newAirports.push({
        ident,
        icao: ident,
        name,
        city,
        stateOrProvince,
        countryOrAreaCode,
        rating,
        elevationFt: isNaN(elevationFt) ? 0 : elevationFt,
        magDecl,
        towerMhz,
        largestRamp,
        largestGate,
        longestRunwayFt,
        files,
        longitude: isNaN(lon) ? 0 : lon,
        latitude: isNaN(lat) ? 0 : lat,
        military,
      });
    }

    if (newAirports.length > 0) {
      globalAirportsList = newAirports;
      rebuildGlobalIndex();
      isDatabaseLoaded = true;

      if (persistToStorage) {
        saveToIndexedDb(csvText);
      }

      return { count: newAirports.length };
    }

    return { count: 0, error: 'No valid airport records were detected in the CSV file.' };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown CSV parsing error' };
  }
}

/**
 * Returns current statistics of the database system
 */
export function getDatabaseStats() {
  return {
    globalCount: globalAirportsList.length,
    isLoaded: isDatabaseLoaded,
    totalAirports: globalAirportsList.length,
  };
}

/**
 * Returns the entire global airports list for range/filtering searches
 */

import { GeneratedFlightPlan, FlightWaypoint } from '../types/flightDesk';
import { calculateBearingDeg, calculateDistanceNm, destinationPoint } from './geo';
import { fetchWithTimeout } from './http';

export const LOW_LEVEL_AGL_FT = 1500;

// In-memory elevation cache keyed by lat/lon rounded to 3 decimals (≈110m resolution matching DEM grid)
const elevationCache = new Map<string, number>();

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches one batch of elevations (meters). Retries twice on network errors, timeouts,
 * HTTP 429 and 5xx, so a single hiccup does not turn the whole plan into ESTIMATED altitudes.
 * A missing elevation is never treated as sea level: returns null instead.
 */
async function fetchChunkWithRetry(url: string, expectedCount: number): Promise<number[] | null> {
  const RETRY_DELAYS_MS = [400, 1200];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let retryable = true;
    try {
      const res = await fetchWithTimeout(url, {}, 6000);
      if (res.ok) {
        const data = (await res.json()) as { elevation?: number[] };
        const elev = data.elevation;
        if (
          Array.isArray(elev) &&
          elev.length === expectedCount &&
          elev.every((v) => typeof v === 'number' && Number.isFinite(v))
        ) {
          return elev;
        }
        retryable = false; // malformed answer: asking again will not help
      } else {
        retryable = res.status === 429 || res.status >= 500;
      }
    } catch {
      // network error or timeout: retry
    }
    if (!retryable || attempt === RETRY_DELAYS_MS.length) return null;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return null;
}

/**
 * Fetches real elevation in feet for a list of coordinates via Open-Meteo Copernicus DEM API.
 * Chunks requests to max 100 coordinates per call, converts meters to feet.
 * Returns null on any network failure or API anomaly.
 */
export async function fetchElevationsFt(
  points: { lat: number; lon: number }[]
): Promise<number[] | null> {
  if (points.length === 0) return [];

  // Determine missing points that need to be fetched
  const missingCoords: { lat: number; lon: number; key: string }[] = [];
  const seenKeys = new Set<string>();

  for (const pt of points) {
    const key = coordKey(pt.lat, pt.lon);
    if (!elevationCache.has(key) && !seenKeys.has(key)) {
      seenKeys.add(key);
      missingCoords.push({ lat: pt.lat, lon: pt.lon, key });
    }
  }

  // Chunk into batches of up to 100 coordinates
  const CHUNK_SIZE = 100;
  for (let i = 0; i < missingCoords.length; i += CHUNK_SIZE) {
    const chunk = missingCoords.slice(i, i + CHUNK_SIZE);
    const lats = chunk.map((c) => c.lat.toFixed(4)).join(',');
    const lons = chunk.map((c) => c.lon.toFixed(4)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    const elevationsM = await fetchChunkWithRetry(url, chunk.length);
    if (!elevationsM) return null;
    for (let k = 0; k < chunk.length; k++) {
      elevationCache.set(chunk[k].key, Math.round(elevationsM[k] * 3.28084));
    }
  }

  // Map requested points to cached elevations
  const result: number[] = [];
  for (const p of points) {
    const v = elevationCache.get(coordKey(p.lat, p.lon));
    if (v === undefined) return null;
    result.push(v);
  }
  return result;
}

/**
 * Terrain-neutral AGL altitude processor:
 * Queries Copernicus DEM terrain elevation along adjoining legs for all low-level waypoints
 * and updates them to real terrain-following MSL altitudes with clear AGL labels.
 */
export async function applyTerrainAgl(
  plan: GeneratedFlightPlan
): Promise<GeneratedFlightPlan> {
  const waypoints = plan.waypoints;
  const eligibleIndices: number[] = [];

  // Identify eligible low-level corridor waypoints
  waypoints.forEach((wp, idx) => {
    const skipType =
      wp.type === 'DEP' ||
      wp.type === 'CLIMB' ||
      wp.type === 'RECOVERY' ||
      wp.type === 'ARR' ||
      wp.type === 'TNG';
    const isTargetType =
      wp.type === 'MTR_ENTRY' ||
      wp.type === 'CHECKPOINT' ||
      wp.type === 'IP' ||
      wp.type === 'RANGE' ||
      wp.type === 'DROP' ||
      wp.type === 'EGRESS';

    if (isTargetType && !skipType && !wp.name.startsWith('TNG')) {
      eligibleIndices.push(idx);
    }
  });

  if (eligibleIndices.length === 0) {
    return { ...plan, terrainSource: 'DEM' };
  }

  // Sample every leg touching an eligible waypoint, every 2 NM along the full leg (start to end).
  // Each waypoint is then set above the highest terrain on BOTH adjoining legs, so the straight
  // line between two waypoint altitudes clears the terrain over the whole leg.
  const legIndices: number[] = [];
  for (const idx of eligibleIndices) {
    if (idx > 0 && !legIndices.includes(idx)) legIndices.push(idx);
    if (idx < waypoints.length - 1 && !legIndices.includes(idx + 1)) legIndices.push(idx + 1);
  }

  const legSamples = new Map<number, { lat: number; lon: number }[]>();
  const allPointsToFetch: { lat: number; lon: number }[] = [];
  for (const k of legIndices) {
    const from = waypoints[k - 1];
    const to = waypoints[k];
    const legDist = calculateDistanceNm(from.lat, from.lon, to.lat, to.lon);
    const legBrg = calculateBearingDeg(from.lat, from.lon, to.lat, to.lon);
    const pts: { lat: number; lon: number }[] = [];
    for (let d = 0; d < legDist; d += 2) pts.push(destinationPoint(from.lat, from.lon, d, legBrg));
    pts.push({ lat: to.lat, lon: to.lon });
    legSamples.set(k, pts);
    allPointsToFetch.push(...pts);
  }

  // Batch query DEM elevations
  const elevations = await fetchElevationsFt(allPointsToFetch);
  const isTrainingPlan = plan.missionProfile === 'range_strafe' || plan.missionProfile === 'cargo_drop';
  if (!elevations) {
    // Keep the generator's estimated altitudes and say so
    return {
      ...plan,
      assignedAltitude: isTrainingPlan
        ? `${plan.assignedAltitude} (terrain data unavailable, verify AGL)`
        : 'Low-level (terrain data unavailable, verify AGL)',
      terrainSource: 'ESTIMATED',
    };
  }

  // Terrain under every sampled point (waypoints are sampled exactly), for true AGL at each waypoint
  const groundAt = new Map<string, number>();
  allPointsToFetch.forEach((pt, i) => groundAt.set(coordKey(pt.lat, pt.lon), elevations[i]));

  // Highest terrain per leg
  const legMaxFt = new Map<number, number>();
  let offset = 0;
  for (const k of legIndices) {
    const count = legSamples.get(k)!.length;
    legMaxFt.set(k, Math.max(...elevations.slice(offset, offset + count)));
    offset += count;
  }

  const updatedWaypoints = waypoints.map((wp, idx) => {
    if (!eligibleIndices.includes(idx)) return { ...wp };

    const groundElevFt = Math.max(legMaxFt.get(idx) ?? -Infinity, legMaxFt.get(idx + 1) ?? -Infinity);

    // Range and drop fixes are flown at a set height above the ground right under them
    if (wp.type === 'RANGE' || wp.type === 'DROP' || (wp.type === 'IP' && wp.aglFt !== undefined)) {
      const groundHereFt = groundAt.get(coordKey(wp.lat, wp.lon)) ?? groundElevFt;
      const aglWanted = wp.aglFt ?? LOW_LEVEL_AGL_FT;
      const mslFt = Math.ceil((groundHereFt + aglWanted) / 50) * 50;
      const aglFt = Math.max(0, Math.round((mslFt - groundHereFt) / 50) * 50);
      return { ...wp, altFt: mslFt, altDisplay: `${mslFt.toLocaleString()} ft MSL (${aglFt.toLocaleString()} ft AGL)` };
    }

    let targetAglFt: number;
    if (wp.type === 'MTR_ENTRY') {
      targetAglFt = 2000;
    } else if (wp.type === 'EGRESS') {
      targetAglFt = 3000;
    } else {
      // CHECKPOINT or IP
      targetAglFt = LOW_LEVEL_AGL_FT + (idx % 4) * 100;
    }

    const calculatedMslFt = Math.ceil((groundElevFt + targetAglFt) / 100) * 100;
    // True height above the ground directly under the waypoint (what the pilot sees on the radar altimeter).
    // The MSL altitude is set from the highest terrain on the adjoining legs, so this is usually higher
    // than the target clearance.
    const groundAtWpFt = groundAt.get(coordKey(wp.lat, wp.lon)) ?? groundElevFt;
    const aglAtWpFt = Math.max(0, Math.round((calculatedMslFt - groundAtWpFt) / 50) * 50);
    const clearanceFt = calculatedMslFt - groundElevFt;
    const oldPlainAlt = String(wp.altFt);
    const oldFormattedAlt = wp.altFt.toLocaleString();
    const newFormattedAlt = calculatedMslFt.toLocaleString();

    let updatedRemarks = wp.remarks;
    if (oldPlainAlt !== String(calculatedMslFt)) {
      updatedRemarks = updatedRemarks
        .replaceAll(oldFormattedAlt, newFormattedAlt)
        .replaceAll(oldPlainAlt, String(calculatedMslFt));
    }
    // Strip MSA mentions
    updatedRemarks = updatedRemarks.replace(/\s*\(?MSA [\d,]+ ft MSL\)?/g, '').trim();
    updatedRemarks = `${updatedRemarks} Clearance ${clearanceFt.toLocaleString()} ft above the highest terrain on the adjoining legs.`.trim();

    return {
      ...wp,
      altFt: calculatedMslFt,
      altDisplay: `${calculatedMslFt.toLocaleString()} ft MSL (${aglAtWpFt.toLocaleString()} ft AGL)`,
      remarks: updatedRemarks,
    };
  });

  return {
    ...plan,
    waypoints: updatedWaypoints,
    assignedAltitude: isTrainingPlan
      ? plan.assignedAltitude
      : `≥${LOW_LEVEL_AGL_FT.toLocaleString()} ft above the highest terrain on each leg (MSL varies)`,
    terrainSource: 'DEM',
  };
}

import { Airport, AirportWeather, AtisReport } from '../types/flightDesk';
import { getAirportRealRunways, type RawRunwayItem } from '../data/airports';
import { fetchLiveAtis } from './atisService';
import { magToTrue, parseMagDecl, trueToMag } from './geo';
import { fetchWithTimeout } from './http';

export interface CandidateRunway {
  name: string;
  magHeadingDeg: number;
  trueHeadingDeg: number;
  lengthFt?: number;
  widthFt?: number;
  surface?: string;
}

const COMPASS_HEADINGS: Record<string, number> = {
  N: 360, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

/**
 * Parses one runway end designator ("09L", "3", "9W", "NE") into names and headings.
 * Returns null for entries that are not usable runways (helipads such as "H1", "ALL", "-", "PAD"...).
 * A surveyed true heading is used when available; otherwise the heading comes from the designator.
 */
function parseRunwayEnd(
  designator: string | undefined,
  surveyedTrueHdg: number | undefined,
  magDecl: number
): { name: string; magHeadingDeg: number; trueHeadingDeg: number } | null {
  const d = (designator || '').trim().toUpperCase();
  if (!d) return null;

  let approxMag: number | null = null;
  const num = d.match(/^(\d{1,2})[A-Z]?$/);
  if (num) {
    const n = parseInt(num[1], 10);
    if (n >= 1 && n <= 36) approxMag = n * 10;
  } else if (d in COMPASS_HEADINGS) {
    approxMag = COMPASS_HEADINGS[d];
  }
  if (approxMag === null) return null;

  const hasSurveyed = typeof surveyedTrueHdg === 'number' && Number.isFinite(surveyedTrueHdg);
  return {
    name: `RWY ${d}`,
    magHeadingDeg: hasSurveyed ? trueToMag(surveyedTrueHdg as number, magDecl) : approxMag,
    trueHeadingDeg: hasSurveyed ? (surveyedTrueHdg as number) : magToTrue(approxMag, magDecl),
  };
}

/**
 * Builds candidate runways from raw database rows. Unusable designators (helipads, junk) are skipped.
 * If only one end of a runway has a surveyed heading, the other end is that heading + 180°.
 */
export function runwaysFromRaw(rows: RawRunwayItem[], magDecl: number): CandidateRunway[] {
  const out: CandidateRunway[] = [];
  const recip = (h: number | undefined): number | undefined =>
    typeof h === 'number' && Number.isFinite(h) ? (h + 180) % 360 : undefined;

  for (const rwy of rows) {
    const leHdg = typeof rwy.leHdg === 'number' ? rwy.leHdg : recip(rwy.heHdg);
    const heHdg = typeof rwy.heHdg === 'number' ? rwy.heHdg : recip(rwy.leHdg);
    for (const [designator, hdg] of [[rwy.le, leHdg], [rwy.he, heHdg]] as const) {
      const end = parseRunwayEnd(designator, hdg, magDecl);
      if (!end) continue;
      out.push({
        ...end,
        lengthFt: rwy.len,
        widthFt: rwy.width,
        surface: rwy.surface,
      });
    }
  }
  return out;
}

/**
 * Resolves candidate runways for an airport and says whether they are real data:
 * 1. Real physical runways from the global runway database (usable designators only)
 * 2. Curated detailed airbase runwayDesignator (e.g. "11/29", "03/21R")
 * 3. Fallback RWY 36/18 (estimated: the runway is NOT known)
 */
function resolveRunwayCandidates(airport: Airport): { candidates: CandidateRunway[]; estimated: boolean } {
  const magDecl = parseMagDecl(airport.magDecl);
  const cleanIdent = airport.ident.trim().toUpperCase();

  const realRwys = getAirportRealRunways(cleanIdent) || (airport.icao ? getAirportRealRunways(airport.icao) : undefined);
  if (realRwys && realRwys.length > 0) {
    const candidates = runwaysFromRaw(realRwys, magDecl);
    if (candidates.length > 0) return { candidates, estimated: false };
  }

  const designator = airport.runwayDesignator?.trim().toUpperCase();
  if (designator && (designator.includes('/') || designator.includes(','))) {
    const parts = designator.split(/[/,]/);
    const candidates: CandidateRunway[] = [];

    for (const part of parts) {
      const match = part.match(/\d+/);
      if (match) {
        const num = parseInt(match[0], 10);
        let magHeading = num * 10;
        if (magHeading <= 0) magHeading = 360;
        const trueHeading = magToTrue(magHeading, magDecl);
        candidates.push({
          name: `RWY ${part.trim()}`,
          magHeadingDeg: magHeading,
          trueHeadingDeg: trueHeading,
          lengthFt: airport.longestRunwayFt,
        });
      }
    }

    if (candidates.length > 0) return { candidates, estimated: false };
  }

  const defMag1 = 360;
  const defMag2 = 180;
  return {
    candidates: [
      { name: 'RWY 36', magHeadingDeg: defMag1, trueHeadingDeg: magToTrue(defMag1, magDecl), lengthFt: airport.longestRunwayFt },
      { name: 'RWY 18', magHeadingDeg: defMag2, trueHeadingDeg: magToTrue(defMag2, magDecl), lengthFt: airport.longestRunwayFt },
    ],
    estimated: true,
  };
}

export function getRunwayCandidates(airport: Airport): CandidateRunway[] {
  return resolveRunwayCandidates(airport).candidates;
}

/** True when the airport has no usable runway data, so the active runway is a guess (not the real runway). */
export function isRunwayEstimated(airport: Airport): boolean {
  return resolveRunwayCandidates(airport).estimated;
}

/**
 * Calculates the active runway based on airport runway orientation, wind direction/speed,
 * and live ATIS active runway broadcasts.
 */
export function calculateActiveRunway(
  airport: Airport,
  windDirDeg: number,
  windSpeedKts: number,
  preferredAtisRunways?: string[]
): {
  activeRunway: string;
  activeRunwayHeadingDeg: number; // Magnetic heading
  activeRunwayTrueHeadingDeg: number; // True heading (exact map runway alignment)
  headwindKts: number;
  crosswindKts: number;
} {
  const candidates = getRunwayCandidates(airport);
  const magDecl = parseMagDecl(airport.magDecl);

  // If live ATIS explicitly specified active runway(s), attempt to match candidate runways
  if (preferredAtisRunways && preferredAtisRunways.length > 0) {
    const atisClean = preferredAtisRunways.map((r) => r.toUpperCase().replace(/^RWY\s*/, ''));
    const matched = candidates.filter((cand) => {
      const candCode = cand.name.toUpperCase().replace(/^RWY\s*/, '');
      return atisClean.some((ac) => ac === candCode || ac.replace(/^0/, '') === candCode.replace(/^0/, ''));
    });

    if (matched.length > 0) {
      // Pick best matched candidate based on headwind
      let bestMatch = matched[0];
      let bestHw = -999;
      let bestXw = 0;

      for (const cand of matched) {
        let diff = (windDirDeg - cand.trueHeadingDeg) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;

        const rad = (diff * Math.PI) / 180;
        const hw = windSpeedKts * Math.cos(rad);
        const xw = windSpeedKts * Math.sin(rad);

        if (hw > bestHw) {
          bestHw = hw;
          bestXw = xw;
          bestMatch = cand;
        }
      }

      return {
        activeRunway: bestMatch.name,
        activeRunwayHeadingDeg: bestMatch.magHeadingDeg,
        activeRunwayTrueHeadingDeg: bestMatch.trueHeadingDeg,
        headwindKts: Math.round(bestHw),
        crosswindKts: Math.round(bestXw),
      };
    }
  }

  // If wind is calm (< 3 kts), use the primary runway candidate
  if (windSpeedKts < 3 || windDirDeg === 0) {
    const primary = candidates[0];
    return {
      activeRunway: primary.name,
      activeRunwayHeadingDeg: primary.magHeadingDeg,
      activeRunwayTrueHeadingDeg: primary.trueHeadingDeg,
      headwindKts: 0,
      crosswindKts: 0,
    };
  }

  // If the airport has no usable runway data, align the (estimated) active runway
  // with the closest heading into the wind
  if (isRunwayEstimated(airport)) {
    const windMag = trueToMag(windDirDeg, magDecl);
    let idealMag = Math.round(windMag / 10) * 10;
    if (idealMag <= 0) idealMag = 360;
    if (idealMag > 360) idealMag = 360;
    const rwyNum = (idealMag / 10).toString().padStart(2, '0');
    return {
      activeRunway: `RWY ${rwyNum}`,
      activeRunwayHeadingDeg: idealMag,
      activeRunwayTrueHeadingDeg: magToTrue(idealMag, magDecl),
      headwindKts: windSpeedKts,
      crosswindKts: 0,
    };
  }

  // Evaluate all candidate runways to pick highest headwind
  let bestCandidate = candidates[0];
  let bestHeadwind = -999;
  let bestCrosswind = 0;

  for (const cand of candidates) {
    let diff = (windDirDeg - cand.trueHeadingDeg) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const rad = (diff * Math.PI) / 180;
    const headwind = windSpeedKts * Math.cos(rad);
    const crosswind = windSpeedKts * Math.sin(rad);

    if (headwind > bestHeadwind) {
      bestHeadwind = headwind;
      bestCrosswind = crosswind;
      bestCandidate = cand;
    }
  }

  return {
    activeRunway: bestCandidate.name,
    activeRunwayHeadingDeg: bestCandidate.magHeadingDeg,
    activeRunwayTrueHeadingDeg: bestCandidate.trueHeadingDeg,
    headwindKts: Math.round(bestHeadwind),
    crosswindKts: Math.round(bestCrosswind),
  };
}

/**
 * Returns standard ISA atmospheric conditions.
 */
export function getNeutralWeather(airport: Airport, atis?: AtisReport | null): AirportWeather {
  const atisRunways = atis?.arrRunways?.length ? atis.arrRunways : atis?.depRunways;
  const rwyCalc = calculateActiveRunway(airport, 0, 0, atisRunways);

  return {
    icao: airport.ident,
    source: 'STANDARD_ISA',
    rawMetar: `${airport.ident} 000000Z 00000KT 9999 CAVOK 15/05 Q1013 (STANDARD ISA)`,
    tempC: 15,
    dewpointC: 5,
    altimeterInHg: 29.92,
    altimeterHpa: 1013,
    windDirDeg: 0,
    windSpeedKts: 0,
    windGustKts: undefined,
    visibility: '10+ SM (CAVOK)',
    flightCategory: 'VFR',
    activeRunway: rwyCalc.activeRunway,
    activeRunwayHeadingDeg: rwyCalc.activeRunwayHeadingDeg,
    activeRunwayTrueHeadingDeg: rwyCalc.activeRunwayTrueHeadingDeg,
    headwindKts: 0,
    crosswindKts: 0,
    isCalm: true,
    runwayEstimated: isRunwayEstimated(airport),
    atis: atis || undefined,
    notes: 'Standard ISA atmosphere (15°C / 29.92 inHg), calm winds.',
  };
}

/**
 * Parses raw aviation METAR text into structured parameters.
 */
export function parseRawMetar(
  raw: string,
  airport: Airport,
  atis?: AtisReport | null
): AirportWeather | null {
  const cleanRaw = raw.trim().replace(/\s+/g, ' ');
  if (!cleanRaw || cleanRaw.length < 8) return null;

  // Extract wind (e.g. 23015G25KT, 00000KT, VRB03KT)
  const windMatch = cleanRaw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  let windDirDeg = 0;
  let windSpeedKts = 0;
  let windGustKts: number | undefined;

  if (windMatch) {
    if (windMatch[1] === 'VRB') {
      windDirDeg = 0;
    } else {
      windDirDeg = parseInt(windMatch[1], 10);
    }
    windSpeedKts = parseInt(windMatch[2], 10);
    if (windMatch[3]) {
      windGustKts = parseInt(windMatch[3], 10);
    }
  }

  // Extract temperature and dew point (e.g. 12/10, M02/M05, 05/M01)
  const tempMatch = cleanRaw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  let tempC = 15;
  let dewpointC = 5;
  if (tempMatch) {
    const rawT = tempMatch[1];
    const rawD = tempMatch[2];
    tempC = rawT.startsWith('M') ? -parseInt(rawT.slice(1), 10) : parseInt(rawT, 10);
    dewpointC = rawD.startsWith('M') ? -parseInt(rawD.slice(1), 10) : parseInt(rawD, 10);
  }

  // Extract altimeter / pressure (A2992 or Q1013)
  const altMatch = cleanRaw.match(/\b([AQ])(\d{4})\b/);
  let altimeterInHg = 29.92;
  let altimeterHpa = 1013;

  if (altMatch) {
    const type = altMatch[1];
    const val = parseInt(altMatch[2], 10);
    if (type === 'A') {
      altimeterInHg = Math.round((val / 100) * 100) / 100;
      altimeterHpa = Math.round(altimeterInHg / 0.02953);
    } else {
      altimeterHpa = val;
      altimeterInHg = Math.round(altimeterHpa * 0.02953 * 100) / 100;
    }
  }

  // Flight category estimation
  let flightCategory: AirportWeather['flightCategory'] = 'VFR';
  if (/\b(OVC00[1-4]|VV00[1-4])\b/.test(cleanRaw) || /\b([0-9]?\/[0-9]?SM)\b/.test(cleanRaw)) {
    flightCategory = 'LIFR';
  } else if (/\b(BKN00[5-9]|OVC00[5-9]|BKN010|OVC010)\b/.test(cleanRaw)) {
    flightCategory = 'IFR';
  } else if (/\b(BKN0[1-3][0-9]|OVC0[1-3][0-9])\b/.test(cleanRaw) || /\b([3-5]SM)\b/.test(cleanRaw)) {
    flightCategory = 'MVFR';
  }

  const atisRunways = atis?.arrRunways?.length ? atis.arrRunways : atis?.depRunways;
  const rwyCalc = calculateActiveRunway(airport, windDirDeg, windSpeedKts, atisRunways);

  return {
    icao: airport.ident,
    source: 'VATSIM_METAR',
    rawMetar: cleanRaw,
    tempC,
    dewpointC,
    altimeterInHg,
    altimeterHpa,
    windDirDeg,
    windSpeedKts,
    windGustKts,
    visibility: cleanRaw.includes('9999') || cleanRaw.includes('10SM') ? '10+ SM' : 'Standard Visual',
    flightCategory,
    activeRunway: rwyCalc.activeRunway,
    activeRunwayHeadingDeg: rwyCalc.activeRunwayHeadingDeg,
    activeRunwayTrueHeadingDeg: rwyCalc.activeRunwayTrueHeadingDeg,
    headwindKts: rwyCalc.headwindKts,
    crosswindKts: rwyCalc.crosswindKts,
    isCalm: windSpeedKts < 3,
    runwayEstimated: isRunwayEstimated(airport),
    atis: atis || undefined,
    notes: atis
      ? `Live METAR synced with official ${atis.source === 'FAA_DATIS' ? 'FAA D-ATIS' : 'VATSIM ATIS'} [${atis.code}].`
      : 'Official live global aviation METAR observation.',
  };
}

/**
 * Fetches real-time weather and live ATIS using 100% free, CORS-enabled endpoints:
 * 1. Live ATIS query (FAA D-ATIS + VATSIM ATIS)
 * 2. VATSIM METAR endpoint
 * 3. Open-Meteo fallback
 */
export async function fetchLiveAirportWeather(airport: Airport): Promise<AirportWeather> {
  const cleanIcao = airport.ident.trim().toUpperCase();

  // Run live ATIS query in parallel with weather
  let liveAtis: AtisReport | null = null;
  try {
    liveAtis = await fetchLiveAtis(cleanIcao);
  } catch (e) {
    console.warn(`[ATIS] lookup error for ${cleanIcao}:`, e);
  }

  // 1. Primary: VATSIM METAR API (CORS-friendly, global, updated real-time)
  try {
    const vatsimUrl = `https://metar.vatsim.net/metar.php?id=${encodeURIComponent(cleanIcao)}`;
    const res = await fetchWithTimeout(vatsimUrl);

    if (res.ok) {
      const rawText = await res.text();
      if (
        rawText &&
        !rawText.toLowerCase().includes('no metar') &&
        (rawText.startsWith(cleanIcao) || rawText.includes(cleanIcao) || /\b\d{6}Z\b/.test(rawText))
      ) {
        const parsed = parseRawMetar(rawText, airport, liveAtis);
        if (parsed) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn(`[Weather] VATSIM METAR fetch failed for ${cleanIcao}:`, err);
  }

  // 2. Secondary: Open-Meteo (CORS-friendly, worldwide coordinates fallback)
  try {
    const lat = airport.latitude;
    const lon = airport.longitude;
    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
    const res = await fetchWithTimeout(omUrl);

    if (res.ok) {
      const omData = await res.json();
      if (omData?.current) {
        const cur = omData.current;
        const tempC = Math.round(cur.temperature_2m);
        const relHum = cur.relative_humidity_2m || 70;
        const dewpC = Math.round(tempC - (100 - relHum) / 5);
        const windDir = Math.round(cur.wind_direction_10m || 0);
        const windSpeed = Math.round(cur.wind_speed_10m || 0);
        const windGust =
          cur.wind_gusts_10m && cur.wind_gusts_10m > windSpeed ? Math.round(cur.wind_gusts_10m) : undefined;
        const altimHpa = Math.round(cur.pressure_msl || 1013);
        const altimInHg = Math.round(altimHpa * 0.02953 * 100) / 100;

        const atisRunways = liveAtis?.arrRunways?.length ? liveAtis.arrRunways : liveAtis?.depRunways;
        const rwyCalc = calculateActiveRunway(airport, windDir, windSpeed, atisRunways);

        const now = new Date();
        const day = now.getUTCDate().toString().padStart(2, '0');
        const hour = now.getUTCHours().toString().padStart(2, '0');
        const min = now.getUTCMinutes().toString().padStart(2, '0');
        const windStr =
          windSpeed < 3
            ? '00000KT'
            : `${windDir.toString().padStart(3, '0')}${windSpeed.toString().padStart(2, '0')}${
                windGust ? `G${windGust}` : ''
              }KT`;
        const tempStr = `${tempC >= 0 ? tempC.toString().padStart(2, '0') : `M${Math.abs(tempC).toString().padStart(2, '0')}`}/${
          dewpC >= 0 ? dewpC.toString().padStart(2, '0') : `M${Math.abs(dewpC).toString().padStart(2, '0')}`
        }`;

        // Open-Meteo gives visibility (m) and cloud cover (%) but no cloud base,
        // so the synthetic METAR carries real visibility and omits the cloud group.
        const visM = typeof cur.visibility === 'number' ? cur.visibility : 10000;
        const visGroup = visM >= 9999 ? '9999' : String(Math.max(0, Math.round(visM / 100) * 100)).padStart(4, '0');
        const visSm = visM / 1609.34;
        const visLabel = visM >= 9999 ? '10+ SM' : `${visSm.toFixed(1)} SM`;
        const omCategory: AirportWeather['flightCategory'] =
          visM < 1600 ? 'LIFR' : visM < 4800 ? 'IFR' : visM < 8000 ? 'MVFR' : 'VFR';
        const cloudCover = typeof cur.cloud_cover === 'number' ? Math.round(cur.cloud_cover) : undefined;

        const synthMetar = `${cleanIcao} ${day}${hour}${min}Z AUTO ${windStr} ${visGroup} ${tempStr} Q${altimHpa} RMK AUTO-OBS`;

        return {
          icao: cleanIcao,
          source: 'OPEN_METEO',
          rawMetar: synthMetar,
          reportTime: cur.time,
          tempC,
          dewpointC: dewpC,
          altimeterInHg: altimInHg,
          altimeterHpa: altimHpa,
          windDirDeg: windDir,
          windSpeedKts: windSpeed,
          windGustKts: windGust,
          visibility: visLabel,
          flightCategory: omCategory,
          activeRunway: rwyCalc.activeRunway,
          activeRunwayHeadingDeg: rwyCalc.activeRunwayHeadingDeg,
          activeRunwayTrueHeadingDeg: rwyCalc.activeRunwayTrueHeadingDeg,
          headwindKts: rwyCalc.headwindKts,
          crosswindKts: rwyCalc.crosswindKts,
          isCalm: windSpeed < 3,
          runwayEstimated: isRunwayEstimated(airport),
          atis: liveAtis || undefined,
          notes: liveAtis
            ? `Real-time surface observation with active ${liveAtis.source} [${liveAtis.code}].`
            : `Real-time surface observation via Open-Meteo model (sea-level pressure; cloud base unknown${
                cloudCover !== undefined ? `, cover ${cloudCover}%` : ''
              }).`,
        };
      }
    }
  } catch (err) {
    console.warn(`[Weather] Open-Meteo fallback failed for ${cleanIcao}:`, err);
  }

  // 3. Fallback: Standard ISA Calm Atmosphere with ATIS if found
  return getNeutralWeather(airport, liveAtis);
}

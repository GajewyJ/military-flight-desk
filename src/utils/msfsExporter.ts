import { GeneratedFlightPlan } from '../types/flightDesk';
import { lowLevelCruiseAltitudeFt, uniqueIdent } from './exportCommon';

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Formats a decimal lat/lon and altitude in feet into the standard MSFS 2020 / AceXML WorldPosition string:
 * e.g. "N52° 19' 51.00",E016° 58' 54.00",+000279.00"
 */
export function formatMsfsWorldPosition(lat: number, lon: number, altFt: number, separator = ','): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const absLat = Math.abs(lat);
  const latDeg = Math.floor(absLat);
  const latMinVal = (absLat - latDeg) * 60;
  const latMin = Math.floor(latMinVal);
  const latSecVal = (latMinVal - latMin) * 60;
  const latSec = latSecVal.toFixed(2).padStart(5, '0');

  const lonDir = lon >= 0 ? 'E' : 'W';
  const absLon = Math.abs(lon);
  const lonDeg = Math.floor(absLon);
  const lonMinVal = (absLon - lonDeg) * 60;
  const lonMin = Math.floor(lonMinVal);
  const lonSecVal = (lonMinVal - lonMin) * 60;
  const lonSec = lonSecVal.toFixed(2).padStart(5, '0');

  const altSign = altFt >= 0 ? '+' : '-';
  const altInt = Math.abs(Math.round(altFt)).toString().padStart(6, '0');
  const altStr = `${altSign}${altInt}.00`;

  const latPart = `${latDir}${String(latDeg).padStart(2, '0')}° ${String(latMin).padStart(2, '0')}' ${latSec}"`;
  const lonPart = `${lonDir}${String(lonDeg).padStart(3, '0')}° ${String(lonMin).padStart(2, '0')}' ${lonSec}"`;

  return `${latPart}${separator}${lonPart}${separator}${altStr}`;
}

export function parseCruiseAltitudeFeet(assignedAltitude: string, baseElevationFt: number): number {
  if (!assignedAltitude) return 15000;
  const clean = assignedAltitude.toUpperCase();

  const flMatch = clean.match(/FL(\d{2,3})/);
  if (flMatch) {
    return parseInt(flMatch[1], 10) * 100;
  }

  // Handle ranges e.g. "1,600–2,200 ft MSL" or "500–1,000 ft AGL"
  const numbers = clean.match(/\d+[\d,]*/g);
  if (numbers && numbers.length > 0) {
    // Pick higher or representative number in range for cruise ceiling
    const highestVal = Math.max(...numbers.map((n) => parseInt(n.replace(/,/g, ''), 10)));
    if (clean.includes('AGL')) {
      return baseElevationFt + highestVal;
    }
    return highestVal;
  }

  return 15000;
}

/**
 * Derives a clean 3-6 character aeronautical waypoint identifier suitable for MSFS GPS/FMC.
 */
function deriveMsfsWaypointIdent(name: string, idx: number, type: string): string {
  if (name.includes('TNG IP')) return 'TNGIP';
  if (name.includes('TNG PATTERN ENTRY')) return 'TNGPE';
  if (name.includes('TNG DOWNWIND')) return 'TNGDW';
  if (name.includes('TNG PERCH')) return 'TNGPC';
  if (name.includes('TNG BASE')) return 'TNGBS';
  if (name.includes('TNG TURN FINAL')) return 'TNGTF';
  if (name.includes('TNG DEPARTURE TURN')) return 'TNGDT';
  if (name.includes('TNG FINAL')) return 'TNGFN';
  if (name.includes('TNG SHORT FINAL')) return 'TNGSF';
  if (type === 'TNG' || name.includes('TOUCH & GO') || name.includes('TOUCH AND GO')) return 'TNG';
  if (name.includes('TNG CLIMB')) return 'TNGCL';
  if (name.includes('INITIAL')) return 'INITL';
  if (name.includes('OVERHEAD')) return 'OVRHD';
  if (name.includes('BREAK')) return 'TACBK';
  if (name.includes('DOWNWIND')) return 'DWIND';
  if (name.includes('PERCH')) return 'PERCH';
  if (name.includes('SHORT FINAL')) return 'SFINL';
  if (name.includes('FINAL')) return 'FAF';
  if (name.includes('INITIAL')) return 'IAF';
  if (name.includes('TOUCHDOWN')) return 'TDZ';
  if (type === 'RECOVERY') return 'RCVRY';
  if (name.includes('CLIMBOUT')) return 'CLB';
  if (name.includes('LIFTOFF')) return 'LOFF';
  if (name.includes('LLTR ENTRY') || name.includes('MTR ENTRY')) return 'LLTEN';
  if (name.includes('LLTR EGRESS') || name.includes('MTR EGRESS')) return 'LLTEX';
  if (name.includes('CONTOUR')) return 'CONT';
  if (name.includes('DYNAMIC')) return 'DYNAT';
  if (name.includes('EGRESS')) return 'EGRS';
  if (name.includes('APEX FLANK')) return 'APXFL';
  if (name.includes('CORRIDOR APEX')) return 'APEX';
  if (name.includes('APEX ROLLOUT')) return 'APXRO';
  if (type === 'IP' || name.startsWith('IP')) return 'IP01';

  // Clean name e.g. "CP TALON" -> "TALON", "STATION BRAVO" -> "BRAVO"
  const clean = name.replace(/^CP\s+/i, '').replace(/^STATION\s+/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.slice(0, 6) || `WP${String(idx).padStart(2, '0')}`;
}

export type MsfsVersion = '2020' | '2024';

/**
 * Idents of the en-route (user) waypoints: everything between the first and last waypoint.
 * Both the MSFS 2020 and the MSFS 2024 export use this, so the two files name waypoints identically.
 */
function enrouteIdents(plan: GeneratedFlightPlan): string[] {
  const usedIdents = new Set<string>();
  const idents: string[] = [];
  for (let idx = 1; idx < plan.waypoints.length - 1; idx++) {
    const wp = plan.waypoints[idx];
    idents.push(uniqueIdent(wp.ident || deriveMsfsWaypointIdent(wp.name, idx, wp.type), usedIdents, 6));
  }
  return idents;
}

/** File name for an exported plan. The 2024 file gets a suffix so both versions can sit in one folder. */
export function msfsPlnFilename(plan: GeneratedFlightPlan, version: MsfsVersion = '2020'): string {
  const depIcao = plan.operatingAirbase.ident;
  const callsignClean = plan.callsign.replace(/\s+/g, '_');
  const suffix = version === '2024' ? '_MSFS2024' : '';
  return `${plan.flightRules || 'VFR'}_${depIcao}_to_${depIcao}_${callsignClean}${suffix}.pln`;
}

/**
 * Generates an official Microsoft Flight Simulator 2020 XML (.pln) flight plan file.
 * Conforms to SimBase.Document Type="AceXML" schema.
 */
export function generateMsfs2020PlnXml(plan: GeneratedFlightPlan): string {
  const depAirport = plan.operatingAirbase;
  const destAirport = plan.operatingAirbase;

  const cruiseAltFeet =
    lowLevelCruiseAltitudeFt(plan) ?? parseCruiseAltitudeFeet(plan.assignedAltitude, depAirport.elevationFt);

  const depPosition = plan.departureWeather?.activeRunway
    ? plan.departureWeather.activeRunway.replace(/[^0-9A-Z]/gi, '')
    : '';

  const depLla = formatMsfsWorldPosition(
    depAirport.latitude,
    depAirport.longitude,
    depAirport.elevationFt
  );

  const destLla = formatMsfsWorldPosition(
    destAirport.latitude,
    destAirport.longitude,
    destAirport.elevationFt
  );

  const title = `${plan.flightRules || 'VFR'} ${depAirport.ident} to ${destAirport.ident} (${plan.callsign})`;

  const idents = enrouteIdents(plan);
  const waypointsXml = plan.waypoints
    .map((wp, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === plan.waypoints.length - 1;

      if (isFirst) {
        return `        <ATCWaypoint id="${escapeXml(depAirport.ident)}">
            <ATCWaypointType>Airport</ATCWaypointType>
            <WorldPosition>${formatMsfsWorldPosition(wp.lat, wp.lon, wp.altFt)}</WorldPosition>
            <SpeedMaxFP>-1</SpeedMaxFP>
            <ICAO>
                <ICAOIdent>${escapeXml(depAirport.ident)}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>`;
      }

      if (isLast) {
        return `        <ATCWaypoint id="${escapeXml(destAirport.ident)}">
            <ATCWaypointType>Airport</ATCWaypointType>
            <WorldPosition>${formatMsfsWorldPosition(wp.lat, wp.lon, wp.altFt)}</WorldPosition>
            <SpeedMaxFP>-1</SpeedMaxFP>
            <ICAO>
                <ICAOIdent>${escapeXml(destAirport.ident)}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>`;
      }

      const ident = idents[idx - 1];

      return `        <ATCWaypoint id="${escapeXml(ident)}">
            <ATCWaypointType>User</ATCWaypointType>
            <WorldPosition>${formatMsfsWorldPosition(wp.lat, wp.lon, wp.altFt)}</WorldPosition>
            <SpeedMaxFP>-1</SpeedMaxFP>
        </ATCWaypoint>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0">
    <Descr>AceXML Document</Descr>
    <FlightPlan.FlightPlan>
        <Title>${escapeXml(title)}</Title>
        <FPType>${plan.flightRules || 'VFR'}</FPType>
        <RouteType>Direct</RouteType>
        <CruisingAlt>${cruiseAltFeet}</CruisingAlt>
        <DepartureID>${escapeXml(depAirport.ident)}</DepartureID>
        <DepartureLLA>${depLla}</DepartureLLA>
        <DestinationID>${escapeXml(destAirport.ident)}</DestinationID>
        <DestinationLLA>${destLla}</DestinationLLA>
        ${depPosition ? `<DeparturePosition>${depPosition}</DeparturePosition>` : ''}
        <DepartureName>${escapeXml(depAirport.name)}</DepartureName>
        <DestinationName>${escapeXml(destAirport.name)}</DestinationName>
        <AppVersion>
            <AppVersionMajor>11</AppVersionMajor>
            <AppVersionBuild>282174</AppVersionBuild>
        </AppVersion>
${waypointsXml}
    </FlightPlan.FlightPlan>
</SimBase.Document>
`;
}

/**
 * Splits a runway name such as "27L", "09" or "RWY 27" into the number and designator the
 * MSFS 2024 EFB flight plan uses (RunwayNumberFP 1-36, RunwayDesignatorFP LEFT/RIGHT/CENTER).
 */
export function parseRunwayFor2024(name: string | undefined): { number: string; designator?: string } | null {
  if (!name) return null;
  const m = name.toUpperCase().match(/(?:^|RWY|[^A-Z0-9])\s*(\d{1,2})\s*([LRC])?(?![A-Z0-9])/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 36) return null;
  const designator = m[2] === 'L' ? 'LEFT' : m[2] === 'R' ? 'RIGHT' : m[2] === 'C' ? 'CENTER' : undefined;
  return { number: String(n), designator };
}

function runwayDetailsXml(tag: 'DepartureDetails' | 'ArrivalDetails', runway: { number: string; designator?: string } | null): string {
  if (!runway) return '';
  return `        <${tag}>
            <RunwayNumberFP>${runway.number}</RunwayNumberFP>${
              runway.designator ? `\n            <RunwayDesignatorFP>${runway.designator}</RunwayDesignatorFP>` : ''
            }
        </${tag}>
`;
}

/**
 * Generates a Microsoft Flight Simulator 2024 EFB flight plan (.pln).
 * This is not the 2020 format: there is no AceXML header, the airfields are given as
 * DepartureID / DestinationID instead of Airport waypoints, runways go in DepartureDetails /
 * ArrivalDetails, and AppVersionMajor must be 12 or higher.
 *
 * It follows the same rules as the 2020 export: the same en-route waypoints with the same idents,
 * the same cruise altitude, the same title and the same runway.
 */
export function generateMsfs2024PlnXml(plan: GeneratedFlightPlan): string {
  const airport = plan.operatingAirbase;

  const cruiseAltFeet =
    lowLevelCruiseAltitudeFt(plan) ?? parseCruiseAltitudeFeet(plan.assignedAltitude, airport.elevationFt);

  const title = `${plan.flightRules || 'VFR'} ${airport.ident} to ${airport.ident} (${plan.callsign})`;
  const descr = `Peacetime sortie ${plan.callsign} - ${plan.sectorDescription}`;

  // Departure and recovery both use the same active runway of the operating airfield.
  const runway = parseRunwayFor2024(plan.departureWeather?.activeRunway);

  const idents = enrouteIdents(plan);
  const enrouteXml = plan.waypoints
    .slice(1, -1)
    .map((wp, i) => {
      const ident = escapeXml(idents[i]);
      return `        <ATCWaypoint id="${ident}">
            <ATCWaypointType>User</ATCWaypointType>
            <WorldPosition>${formatMsfsWorldPosition(wp.lat, wp.lon, wp.altFt, ', ')}</WorldPosition>
            <ICAO>
                <ICAOIdent>${ident}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>
`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document>
    <FlightPlan.FlightPlan>
        <DepartureID>${escapeXml(airport.ident)}</DepartureID>
        <DestinationID>${escapeXml(airport.ident)}</DestinationID>
        <Title>${escapeXml(title)}</Title>
        <Descr>${escapeXml(descr)}</Descr>
        <FPType>${plan.flightRules || 'VFR'}</FPType>
        <CruisingAlt>${cruiseAltFeet}</CruisingAlt>
        <AppVersion>
            <AppVersionMajor>12</AppVersionMajor>
        </AppVersion>
${runwayDetailsXml('DepartureDetails', runway)}${enrouteXml}${runwayDetailsXml('ArrivalDetails', runway)}    </FlightPlan.FlightPlan>
</SimBase.Document>
`;
}

/**
 * Triggers a direct browser file download for an MSFS flight plan (.pln), in the 2020 or the 2024 format.
 */
export function downloadMsfsPlnFile(plan: GeneratedFlightPlan, version: MsfsVersion = '2020'): void {
  const xml = version === '2024' ? generateMsfs2024PlnXml(plan) : generateMsfs2020PlnXml(plan);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = msfsPlnFilename(plan, version);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

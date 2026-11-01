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

function parseAltitudeToFeet(assignedAltitude: string, baseElevationFt: number): number {
  if (!assignedAltitude) return 15000;
  const clean = assignedAltitude.toUpperCase();

  // Flight level e.g. "FL240", "FL180"
  const flMatch = clean.match(/FL(\d{2,3})/);
  if (flMatch) {
    return parseInt(flMatch[1], 10) * 100;
  }

  // Feet e.g. "1,600–2,200 ft MSL", "24,000 ft", "15000"
  const numbers = clean.match(/\d+[\d,]*/g);
  if (numbers && numbers.length > 0) {
    const highestVal = Math.max(...numbers.map((n) => parseInt(n.replace(/,/g, ''), 10)));
    if (clean.includes('AGL')) {
      return baseElevationFt + highestVal;
    }
    return highestVal;
  }

  return 15000;
}

/**
 * Generates an official Little Navmap Flight Plan XML (.lnmpln) conforming to:
 * https://www.littlenavmap.org/schema/lnmpln.xsd
 */
export function generateLittleNavmapXml(plan: GeneratedFlightPlan): string {
  const cruiseAltFeet =
    lowLevelCruiseAltitudeFt(plan) ??
    parseAltitudeToFeet(plan.assignedAltitude, plan.operatingAirbase.elevationFt);
  const isoDate = new Date().toISOString();

  const usedIdents = new Set<string>();
  const waypointsXml = plan.waypoints
    .map((wp, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === plan.waypoints.length - 1;
      const isAirport = isFirst || isLast;

      let ident = '';
      if (isFirst) {
        ident = plan.operatingAirbase.ident;
      } else if (isLast) {
        ident =
          plan.isPointToPoint && plan.destinationAirbase
            ? plan.destinationAirbase.ident
            : plan.operatingAirbase.ident;
      } else {
        // Derive clean 3-5 character aeronautical ident
        const nameClean = wp.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (wp.name.includes('TNG IP')) ident = 'TNGIP';
        else if (wp.name.includes('TNG PATTERN ENTRY')) ident = 'TNGPE';
        else if (wp.name.includes('TNG DOWNWIND')) ident = 'TNGDW';
        else if (wp.name.includes('TNG PERCH')) ident = 'TNGPC';
        else if (wp.name.includes('TNG BASE')) ident = 'TNGBS';
        else if (wp.name.includes('TNG TURN FINAL')) ident = 'TNGTF';
        else if (wp.name.includes('TNG DEPARTURE TURN')) ident = 'TNGDT';
        else if (wp.name.includes('TNG FINAL')) ident = 'TNGFN';
        else if (wp.name.includes('TNG CLIMB')) ident = 'TNGCL';
        else if (wp.name.includes('INITIAL PITCH')) ident = 'INPIT';
        else if (wp.name.includes('OVERHEAD')) ident = 'OVRHD';
        else if (wp.name.includes('BREAK')) ident = 'TACBK';
        else if (wp.name.includes('DOWNWIND')) ident = 'DWIND';
        else if (wp.name.includes('PERCH')) ident = 'PERCH';
        else if (wp.name.includes('TNG SHORT FINAL')) ident = 'TNGSF';
        else if (wp.name.includes('SHORT FINAL')) ident = 'SFINL';
        else if (wp.name.includes('FINAL')) ident = 'FAF';
        else if (wp.name.includes('INITIAL')) ident = 'IAF';
        else if (wp.name.includes('TOUCHDOWN')) ident = 'TDZ';
        else if (wp.type === 'TNG' || wp.name.includes('TOUCH & GO')) ident = 'TNG';
        else if (wp.type === 'RECOVERY') ident = 'RCV';
        else if (wp.name.includes('CLIMB')) ident = 'CLB';
        else if (wp.name.includes('LOWAT ENTRY')) ident = 'LWENT';
        else if (wp.name.includes('LOWAT EGRESS')) ident = 'LWEGR';
        else if (wp.name.includes('ENGAGE')) ident = 'ENGAG';
        else if (wp.name.includes('RIDGE')) ident = 'RIDGE';
        else if (wp.name.includes('DEFENSIVE')) ident = 'DEFSPL';
        else if (wp.name.includes('EGRESS')) ident = 'EGRS';
        else if (wp.type === 'IP') ident = 'IP';
        else if (wp.type.includes('ORBIT')) ident = `ORB0${idx % 9 || 1}`;
        else ident = nameClean.slice(0, 5) || `WP${String(idx).padStart(2, '0')}`;
      }

      if (!isAirport) ident = uniqueIdent(ident, usedIdents, 5);
      const type = isAirport ? 'AIRPORT' : 'USER';
      const comment = `${wp.bearingMagDeg}°M | ${wp.legDistNm} NM | ${wp.speedKts} KIAS | ${wp.remarks}`;

      return `      <Waypoint>
        <Name>${escapeXml(wp.name)}</Name>
        <Ident>${escapeXml(ident)}</Ident>
        <Type>${type}</Type>
        <Comment>${escapeXml(comment)}</Comment>
        <Pos Lat="${wp.lat.toFixed(6)}" Lon="${wp.lon.toFixed(6)}" Alt="${wp.altFt.toFixed(2)}"/>
      </Waypoint>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<LittleNavmap xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.littlenavmap.org/schema/lnmpln.xsd">
  <Flightplan>
    <Header>
      <FlightplanType>VFR</FlightplanType>
      <CruisingAlt>${cruiseAltFeet}</CruisingAlt>
      <CruisingAltF>${cruiseAltFeet}.00000000</CruisingAltF>
      <CreationDate>${isoDate}</CreationDate>
      <FileVersion>1.0</FileVersion>
      <ProgramName>MSFS Military Flight Desk</ProgramName>
      <ProgramVersion>1.0.0</ProgramVersion>
      <Documentation>https://www.littlenavmap.org/lnmpln.html</Documentation>
    </Header>
    <SimData>MSFS</SimData>
    <NavData>MSFS</NavData>
    <AircraftPerformance>
      <Type>${plan.aircraftType === 'Cargo' ? 'C130' : 'F16'}</Type>
      <Name>${plan.aircraftType === 'Cargo' ? 'Military Cargo' : 'Military Fighter Jet'}</Name>
    </AircraftPerformance>
    <Waypoints>
${waypointsXml}
    </Waypoints>
  </Flightplan>
</LittleNavmap>
`;
}

/**
 * Triggers a direct browser file download for the Little Navmap (.lnmpln) flight plan.
 */
export function downloadLittleNavmapFile(plan: GeneratedFlightPlan): void {
  const xml = generateLittleNavmapXml(plan);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  const depIcao = plan.operatingAirbase.ident;
  const arrIcao =
    plan.isPointToPoint && plan.destinationAirbase
      ? plan.destinationAirbase.ident
      : depIcao;
  const callsignClean = plan.callsign.replace(/\s+/g, '_');
  const filename = `VFR_${depIcao}_to_${arrIcao}_${callsignClean}.lnmpln`;

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

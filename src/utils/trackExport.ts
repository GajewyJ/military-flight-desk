import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { RecPoint } from './flightRecorder';

const FT_TO_M = 0.3048;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A file name from the callsign, safe on every system. */
export function trackFileName(plan: GeneratedFlightPlan, extension: 'gpx' | 'kml'): string {
  const base = `${plan.callsign || 'flight'}-track`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'flight-track'}.${extension}`;
}

const coord = (n: number) => n.toFixed(6);

/** The flown track (and the planned route) as a GPX 1.1 file: positions, altitude in metres, time. */
export function trackToGpx(plan: GeneratedFlightPlan, points: RecPoint[]): string {
  const name = esc(`${plan.callsign} flown track`);
  const trk = points
    .map(
      (p) =>
        `      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lon)}"><ele>${(p.altMslFt * FT_TO_M).toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`
    )
    .join('\n');
  const rte = plan.waypoints
    .map(
      (w) =>
        `    <rtept lat="${coord(w.lat)}" lon="${coord(w.lon)}"><ele>${(w.altFt * FT_TO_M).toFixed(1)}</ele><name>${esc(w.name)}</name></rtept>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Military Flight Desk" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(plan.callsign)}</name></metadata>
  <rte>
    <name>${esc(plan.callsign)} planned route</name>
${rte}
  </rte>
  <trk>
    <name>${name}</name>
    <trkseg>
${trk}
    </trkseg>
  </trk>
</gpx>
`;
}

/** The flown track and the planned route as a KML file (Google Earth): both as lines at their altitude above sea level. */
export function trackToKml(plan: GeneratedFlightPlan, points: RecPoint[]): string {
  const flown = points.map((p) => `${coord(p.lon)},${coord(p.lat)},${(p.altMslFt * FT_TO_M).toFixed(1)}`).join(' ');
  const planned = plan.waypoints.map((w) => `${coord(w.lon)},${coord(w.lat)},${(w.altFt * FT_TO_M).toFixed(1)}`).join(' ');
  const marks = plan.waypoints
    .map(
      (w) =>
        `    <Placemark><name>${esc(w.name)}</name><Point><altitudeMode>absolute</altitudeMode><coordinates>${coord(w.lon)},${coord(w.lat)},${(w.altFt * FT_TO_M).toFixed(1)}</coordinates></Point></Placemark>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(plan.callsign)}</name>
    <Style id="flown"><LineStyle><color>ff0a40d4</color><width>3</width></LineStyle></Style>
    <Style id="planned"><LineStyle><color>ff808080</color><width>2</width></LineStyle></Style>
    <Placemark>
      <name>${esc(plan.callsign)} flown track</name>
      <styleUrl>#flown</styleUrl>
      <LineString><altitudeMode>absolute</altitudeMode><coordinates>${flown}</coordinates></LineString>
    </Placemark>
    <Placemark>
      <name>${esc(plan.callsign)} planned route</name>
      <styleUrl>#planned</styleUrl>
      <LineString><altitudeMode>absolute</altitudeMode><coordinates>${planned}</coordinates></LineString>
    </Placemark>
    <Folder>
      <name>Waypoints</name>
${marks}
    </Folder>
  </Document>
</kml>
`;
}

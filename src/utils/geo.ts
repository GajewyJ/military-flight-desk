const EARTH_RADIUS_NM = 3440.065;

export function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates great-circle distance between two GPS coordinates in Nautical Miles (NM).
 */
export function calculateDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/**
 * Calculates initial true bearing (degrees 0-359) from point 1 to point 2.
 */
export function calculateBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/**
 * Calculates destination point given starting lat/lon, distance in NM, and true bearing in degrees.
 */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceNm: number,
  bearingDeg: number
): { lat: number; lon: number } {
  const delta = distanceNm / EARTH_RADIUS_NM;
  const theta = toRad(bearingDeg);

  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  const normalLon = ((toDeg(lambda2) + 540) % 360) - 180;

  return {
    lat: toDeg(phi2),
    lon: normalLon,
  };
}

/**
 * Parses magnetic declination string (e.g. "5.2° East" -> 5.2, "3.9° West" -> -3.9)
 */
export function parseMagDecl(declStr?: string): number {
  if (!declStr) return 0;
  const num = parseFloat(declStr.replace(/[^0-9.-]/g, '')) || 0;
  if (declStr.toLowerCase().includes('west')) {
    return -Math.abs(num);
  }
  return Math.abs(num);
}

/**
 * Converts true bearing to magnetic bearing (taking declination into account)
 */
export function trueToMag(bearingTrue: number, declination: number): number {
  // Magnetic bearing = True bearing - East variation (or + West variation)
  const mag = (bearingTrue - declination + 360) % 360;
  return Math.round(mag);
}

/**
 * Converts magnetic bearing to true bearing (taking declination into account)
 */
export function magToTrue(bearingMag: number, declination: number): number {
  const tru = (bearingMag + declination + 360) % 360;
  return Math.round(tru * 10) / 10;
}

/**
 * Calculates the shortest signed angular difference between bearing 1 and bearing 2 (-180 to +180).
 * Positive = clockwise / right turn, Negative = counter-clockwise / left turn.
 */
export function angularDiffDeg(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/**
 * Ensures runway string is prefixed with "RWY " without duplicating it if already present.
 */
export function formatRunway(r: string): string {
  return /^RWY\s/i.test(r) ? r : `RWY ${r}`;
}

/**
 * Calculates perpendicular distance in NM from a point to a line segment defined by two coordinates.
 */
export function pointToSegmentDistanceNm(
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const cosLat = Math.cos(toRad((a.lat + b.lat + p.lat) / 3));
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * 60 * cosLat;
  const by = (b.lat - a.lat) * 60;
  const px = (p.lon - a.lon) * 60 * cosLat;
  const py = (p.lat - a.lat) * 60;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;

  return Math.hypot(px - projX, py - projY);
}

/**
 * Calculates minimum distance in NM from a point to a polyline.
 */
export function pointToPolylineDistanceNm(
  p: { lat: number; lon: number },
  polyline: { lat: number; lon: number }[]
): number {
  if (polyline.length === 0) return 0;
  if (polyline.length === 1) {
    return calculateDistanceNm(p.lat, p.lon, polyline[0].lat, polyline[0].lon);
  }

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = pointToSegmentDistanceNm(p, polyline[i], polyline[i + 1]);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/** Point at a given distance (NM) along a polyline; also returns the local segment bearing. */
export function pointAlongPolyline(
  line: { lat: number; lon: number }[],
  distNm: number
): { pos: { lat: number; lon: number }; bearing: number } {
  let remaining = distNm;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = calculateDistanceNm(line[i].lat, line[i].lon, line[i + 1].lat, line[i + 1].lon);
    const brg = calculateBearingDeg(line[i].lat, line[i].lon, line[i + 1].lat, line[i + 1].lon);
    if (remaining <= seg || i === line.length - 2) {
      return { pos: destinationPoint(line[i].lat, line[i].lon, Math.min(remaining, seg), brg), bearing: brg };
    }
    remaining -= seg;
  }
  return { pos: line[line.length - 1], bearing: 0 };
}

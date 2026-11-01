/**
 * Estimates regional ground elevation and computes obstacle clearance for Low-Level Tactical Routes.
 * In peacetime military corridors, minimum safe altitudes must strictly clear:
 * 1. Tall broadcast and telecommunication masts (often 800 - 1,200 ft AGL / 250 - 360m).
 * 2. Wind turbine clusters (500 - 750 ft AGL).
 * 3. High-voltage power lines and terrain elevation rises (hills/ridges).
 * 
 * Safety Altitude (SALT) / Route Minimum Safe Altitude (MSA) =
 *   Estimated Terrain + 1,150 ft max obstacle height + 350-500 ft safety margin,
 *   rounded up to the nearest 100 ft (minimum 1,600 ft MSL in lowlands).
 */
export function getLowLevelCorridorSafety(
  lat: number,
  lon: number,
  airbaseElevFt: number
): {
  groundElevFt: number;
  minSafeAltFt: number;
  obstacleTopMslFt: number;
} {
  let groundElev = Math.max(airbaseElevFt, 250);

  // Regional topographical gradients (e.g. Poland / Central Europe / general topography)
  if (lat < 51.3 && lat > 49.0) {
    // Sudetes / Carpathians / Upper Silesia elevation gradient
    const southFactor = Math.min(1, Math.max(0, (51.3 - lat) / 1.5));
    groundElev = Math.max(groundElev, Math.round(550 + southFactor * 1400));
  } else if (lat >= 53.6 && lat <= 54.8) {
    // Pomeranian / Baltic moraine plateau and lake hills
    groundElev = Math.max(groundElev, 400);
  } else if (airbaseElevFt > 500) {
    // Airbase is already elevated (e.g. EPLK, ETAR, KLSV)
    groundElev = Math.max(airbaseElevFt, 650);
  }

  // Max obstacle height in peacetime VFR corridors is 1,150 ft AGL (tall RTCN broadcast masts)
  const maxObstacleAgl = 1150;
  const obstacleTopMsl = groundElev + maxObstacleAgl;

  // NATO / MIL AIP Minimum Safe Altitude (MSA / SALT): obstacle top + clearance buffer (min 1,600 ft MSL)
  const minSafeAltFt = Math.max(1600, Math.ceil((obstacleTopMsl + 350) / 100) * 100);

  return {
    groundElevFt: groundElev,
    minSafeAltFt,
    obstacleTopMslFt: obstacleTopMsl,
  };
}

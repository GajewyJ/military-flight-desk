import {
  Airport,
  GeneratedFlightPlan,
  FlightWaypoint,
  MissionProfile,
  SortieDuration,
  AirportWeather,
  ApproachRecoveryType,
  AircraftClass,
} from '../types/flightDesk';
import {
  calculateBearingDeg,
  calculateDistanceNm,
  destinationPoint,
  parseMagDecl,
  trueToMag,
  magToTrue,
  angularDiffDeg,
} from './geo';
import { getNeutralWeather } from './weatherService';
import { formatRunway } from './format';
import { getLowLevelCorridorSafety } from './lowLevelSafety';
import { generateCargoLltrPlan, CARGO_CALLSIGNS } from './cargoRoute';

const CALLSIGN_PREFIXES = [
  'VIPER',
  'GHOST',
  'TALON',
  'COBRA',
  'RAZOR',
  'FALCON',
  'HAWK',
  'EAGLE',
  'TITAN',
  'LANCER',
  'VIKING',
  'PANTHER',
];

const CHECKPOINT_NAMES = [
  'TALON',
  'RAZOR',
  'FALCON',
  'COBRA',
  'VIPER',
  'APEX',
  'TITAN',
  'STORM',
  'GHOST',
  'VIKING',
  'LANCER',
  'PANTHER',
  'SENTRY',
  'HUNTER',
  'SHADOW',
  'BLADE',
  'STRIKE',
  'RANGER',
  'DAGGER',
  'BOLT',
  'PHANTOM',
  'ARROW',
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

/**
 * Random 4-digit transponder code in 4000-6777. Starting at 4 and stopping below 7 keeps the
 * result clear of 7500/7600/7700 and the other reserved 7xxx codes.
 */
export function generateSquawk(): string {
  return `${randomInt(4, 6)}${randomInt(0, 7)}${randomInt(0, 7)}${randomInt(0, 7)}`;
}

function getCardinal(deg: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
}

/**
 * Helper to add departure waypoints with realistic runway centerline alignment
 * and smooth departure turn arc (preventing sudden 120°–180° hairpin turns after takeoff).
 */
/**
 * Helper to add departure waypoints with authentic runway centerline alignment
 * and a smooth, realistic procedural departure arc (preventing sudden 90°–180° hairpin turns after takeoff).
 */
function addProceduralDeparture(
  waypoints: FlightWaypoint[],
  airbase: Airport,
  depWeather: AirportWeather,
  magDecl: number,
  targetPoint: { lat: number; lon: number },
  addLeg: (
    name: string,
    type: FlightWaypoint['type'],
    targetPos: { lat: number; lon: number },
    altFt: number,
    altDisplay: string,
    speedKts: number,
    legMach: string,
    remarks: string
  ) => void
): { lat: number; lon: number } {
  const depRwyMag = depWeather.activeRunwayHeadingDeg;
  const depRwyTrue =
    depWeather.activeRunwayTrueHeadingDeg !== undefined
      ? depWeather.activeRunwayTrueHeadingDeg
      : magToTrue(depRwyMag, magDecl);

  // 1. Calculate runway physical geometry (paved threshold and departure end)
  const rwyLengthFt = airbase.longestRunwayFt || 8000;
  const halfRwyDistNm = Math.min(1.2, Math.max(0.5, (rwyLengthFt / 6076.1) / 2));
  const rwyRecip = (depRwyTrue + 180) % 360;

  // Takeoff threshold (where the roll begins)
  const thresholdPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm, rwyRecip);
  // Departure End of Runway (DER / rotation & liftoff point)
  const derPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm, depRwyTrue);
  // Extended runway centerline climb-out fix (2.5 NM past DER, strictly aligned on runway heading)
  const climboutPos = destinationPoint(derPos.lat, derPos.lon, 2.5, depRwyTrue);

  // Waypoint 0: Active Runway Takeoff Threshold
  waypoints.push({
    id: 'wp-0',
    name: airbase.ident,
    type: 'DEP',
    lat: thresholdPos.lat,
    lon: thresholdPos.lon,
    altFt: airbase.elevationFt,
    altDisplay: `${airbase.elevationFt} ft MSL`,
    speedKts: 160,
    mach: '0.24',
    bearingTrueDeg: Math.round(depRwyTrue),
    bearingMagDeg: depRwyMag,
    legDistNm: 0,
    cumulativeDistNm: 0,
    legEteSeconds: 0,
    cumulativeTimeSeconds: 0,
    remarks: depWeather.isCalm
      ? `Takeoff ${depWeather.activeRunway} threshold (HDG ${depRwyMag}°M / ${Math.round(depRwyTrue)}°T). Accelerate down runway centerline.`
      : `Tactical takeoff ${depWeather.activeRunway} (HDG ${depRwyMag}°M / ${Math.round(depRwyTrue)}°T). Wind ${depWeather.windDirDeg}°@${depWeather.windSpeedKts}KT, QNH ${depWeather.altimeterInHg.toFixed(2)} inHg. Accelerate on centerline.`,
  });

  // Waypoint 1: Active Runway Departure End (LIFTOFF)
  addLeg(
    `${depWeather.activeRunway} LIFTOFF`,
    'DEP',
    derPos,
    airbase.elevationFt + 250,
    `${airbase.elevationFt + 250} ft MSL`,
    220,
    '0.33',
    `Airborne passing departure end of ${depWeather.activeRunway}. Gear handle up, climb on runway heading ${depRwyMag}°M.`
  );

  // Waypoint 2: Extended Centerline Climbout (2.5 NM past DER, climbing through 2,500 ft AGL)
  addLeg(
    `${depWeather.activeRunway} CLIMBOUT`,
    'CLIMB',
    climboutPos,
    Math.min(3500, airbase.elevationFt + 2500),
    `${Math.min(3500, airbase.elevationFt + 2500)} ft MSL`,
    280,
    '0.42',
    `Straight climb on extended centerline ${depRwyMag}°M to 2,500 ft AGL before initiating departure turn.`
  );

  // 2. Measure required turn from climbout point to next target mission fix
  const targetBrg = calculateBearingDeg(climboutPos.lat, climboutPos.lon, targetPoint.lat, targetPoint.lon);
  const turnAngle = angularDiffDeg(depRwyTrue, targetBrg);
  const absTurn = Math.abs(turnAngle);
  const turnDir = turnAngle >= 0 ? 1 : -1; // 1 = right turn, -1 = left turn

  // If turn is shallow (<= 40°), direct turn to target is completely natural and smooth
  if (absTurn <= 40) {
    return climboutPos;
  }

  // If turn is moderate (41°–85°), insert a single crosswind departure fix
  if (absTurn <= 85) {
    const crosswindHdg = (depRwyTrue + turnDir * (absTurn / 2) + 360) % 360;
    const crosswindPos = destinationPoint(climboutPos.lat, climboutPos.lon, 3.5, crosswindHdg);
    addLeg(
      'CROSSWIND DEP',
      'CLIMB',
      crosswindPos,
      Math.min(5000, airbase.elevationFt + 3800),
      `${Math.min(5000, airbase.elevationFt + 3800)} ft MSL`,
      300,
      '0.45',
      `Tactical crosswind departure turn heading ${trueToMag(crosswindHdg, magDecl)}°M. Climbing through 3,800 ft AGL.`
    );
    return crosswindPos;
  }

  // Large turn / reversal (86°–180°, e.g. departing East heading West):
  // Construct a realistic "round" climbing departure arc where each sub-turn is gentle (<= 50°)
  const numSteps = absTurn > 130 ? 3 : 2;
  const stepAngle = absTurn / (numSteps + 1);

  let curPos = climboutPos;
  let curHdg = depRwyTrue;

  // Step A: Crosswind Departure Arc
  curHdg = (curHdg + turnDir * stepAngle + 360) % 360;
  const posA = destinationPoint(curPos.lat, curPos.lon, 3.2, curHdg);
  addLeg(
    'CROSSWIND DEP',
    'CLIMB',
    posA,
    Math.min(5000, airbase.elevationFt + 3600),
    `${Math.min(5000, airbase.elevationFt + 3600)} ft MSL`,
    300,
    '0.45',
    `Tactical crosswind departure turn heading ${trueToMag(curHdg, magDecl)}°M. Climbing through 3,600 ft AGL.`
  );
  curPos = posA;

  // Step B: Downwind Departure Arc
  curHdg = (curHdg + turnDir * stepAngle + 360) % 360;
  const posB = destinationPoint(curPos.lat, curPos.lon, 3.5, curHdg);
  addLeg(
    'DOWNWIND ARC',
    'CLIMB',
    posB,
    Math.min(7500, airbase.elevationFt + 6000),
    `${Math.min(7500, airbase.elevationFt + 6000)} ft MSL`,
    330,
    '0.50',
    `Rounding tactical departure arc heading ${trueToMag(curHdg, magDecl)}°M. Accelerating through 330 KIAS.`
  );
  curPos = posB;

  // Step C (for near 180° complete reversals): Departure Rollout Fix
  if (numSteps === 3) {
    curHdg = (curHdg + turnDir * stepAngle + 360) % 360;
    const posC = destinationPoint(curPos.lat, curPos.lon, 3.8, curHdg);
    addLeg(
      'DEPARTURE ROLLOUT',
      'CLIMB',
      posC,
      Math.min(10000, airbase.elevationFt + 8500),
      `${Math.min(10000, airbase.elevationFt + 8500)} ft MSL`,
      350,
      '0.55',
      `Rollout from departure arc on course to assigned track (HDG ${trueToMag(curHdg, magDecl)}°M). Climbing through 8,500 ft.`
    );
    curPos = posC;
  }

  return curPos;
}

/**
 * Helper to add recovery waypoints aligned with the active landing runway centerline,
 * featuring tactical overhead traffic patterns (Downwind -> Base -> Final) to eliminate
 * sharp 90°–180° hairpin hooks on arrival.
 */
function addProceduralRecovery(
  lastPos: { lat: number; lon: number },
  airbase: Airport,
  weather: AirportWeather,
  magDecl: number,
  addLeg: (
    name: string,
    type: FlightWaypoint['type'],
    targetPos: { lat: number; lon: number },
    altFt: number,
    altDisplay: string,
    speedKts: number,
    legMach: string,
    remarks: string
  ) => void
): void {
  const rwyMag = weather.activeRunwayHeadingDeg;
  const rwyTrue =
    weather.activeRunwayTrueHeadingDeg !== undefined
      ? weather.activeRunwayTrueHeadingDeg
      : magToTrue(rwyMag, magDecl);

  const rwyLengthFt = airbase.longestRunwayFt || 8000;
  const halfRwyDistNm = Math.min(1.2, Math.max(0.5, (rwyLengthFt / 6076.1) / 2));
  const rwyRecip = (rwyTrue + 180) % 360;

  // Key fixes along the extended runway centerline (all on exact runway heading)
  const initialPos = destinationPoint(airbase.latitude, airbase.longitude, 5.0, rwyRecip);
  const finalPos = destinationPoint(airbase.latitude, airbase.longitude, 2.0, rwyRecip);
  const arrThresholdPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm, rwyRecip);
  const rolloutPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm * 0.4, rwyTrue);

  // Determine which side of the runway the approaching aircraft is located on
  const brgFromApt = calculateBearingDeg(airbase.latitude, airbase.longitude, lastPos.lat, lastPos.lon);
  const relToRwy = angularDiffDeg(rwyTrue, brgFromApt);
  const patternDir = relToRwy >= 0 ? 1 : -1; // 1 = Right of runway, -1 = Left of runway

  // Check offset relative to extended approach axis (reciprocal)
  const relToRecip = angularDiffDeg(rwyRecip, brgFromApt);
  const absOffset = Math.abs(relToRecip);

  const distFromApt = calculateDistanceNm(airbase.latitude, airbase.longitude, lastPos.lat, lastPos.lon);

  if (absOffset <= 25) {
    // 1. Direct approach cone: Aircraft is already arriving directly aligned behind runway.
    addLeg(
      `INITIAL ${weather.activeRunway}`,
      'RECOVERY',
      initialPos,
      airbase.elevationFt + 1500,
      `${airbase.elevationFt + 1500} ft MSL`,
      260,
      '0.39',
      `Aligned on ${weather.activeRunway} extended centerline (Inbound HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T). Initial break speed 260 KIAS.`
    );
  } else if (absOffset <= 70) {
    // 2. Rear-Flank quadrant: 45° dogleg intercept vector onto the extended runway centerline
    const interceptDist = Math.max(5.5, Math.min(7.0, distFromApt * 0.75));
    const interceptRef = destinationPoint(airbase.latitude, airbase.longitude, interceptDist, rwyRecip);
    const interceptPos = destinationPoint(
      interceptRef.lat,
      interceptRef.lon,
      1.8,
      (rwyTrue + 90 * patternDir + 360) % 360
    );
    addLeg(
      `INTERCEPT ${weather.activeRunway}`,
      'RECOVERY',
      interceptPos,
      airbase.elevationFt + 2200,
      `${airbase.elevationFt + 2200} ft MSL`,
      290,
      '0.44',
      `Tactical 45° base intercept vector onto ${weather.activeRunway} extended centerline. Descending to 2,200 ft AGL.`
    );
    addLeg(
      `INITIAL ${weather.activeRunway}`,
      'RECOVERY',
      initialPos,
      airbase.elevationFt + 1500,
      `${airbase.elevationFt + 1500} ft MSL`,
      260,
      '0.39',
      `Aligned on ${weather.activeRunway} extended centerline (Inbound HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T). Initial break speed 260 KIAS.`
    );
  } else {
    // 3. Overhead Traffic Pattern: Arriving from abeam or ahead of the airfield.
    // Execute a standard tactical overhead pattern on the aircraft's side (Entry -> Downwind -> Base)
    const downwindOffsetBrg = (rwyTrue + 90 * patternDir + 360) % 360;
    const patternEntry = destinationPoint(airbase.latitude, airbase.longitude, 2.8, downwindOffsetBrg);
    const dwRefPos = destinationPoint(airbase.latitude, airbase.longitude, 5.2, rwyRecip);
    const patternDownwind = destinationPoint(dwRefPos.lat, dwRefPos.lon, 2.8, downwindOffsetBrg);
    const baseRefPos = destinationPoint(airbase.latitude, airbase.longitude, 6.2, rwyRecip);
    const patternBase = destinationPoint(baseRefPos.lat, baseRefPos.lon, 1.4, downwindOffsetBrg);

    addLeg(
      'PATTERN ENTRY',
      'RECOVERY',
      patternEntry,
      airbase.elevationFt + 2500,
      `${airbase.elevationFt + 2500} ft MSL`,
      310,
      '0.46',
      `Tactical overhead pattern entry abeam airfield. Offset 2.8 NM ${patternDir > 0 ? 'Right' : 'Left'} of ${weather.activeRunway}.`
    );

    addLeg(
      'PATTERN DOWNWIND',
      'RECOVERY',
      patternDownwind,
      airbase.elevationFt + 2000,
      `${airbase.elevationFt + 2000} ft MSL`,
      270,
      '0.40',
      `Downwind leg parallel to ${weather.activeRunway} (HDG ${trueToMag(rwyRecip, magDecl)}°M). Gear down, flaps check.`
    );

    addLeg(
      'PATTERN BASE',
      'RECOVERY',
      patternBase,
      airbase.elevationFt + 1700,
      `${airbase.elevationFt + 1700} ft MSL`,
      230,
      '0.34',
      `Base turn onto final approach axis. Descending through 1,700 ft AGL, 230 KIAS.`
    );

    addLeg(
      `INITIAL ${weather.activeRunway}`,
      'RECOVERY',
      initialPos,
      airbase.elevationFt + 1500,
      `${airbase.elevationFt + 1500} ft MSL`,
      260,
      '0.39',
      `Aligned on ${weather.activeRunway} extended centerline (Inbound HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T). Initial break speed 260 KIAS.`
    );
  }

  // Final Sequence: aligned perfectly straight along active runway centerline
  addLeg(
    `FINAL ${weather.activeRunway}`,
    'RECOVERY',
    finalPos,
    airbase.elevationFt + 700,
    `${airbase.elevationFt + 700} ft MSL`,
    170,
    '0.26',
    `Final approach 2.0 NM out. Fully configured, on glideslope, 170 KIAS.`
  );

  addLeg(
    `${airbase.ident} TOUCHDOWN`,
    'ARR',
    arrThresholdPos,
    airbase.elevationFt,
    `${airbase.elevationFt} ft MSL`,
    140,
    '0.21',
    weather.isCalm
      ? `Touchdown ${weather.activeRunway} threshold. Aerodynamic braking, roll out on centerline.`
      : `Touchdown active ${weather.activeRunway}. Surface wind ${weather.windDirDeg}°@${weather.windSpeedKts}KT (HW ${weather.headwindKts >= 0 ? `+${weather.headwindKts}` : weather.headwindKts}KT, XW ${Math.abs(weather.crosswindKts)}KT ${weather.crosswindKts >= 0 ? 'R' : 'L'}). Aerodynamic braking.`
  );

  addLeg(
    airbase.ident,
    'ARR',
    rolloutPos,
    airbase.elevationFt,
    `${airbase.elevationFt} ft MSL`,
    30,
    '0.05',
    `Rollout complete on ${weather.activeRunway} centerline. Vacate runway at high-speed taxiway, taxi to dispersal.`
  );
}

/**
 * Tactical 360° Overhead Break Recovery Profile:
 * Aircraft flies high-speed (350 KIAS) along the runway axis directly over the runway numbers
 * at 1,500 ft AGL, initiates a 3-4G level tactical break turn into downwind, circles around the perch,
 * and rolls out wings-level on short final for touchdown.
 */
function addTacticalOverheadRecovery(
  lastPos: { lat: number; lon: number },
  airbase: Airport,
  weather: AirportWeather,
  magDecl: number,
  addLeg: (
    name: string,
    type: FlightWaypoint['type'],
    targetPos: { lat: number; lon: number },
    altFt: number,
    altDisplay: string,
    speedKts: number,
    legMach: string,
    remarks: string
  ) => void
): void {
  const rwyMag = weather.activeRunwayHeadingDeg;
  const rwyTrue =
    weather.activeRunwayTrueHeadingDeg !== undefined
      ? weather.activeRunwayTrueHeadingDeg
      : magToTrue(rwyMag, magDecl);

  const rwyLengthFt = airbase.longestRunwayFt || 8000;
  const halfRwyDistNm = Math.min(1.2, Math.max(0.5, (rwyLengthFt / 6076.1) / 2));
  const rwyRecip = (rwyTrue + 180) % 360;

  // Key runway locations
  const arrThresholdPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm, rwyRecip);
  const derPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm, rwyTrue);
  const rolloutPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyDistNm * 0.4, rwyTrue);

  // Pattern direction (Right or Left) based on arrival side relative to runway axis
  const brgFromApt = calculateBearingDeg(airbase.latitude, airbase.longitude, lastPos.lat, lastPos.lon);
  const relToRwy = angularDiffDeg(rwyTrue, brgFromApt);
  const patternDir = relToRwy >= 0 ? 1 : -1; // 1 = Right pattern, -1 = Left pattern
  const patternSideBrg = (rwyTrue + 90 * patternDir + 360) % 360;

  // Approach fixes
  const initialPitchPos = destinationPoint(arrThresholdPos.lat, arrThresholdPos.lon, 2.5, rwyRecip);
  const midRwyPos = { lat: airbase.latitude, lon: airbase.longitude };
  const breakPos = destinationPoint(derPos.lat, derPos.lon, 1.2, (rwyTrue + 40 * patternDir + 360) % 360);
  const downwindPos = destinationPoint(arrThresholdPos.lat, arrThresholdPos.lon, 1.4, patternSideBrg);
  const perchPos = destinationPoint(initialPitchPos.lat, initialPitchPos.lon, 1.3, patternSideBrg);
  const shortFinalPos = destinationPoint(arrThresholdPos.lat, arrThresholdPos.lon, 1.2, rwyRecip);

  // Check offset relative to runway inbound axis
  const relToRecip = angularDiffDeg(rwyRecip, brgFromApt);
  const absOffset = Math.abs(relToRecip);

  // If arriving from the flank / ahead, provide a smooth 45° dogleg intercept to Initial Pitch
  if (absOffset > 45) {
    const entryDist = 5.2;
    const entryRef = destinationPoint(arrThresholdPos.lat, arrThresholdPos.lon, entryDist, rwyRecip);
    const entryPos = destinationPoint(entryRef.lat, entryRef.lon, 1.8, patternSideBrg);
    addLeg(
      'OVERHEAD ENTRY',
      'RECOVERY',
      entryPos,
      airbase.elevationFt + 2200,
      `${airbase.elevationFt + 2200} ft MSL`,
      330,
      '0.50',
      `Tactical overhead recovery entry fix. Aligning with ${weather.activeRunway} inbound axis, 330 KIAS.`
    );
  }

  // 1. Initial fix along extended runway centerline
  addLeg(
    `INITIAL`,
    'RECOVERY',
    initialPitchPos,
    airbase.elevationFt + 1500,
    `${airbase.elevationFt + 1500} ft MSL`,
    350,
    '0.53',
    `Inbound on ${weather.activeRunway} extended centerline. 1,500 ft AGL, 350 KIAS. Report Initial.`
  );

  // 2. Overflight over the runway strip
  addLeg(
    `OVERHEAD`,
    'RECOVERY',
    midRwyPos,
    airbase.elevationFt + 1500,
    `${airbase.elevationFt + 1500} ft MSL`,
    320,
    '0.48',
    `Overhead runway numbers at 1,500 ft AGL. Level break into downwind.`
  );

  // 3. Break turn
  addLeg(
    `BREAK`,
    'RECOVERY',
    breakPos,
    airbase.elevationFt + 1500,
    `${airbase.elevationFt + 1500} ft MSL`,
    250,
    '0.37',
    `Level turn, decelerate through 250 KIAS. Roll out on ${patternDir > 0 ? 'right' : 'left'} downwind.`
  );

  // 4. Downwind Abeam Touchdown Zone
  addLeg(
    `DOWNWIND`,
    'RECOVERY',
    downwindPos,
    airbase.elevationFt + 1200,
    `${airbase.elevationFt + 1200} ft MSL`,
    200,
    '0.30',
    `Downwind abeam ${weather.activeRunway}. Gear DOWN - 3 green, half flaps, 200 KIAS.`
  );

  // 5. Perch / Base Turn
  addLeg(
    `PERCH`,
    'RECOVERY',
    perchPos,
    airbase.elevationFt + 800,
    `${airbase.elevationFt + 800} ft MSL`,
    175,
    '0.26',
    `Continuous descending base turn to final. Full landing flaps, 175 KIAS.`
  );

  // 6. Final Approach
  addLeg(
    `FINAL`,
    'RECOVERY',
    shortFinalPos,
    airbase.elevationFt + 400,
    `${airbase.elevationFt + 400} ft MSL`,
    150,
    '0.22',
    `On final ${weather.activeRunway} (1.2 NM). On glideslope, on speed (150 KIAS). Clear to land.`
  );

  // 7. Touchdown
  addLeg(
    `${airbase.ident} TOUCHDOWN`,
    'ARR',
    arrThresholdPos,
    airbase.elevationFt,
    `${airbase.elevationFt} ft MSL`,
    135,
    '0.20',
    weather.isCalm
      ? `Touchdown ${weather.activeRunway} threshold. Aerodynamic braking.`
      : `Touchdown ${weather.activeRunway}. Surface wind ${weather.windDirDeg}°@${weather.windSpeedKts}KT (HW ${weather.headwindKts >= 0 ? `+${weather.headwindKts}` : weather.headwindKts}KT, XW ${Math.abs(weather.crosswindKts)}KT). Aerodynamic braking.`
  );

  // 8. Rollout
  addLeg(
    airbase.ident,
    'ARR',
    rolloutPos,
    airbase.elevationFt,
    `${airbase.elevationFt} ft MSL`,
    30,
    '0.05',
    `Rollout complete on ${weather.activeRunway} centerline. Vacate runway at high-speed taxiway.`
  );
}

/**
 * Dispatches recovery procedure based on recoveryType:
 * 'instrument' (Straight-in / Traffic pattern) OR 'tactical_overhead' (Overhead pitch / Circle-to-land).
 */
function addAirfieldRecovery(
  recoveryType: ApproachRecoveryType,
  lastPos: { lat: number; lon: number },
  airbase: Airport,
  weather: AirportWeather,
  magDecl: number,
  addLeg: (
    name: string,
    type: FlightWaypoint['type'],
    targetPos: { lat: number; lon: number },
    altFt: number,
    altDisplay: string,
    speedKts: number,
    legMach: string,
    remarks: string
  ) => void
): void {
  if (recoveryType === 'tactical_overhead') {
    addTacticalOverheadRecovery(lastPos, airbase, weather, magDecl, addLeg);
  } else {
    addProceduralRecovery(lastPos, airbase, weather, magDecl, addLeg);
  }
}

/**
 * Generates a peacetime military training sortie:
 * 1. Active runway takeoff and procedural climb-out avoiding sharp >90° turns.
 * 2. Low-level route (LLTR), optionally with a touch-and-go at a second airfield.
 * 3. Recovery with a tactical 360° overhead break.
 * With aircraftClass 'cargo' only the LLTR profile exists (see cargoRoute.ts).
 */
export function generateMilitaryFlightPlan(
  airbase: Airport,
  missionProfile: MissionProfile,
  duration: SortieDuration,
  destinationAirport?: Airport,
  depWeather?: AirportWeather,
  destWeather?: AirportWeather,
  aircraftClass: AircraftClass = 'fighter_jet'
): GeneratedFlightPlan {
  if (aircraftClass === 'cargo' && missionProfile !== 'low_level_mtr') {
    throw new Error('CARGO_PROFILE_UNSUPPORTED');
  }

  const finalDepWeather = depWeather || getNeutralWeather(airbase);
  // For VFR fighter jet sorties, recovery is strictly 360° tactical overhead break
  const recoveryType: ApproachRecoveryType = 'tactical_overhead';

  const magDecl = parseMagDecl(airbase.magDecl);
  const sortieNum = randomInt(11, 89);
  const callsignList = aircraftClass === 'cargo' ? CARGO_CALLSIGNS : CALLSIGN_PREFIXES;
  const callsignPrefix = callsignList[randomInt(0, callsignList.length - 1)];
  const callsign = `${callsignPrefix} ${sortieNum}`;
  const sortieId = `SORTIE-${airbase.ident}-${randomInt(100, 999)}`;

  // Random base sector direction for departure (0 - 359 degrees)
  const baseSectorHeading = randomInt(0, 359);
  const sectorCardinal = getCardinal(baseSectorHeading);
  const sectorDescription = `Sector ${sectorCardinal} (${baseSectorHeading.toString().padStart(3, '0')}°)`;

  const squawk = generateSquawk();
  const tacFreq = `${randomInt(240, 360)}.${(randomInt(1, 9) * 50).toString().padStart(3, '0')} MHz`;

  if (aircraftClass === 'cargo') {
    return generateCargoLltrPlan({
      airbase,
      magDecl,
      callsign,
      sortieId,
      baseSectorHeading,
      sectorDescription,
      squawk,
      tacFreq,
      duration,
      depWeather: finalDepWeather,
    });
  }

  if (missionProfile === 'lltr_tng') {
    const tngAirbase = destinationAirport || airbase;
    const tngWeather = destWeather || getNeutralWeather(tngAirbase);
    return generateLlTrTngPlan({
      airbase,
      tngAirbase,
      magDecl,
      callsign,
      sortieId,
      squawk,
      tacFreq,
      duration,
      depWeather: finalDepWeather,
      tngWeather,
      recoveryType,
    });
  }

  if (missionProfile === 'low_level_mtr') {
    return generateLowLevelMtrPlan({
      airbase,
      magDecl,
      callsign,
      sortieId,
      baseSectorHeading,
      sectorDescription,
      squawk,
      tacFreq,
      duration,
      depWeather: finalDepWeather,
      recoveryType,
    });
  }

  throw new Error('MISSION_PROFILE_UNSUPPORTED');
}

/**
 * Low-Level Tactical Navigation Route (LLTR / MTR) Generator
 * Avoids sharp turns after takeoff, features smooth turnaround loops,
 * and enforces safe obstacle-clearing corridor altitudes (clearing broadcast masts, wind farms & hills).
 */
function generateLowLevelMtrPlan(ctx: {
  airbase: Airport;
  magDecl: number;
  callsign: string;
  sortieId: string;
  baseSectorHeading: number;
  sectorDescription: string;
  squawk: string;
  tacFreq: string;
  duration: SortieDuration;
  depWeather: AirportWeather;
  recoveryType: ApproachRecoveryType;
}): GeneratedFlightPlan {
  const {
    airbase,
    magDecl,
    callsign,
    sortieId,
    baseSectorHeading,
    sectorDescription,
    squawk,
    tacFreq,
    duration,
    depWeather,
    recoveryType,
  } = ctx;

  const cruiseSpeedKts = 450;
  const mach = '0.72';

  const baseSafety = getLowLevelCorridorSafety(airbase.latitude, airbase.longitude, airbase.elevationFt);
  const corridorFloorFt = baseSafety.minSafeAltFt;
  const corridorCeilFt = baseSafety.minSafeAltFt + 600;
  const assignedAltitude = `${corridorFloorFt.toLocaleString()}–${corridorCeilFt.toLocaleString()} ft MSL (Low-Level / Obstacle Clear)`;

  const waypoints: FlightWaypoint[] = [];

  const addLeg = (
    name: string,
    type: FlightWaypoint['type'],
    targetPos: { lat: number; lon: number },
    altFt: number,
    altDisplay: string,
    speedKts: number,
    legMach: string,
    remarks: string
  ) => {
    const prev = waypoints[waypoints.length - 1];
    const legDist = Math.round(calculateDistanceNm(prev.lat, prev.lon, targetPos.lat, targetPos.lon) * 10) / 10;
    const legBrg = Math.round(calculateBearingDeg(prev.lat, prev.lon, targetPos.lat, targetPos.lon));
    const legEte = Math.round((legDist / speedKts) * 3600);
    const cumDist = Math.round((prev.cumulativeDistNm + legDist) * 10) / 10;
    const cumTime = prev.cumulativeTimeSeconds + legEte;

    waypoints.push({
      id: `wp-${waypoints.length}`,
      name,
      type,
      lat: targetPos.lat,
      lon: targetPos.lon,
      altFt,
      altDisplay,
      speedKts,
      mach: legMach,
      bearingTrueDeg: legBrg,
      bearingMagDeg: trueToMag(legBrg, magDecl),
      legDistNm: legDist,
      cumulativeDistNm: cumDist,
      legEteSeconds: legEte,
      cumulativeTimeSeconds: cumTime,
      remarks,
    });
  };

  const config =
    duration === 'short'
      ? { entryDist: 10, numOutbound: 2, legDist: 17, numInbound: 2 }
      : duration === 'medium'
      ? { entryDist: 14, numOutbound: 4, legDist: 21, numInbound: 4 }
      : { entryDist: 18, numOutbound: 6, legDist: 24, numInbound: 6 };

  // Calculate approximate entry fix location
  const approxEntryPos = destinationPoint(airbase.latitude, airbase.longitude, config.entryDist + 5, baseSectorHeading);

  // 1. Procedural Runway Departure (with smooth departure arc if heading opposite to entry)
  const departureExitPos = addProceduralDeparture(
    waypoints,
    airbase,
    depWeather,
    magDecl,
    approxEntryPos,
    addLeg
  );

  // 2. MTR Entry Fix (Descent to safe low-level corridor floor)
  const entryPos = destinationPoint(
    departureExitPos.lat,
    departureExitPos.lon,
    config.entryDist,
    calculateBearingDeg(departureExitPos.lat, departureExitPos.lon, approxEntryPos.lat, approxEntryPos.lon)
  );

  const entrySafety = getLowLevelCorridorSafety(entryPos.lat, entryPos.lon, airbase.elevationFt);
  const entryAltFt = entrySafety.minSafeAltFt + 800;

  addLeg(
    'LLTR ENTRY',
    'MTR_ENTRY',
    entryPos,
    entryAltFt,
    `${entryAltFt.toLocaleString()} ft MSL`,
    420,
    '0.67',
    `Corridor ingress on sector ${baseSectorHeading}°M. Step descent to tactical floor (MSA ${entrySafety.minSafeAltFt} ft MSL). Arm terrain radar.`
  );

  let curPos = entryPos;
  let curBrg = baseSectorHeading;
  let doglegSign = 1;

  const shuffledNames = [...CHECKPOINT_NAMES].sort(() => 0.5 - Math.random());
  let nameIndex = 0;
  const getName = () => shuffledNames[nameIndex++ % shuffledNames.length];

  // 3. Outbound Low-Level Legs (gentle 25°–40° doglegs, safe obstacle clearance)
  for (let i = 1; i <= config.numOutbound; i++) {
    const turnAngle = randomInt(25, 38) * doglegSign;
    doglegSign *= -1;
    curBrg = (curBrg + turnAngle + 360) % 360;

    const nextPos = destinationPoint(curPos.lat, curPos.lon, config.legDist, curBrg);
    const cpSafety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
    const tacticalAltFt = cpSafety.minSafeAltFt + randomInt(0, 3) * 100;
    const agl = tacticalAltFt - cpSafety.groundElevFt;
    const cpName = `CP ${getName()}`;

    addLeg(
      cpName,
      'CHECKPOINT',
      nextPos,
      tacticalAltFt,
      `${tacticalAltFt.toLocaleString()} ft MSL (${agl.toLocaleString()} ft AGL)`,
      cruiseSpeedKts,
      mach,
      `Tactical low-level corridor. Clears all masts & wind turbines (MSA ${cpSafety.minSafeAltFt} ft MSL). 450 KIAS.`
    );
    curPos = nextPos;
  }

  // 4. Smooth Tactical Apex Turnaround Loop (3 gentle 60° turns to align with inbound course)
  const apexTurnDir = doglegSign;
  const inboundTargetBrg = (baseSectorHeading + 180 + 360) % 360;

  // Turn 1: Flank turn (60 deg turn from curBrg)
  const flankBrg = (curBrg + 60 * apexTurnDir + 360) % 360;
  const apexFlankPos = destinationPoint(curPos.lat, curPos.lon, 7.5, flankBrg);
  const flankSafety = getLowLevelCorridorSafety(apexFlankPos.lat, apexFlankPos.lon, airbase.elevationFt);
  const flankAltFt = flankSafety.minSafeAltFt + 300;

  addLeg(
    'APEX FLANK',
    'CHECKPOINT',
    apexFlankPos,
    flankAltFt,
    `${flankAltFt.toLocaleString()} ft MSL`,
    450,
    '0.72',
    `Tactical corridor turnaround entry. Climbing turn 450 KIAS (MSA ${flankSafety.minSafeAltFt} ft MSL).`
  );

  // Turn 2: Apex Base (60 deg turn)
  const apexBaseBrg = (flankBrg + 60 * apexTurnDir + 360) % 360;
  const apexBasePos = destinationPoint(apexFlankPos.lat, apexFlankPos.lon, 7.5, apexBaseBrg);
  const apexBaseSafety = getLowLevelCorridorSafety(apexBasePos.lat, apexBasePos.lon, airbase.elevationFt);
  const apexBaseAltFt = apexBaseSafety.minSafeAltFt + 100;

  addLeg(
    'CORRIDOR APEX',
    'CHECKPOINT',
    apexBasePos,
    apexBaseAltFt,
    `${apexBaseAltFt.toLocaleString()} ft MSL`,
    470,
    '0.75',
    `Corridor apex turn. High-G tactical turnaround at ${apexBaseAltFt} ft MSL (clears all obstacles).`
  );

  // Turn 3: Inbound Corridor Apex (60 deg turn -> aligns directly with inboundTargetBrg)
  const apexRolloutPos = destinationPoint(apexBasePos.lat, apexBasePos.lon, 7.5, inboundTargetBrg);
  const apexRoSafety = getLowLevelCorridorSafety(apexRolloutPos.lat, apexRolloutPos.lon, airbase.elevationFt);
  const apexRoAltFt = apexRoSafety.minSafeAltFt;

  addLeg(
    'APEX ROLLOUT',
    'CHECKPOINT',
    apexRolloutPos,
    apexRoAltFt,
    `${apexRoAltFt.toLocaleString()} ft MSL`,
    480,
    '0.76',
    `Apex turnaround complete. Roll out on inbound corridor (MSA ${apexRoSafety.minSafeAltFt} ft MSL).`
  );

  curPos = apexRolloutPos;
  curBrg = inboundTargetBrg;

  // 5. Inbound Low-Level Legs towards recovery
  const outboundTotalDist = config.entryDist + config.numOutbound * config.legDist;
  const inboundLegDist = Math.max(10, Math.round(((outboundTotalDist - 20) / config.numInbound) * 10) / 10);

  for (let i = 1; i <= config.numInbound; i++) {
    const isFinalInbound = i === config.numInbound;
    const turnAngle = randomInt(20, 32) * doglegSign;
    doglegSign *= -1;
    curBrg = (curBrg + turnAngle + 360) % 360;

    const nextPos = destinationPoint(curPos.lat, curPos.lon, inboundLegDist, curBrg);
    const inSafety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
    const tacticalAltFt = inSafety.minSafeAltFt + (isFinalInbound ? 200 : randomInt(0, 3) * 100);
    const agl = tacticalAltFt - inSafety.groundElevFt;
    const cpName = isFinalInbound ? 'IP FOXTROT' : `CP ${getName()}`;

    addLeg(
      cpName,
      isFinalInbound ? 'IP' : 'CHECKPOINT',
      nextPos,
      tacticalAltFt,
      `${tacticalAltFt.toLocaleString()} ft MSL (${agl.toLocaleString()} ft AGL)`,
      cruiseSpeedKts,
      mach,
      isFinalInbound
        ? `Initial Point (IP). Final low-level check (MSA ${inSafety.minSafeAltFt} ft MSL), hack timing clock, standby for corridor exit.`
        : `Inbound tactical return heading ${trueToMag(curBrg, magDecl)}°M. Safe obstacle clearance (MSA ${inSafety.minSafeAltFt} ft MSL). 450 KIAS.`
    );
    curPos = nextPos;
  }

  // 6. MTR Egress Point (Climb out of low-level terrain corridor)
  const homeBrg = calculateBearingDeg(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
  const prevWp = waypoints[waypoints.length - 1];
  const turnToHome = angularDiffDeg(prevWp.bearingTrueDeg, homeBrg);

  const distToApt = calculateDistanceNm(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);

  const lastSafety = getLowLevelCorridorSafety(curPos.lat, curPos.lon, airbase.elevationFt);

  // If turn into home is sharp (> 70°) and aircraft is still > 18 NM out, insert an intermediate egress transition turn
  if (Math.abs(turnToHome) > 70 && distToApt > 18) {
    const egressTurnDir = turnToHome >= 0 ? 1 : -1;
    const midEgressBrg = (prevWp.bearingTrueDeg + egressTurnDir * (Math.abs(turnToHome) / 2) + 360) % 360;
    const midEgressPos = destinationPoint(curPos.lat, curPos.lon, 6, midEgressBrg);
    const midAltFt = lastSafety.minSafeAltFt + 1000;
    addLeg(
      'EGRESS TRANSITION',
      'EGRESS',
      midEgressPos,
      midAltFt,
      `${midAltFt.toLocaleString()} ft MSL`,
      420,
      '0.67',
      `Tactical corridor exit turn heading ${trueToMag(midEgressBrg, magDecl)}°M. Climbing above corridor.`
    );
    curPos = midEgressPos;
  }

  const updatedDistToApt = calculateDistanceNm(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
  const egressDist = Math.max(5, Math.min(12, updatedDistToApt - 14));
  const egressPos = destinationPoint(curPos.lat, curPos.lon, egressDist, homeBrg);
  const egressSafety = getLowLevelCorridorSafety(egressPos.lat, egressPos.lon, airbase.elevationFt);
  const egressAltFt = egressSafety.minSafeAltFt + 1500;

  addLeg(
    'LLTR EGRESS',
    'EGRESS',
    egressPos,
    egressAltFt,
    `${egressAltFt.toLocaleString()} ft MSL`,
    400,
    '0.64',
    `MTR Corridor exit. Step climb to ${egressAltFt.toLocaleString()} ft MSL, radar advisory contact.`
  );

  // 7 & 8. Recovery entry: randomized procedural instrument pattern vs tactical 360° overhead break
  addAirfieldRecovery(recoveryType, egressPos, airbase, depWeather, magDecl, addLeg);

  const lastWp = waypoints[waypoints.length - 1];
  const totalDist = lastWp.cumulativeDistNm;
  const totalFlightTimeMin = Math.round(lastWp.cumulativeTimeSeconds / 60);

  return {
    sortieId,
    callsign,
    flightRules: 'VFR',
    aircraftType: 'Fighter Jet',
    missionProfile: 'low_level_mtr',
    recoveryType,
    operatingAirbase: airbase,
    weatherMode: depWeather.source === 'STANDARD_ISA' ? 'neutral' : 'live',
    departureWeather: depWeather,
    totalDistanceNm: Math.round(totalDist),
    totalFlightTimeMin,
    assignedAltitude,
    cruiseSpeedKts,
    squawk,
    tacFrequencyMhz: tacFreq,
    sectorHeadingDeg: baseSectorHeading,
    sectorDescription,
    waypoints,
    generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

type LatLon = { lat: number; lon: number };

/** Shortest distance (NM) from a point to a segment (local flat-earth approximation). */
function pointToSegmentNm(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos((a.lat * Math.PI) / 180) * 60;
  const toXY = (q: LatLon): [number, number] => [(q.lon - a.lon) * k, (q.lat - a.lat) * 60];
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

function pointToPolylineNm(p: LatLon, line: LatLon[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return calculateDistanceNm(p.lat, p.lon, line[0].lat, line[0].lon);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, pointToSegmentNm(p, line[i], line[i + 1]));
  }
  return best;
}

/** Point at a given distance (NM) along a polyline; also returns the local segment bearing. */
function pointAlongPolyline(line: LatLon[], distNm: number): { pos: LatLon; bearing: number } {
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

/**
 * Low-Level Tactical Navigation with Touch-and-Go Training Sortie Generator (LLTR + TNG)
 * High-speed terrain-following low-level route to an intermediate airbase for a tactical approach
 * and touch-and-go, followed by a lateral return corridor back to the departure airbase.
 */
function generateLlTrTngPlan(ctx: {
  airbase: Airport;
  tngAirbase: Airport;
  magDecl: number;
  callsign: string;
  sortieId: string;
  squawk: string;
  tacFreq: string;
  duration: SortieDuration;
  depWeather: AirportWeather;
  tngWeather: AirportWeather;
  recoveryType: ApproachRecoveryType;
}): GeneratedFlightPlan {
  const { airbase, tngAirbase, magDecl, callsign, sortieId, squawk, tacFreq, depWeather, tngWeather, recoveryType } = ctx;

  const cruiseSpeedKts = 450;
  const mach = '0.72';
  const rwyLabel = formatRunway(tngWeather.activeRunway);

  // ---- Touch & Go field geometry -------------------------------------------------------
  const tngMagDecl = parseMagDecl(tngAirbase.magDecl);
  const tngRwyMag = tngWeather.activeRunwayHeadingDeg;
  const rwyTrue =
    tngWeather.activeRunwayTrueHeadingDeg !== undefined
      ? tngWeather.activeRunwayTrueHeadingDeg
      : magToTrue(tngRwyMag, tngMagDecl);
  const rwyRecip = (rwyTrue + 180) % 360;
  const fieldElev = tngAirbase.elevationFt;
  const field: LatLon = { lat: tngAirbase.latitude, lon: tngAirbase.longitude };

  const halfRwyNm = Math.min(1.2, Math.max(0.5, (tngAirbase.longestRunwayFt || 8000) / 6076.1 / 2));
  const thresholdPos = destinationPoint(field.lat, field.lon, halfRwyNm, rwyRecip);
  const touchdownPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, 0.15, rwyTrue);
  const derPos = destinationPoint(field.lat, field.lon, halfRwyNm, rwyTrue);
  const climbOutPos = destinationPoint(derPos.lat, derPos.lon, 1.5, rwyTrue);
  const shortFinalPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, 1.2, rwyRecip);

  const distToTng = calculateDistanceNm(airbase.latitude, airbase.longitude, field.lat, field.lon);
  const baseSectorHeading = Math.round(
    calculateBearingDeg(airbase.latitude, airbase.longitude, field.lat, field.lon)
  );
  const sectorDescription = `Low-Level Sector ${getCardinal(baseSectorHeading)} ➔ T&G ${tngAirbase.ident} (${rwyLabel})`;

  // ---- Approach choice: straight-in only when home lies behind the approach end ---------
  const homeBrg = calculateBearingDeg(field.lat, field.lon, airbase.latitude, airbase.longitude);
  const straightIn = Math.abs(angularDiffDeg(rwyRecip, homeBrg)) <= 80;
  const relToRwy = angularDiffDeg(rwyTrue, homeBrg);
  // Preferred pattern side is the home side (1 = right, -1 = left).
  const preferredPatternDir: 1 | -1 = relToRwy >= 0 ? 1 : -1;

  // Straight-in: IP on 8 NM final. Downwind join: enter the downwind leg from the pattern side.
  const ipPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, 8, rwyRecip);
  const finalPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, 3, rwyRecip);

  // Pattern geometry for a given side. Pattern turn flown as a ~180° semicircle in three steps
  // (no single turn above ~90°). x = NM past the threshold along the reciprocal,
  // y = NM lateral towards the pattern side.
  const patternGeometry = (dir: 1 | -1) => {
    const sideBrg = (rwyTrue + 90 * dir + 360) % 360;
    const abeamPos = destinationPoint(touchdownPos.lat, touchdownPos.lon, 1.4, sideBrg);
    const joinPos = destinationPoint(abeamPos.lat, abeamPos.lon, 4.5, rwyTrue);
    const at = (x: number, y: number): LatLon => {
      const along = destinationPoint(thresholdPos.lat, thresholdPos.lon, x, rwyRecip);
      return y === 0 ? along : destinationPoint(along.lat, along.lon, y, sideBrg);
    };
    return {
      dir,
      abeamPos,
      joinPos,
      perchPos: at(2.2, 1.4),
      basePos: at(2.9, 0.7),
      turnFinalPos: at(2.2, 0),
    };
  };

  const returnOffsetNm = Math.min(10, 0.25 * distToTng);

  const buildPlanAttempt = (useDoglegs: boolean, forceSide?: 0 | 1, patternDirArg: 1 | -1 = preferredPatternDir) => {
    const pg = patternGeometry(patternDirArg);
    const entryTarget: LatLon = straightIn ? ipPos : pg.joinPos;
    const farSideJoin = !straightIn && patternDirArg !== preferredPatternDir;
    const waypoints: FlightWaypoint[] = [];
    let cumulativeDistNm = 0;
    let cumulativeTimeSeconds = 0;

    const addLeg = (
      name: string,
      type: FlightWaypoint['type'],
      targetPos: { lat: number; lon: number },
      altFt: number,
      altDisplay: string,
      speedKts: number,
      legMach: string,
      remarks: string
    ) => {
      const prev = waypoints[waypoints.length - 1];
      const legDistNm = Math.round(calculateDistanceNm(prev.lat, prev.lon, targetPos.lat, targetPos.lon) * 10) / 10;
      const bearingTrueDeg = Math.round(calculateBearingDeg(prev.lat, prev.lon, targetPos.lat, targetPos.lon));
      // Pattern legs decelerate/accelerate, so use the average speed there.
      const legSpeed = name.startsWith('TNG') ? (Math.max(prev.speedKts, 100) + speedKts) / 2 : speedKts;
      const legEteSeconds = Math.round((legDistNm / legSpeed) * 3600);
      cumulativeDistNm = Math.round((cumulativeDistNm + legDistNm) * 10) / 10;
      cumulativeTimeSeconds += legEteSeconds;

      waypoints.push({
        id: `wp-${waypoints.length}`,
        name,
        type,
        lat: targetPos.lat,
        lon: targetPos.lon,
        altFt,
        altDisplay,
        speedKts,
        mach: legMach,
        bearingTrueDeg,
        bearingMagDeg: trueToMag(bearingTrueDeg, magDecl),
        legDistNm,
        cumulativeDistNm,
        legEteSeconds,
        cumulativeTimeSeconds,
        remarks,
      });
    };

    const aglAlt = (aglFt: number) => ({
      altFt: fieldElev + aglFt,
      altDisplay: `${(fieldElev + aglFt).toLocaleString()} ft MSL (${aglFt.toLocaleString()} ft AGL)`,
    });

    const shuffledNames = [...CHECKPOINT_NAMES].sort(() => 0.5 - Math.random());
    let nameIndex = 0;
    const getName = () => shuffledNames[nameIndex++ % shuffledNames.length];

    // 1. Procedural runway departure towards the LLTR entry
    const approxEntryPos = destinationPoint(airbase.latitude, airbase.longitude, 12, baseSectorHeading);
    const departureExitPos = addProceduralDeparture(waypoints, airbase, depWeather, magDecl, approxEntryPos, addLeg);

    // 2. LLTR entry fix
    // Short pairs: keep the corridor entry well before the field
    const entryDist = Math.max(3, Math.min(15, Math.max(8, distToTng * 0.12), distToTng * 0.4));
    const entryPos = destinationPoint(
      departureExitPos.lat,
      departureExitPos.lon,
      entryDist,
      calculateBearingDeg(departureExitPos.lat, departureExitPos.lon, field.lat, field.lon)
    );
    const entrySafety = getLowLevelCorridorSafety(entryPos.lat, entryPos.lon, airbase.elevationFt);
    const entryAltFt = entrySafety.minSafeAltFt + 800;

    addLeg(
      'LLTR ENTRY',
      'MTR_ENTRY',
      entryPos,
      entryAltFt,
      `${entryAltFt.toLocaleString()} ft MSL`,
      420,
      '0.67',
      `Corridor ingress on sector ${baseSectorHeading}°M towards T&G ${tngAirbase.ident} (${rwyLabel}). Step descent to tactical floor. Arm terrain radar.`
    );

    // 3. Outbound low-level legs (~20 NM each), re-aimed at the approach entry fix
    const outPoly: LatLon[] = [entryPos];
    let curPos: LatLon = entryPos;
    // Dogleg legs cover less ground towards the target than their length, so keep adding ~20 NM
    // legs until the remaining distance is short (final leg stays between ~10 and ~30 NM).
    const OUTBOUND_LEG_NM = 20;
    let doglegSign = 1;

    for (
      let i = 1;
      i <= 40 && calculateDistanceNm(curPos.lat, curPos.lon, entryTarget.lat, entryTarget.lon) > 1.5 * OUTBOUND_LEG_NM;
      i++
    ) {
      const brgToTarget = calculateBearingDeg(curPos.lat, curPos.lon, entryTarget.lat, entryTarget.lon);
      const turnAngle = useDoglegs ? (25 + Math.random() * 13) * doglegSign : 0;
      doglegSign *= -1;
      const nextPos = destinationPoint(curPos.lat, curPos.lon, OUTBOUND_LEG_NM, (brgToTarget + turnAngle + 360) % 360);
      const cpSafety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
      const tacticalAltFt = cpSafety.minSafeAltFt + Math.floor(Math.random() * 3) * 100;
      const agl = tacticalAltFt - cpSafety.groundElevFt;

      addLeg(
        `CP ${getName()}`,
        'CHECKPOINT',
        nextPos,
        tacticalAltFt,
        `${tacticalAltFt.toLocaleString()} ft MSL (${agl.toLocaleString()} ft AGL)`,
        cruiseSpeedKts,
        mach,
        `Outbound tactical corridor to ${tngAirbase.ident} T&G (${rwyLabel}). 450 KIAS low-level navigation.`
      );
      outPoly.push(nextPos);
      curPos = nextPos;
    }
    outPoly.push(entryTarget);

    // 4. Touch & Go sequence
    if (straightIn) {
      addLeg(
        'TNG IP',
        'IP',
        ipPos,
        aglAlt(1500).altFt,
        aglAlt(1500).altDisplay,
        350,
        '0.54',
        `Initial Point for ${tngAirbase.ident} touch-and-go, 8 NM final. Aligned on ${rwyLabel} (HDG ${Math.round(tngRwyMag)}°M / ${Math.round(rwyTrue)}°T). Decelerate to 350 KIAS.`
      );
      addLeg(
        'TNG FINAL',
        'IP',
        finalPos,
        aglAlt(800).altFt,
        aglAlt(800).altDisplay,
        200,
        '0.30',
        `3 NM final ${rwyLabel}. Gear down, flaps, 200 KIAS.`
      );
    } else {
      addLeg(
        'TNG PATTERN ENTRY',
        'IP',
        pg.joinPos,
        aglAlt(1500).altFt,
        aglAlt(1500).altDisplay,
        300,
        '0.46',
        `Join ${pg.dir > 0 ? 'right' : 'left'} downwind for ${rwyLabel} at ${tngAirbase.ident}${farSideJoin ? ' (far-side join: the home-side entry turn is too tight)' : ` from the ${getCardinal(Math.round(homeBrg))} side`}. 1,500 ft AGL, 300 KIAS.`
      );
      addLeg(
        'TNG DOWNWIND',
        'CHECKPOINT',
        pg.abeamPos,
        aglAlt(1200).altFt,
        aglAlt(1200).altDisplay,
        200,
        '0.30',
        `Downwind abeam touchdown zone ${rwyLabel}. Gear down, half flaps, 200 KIAS.`
      );
      addLeg(
        'TNG PERCH',
        'CHECKPOINT',
        pg.perchPos,
        aglAlt(1000).altFt,
        aglAlt(1000).altDisplay,
        190,
        '0.29',
        `Past the threshold, start the descending turn to final ${rwyLabel}. 190 KIAS.`
      );
      addLeg(
        'TNG BASE',
        'CHECKPOINT',
        pg.basePos,
        aglAlt(800).altFt,
        aglAlt(800).altDisplay,
        175,
        '0.26',
        `Base turn ${rwyLabel}. Full flaps, 175 KIAS.`
      );
      addLeg(
        'TNG TURN FINAL',
        'IP',
        pg.turnFinalPos,
        aglAlt(600).altFt,
        aglAlt(600).altDisplay,
        165,
        '0.25',
        `Rolling out on ${rwyLabel} centerline, 165 KIAS.`
      );
    }

    addLeg(
      'TNG SHORT FINAL',
      'IP',
      shortFinalPos,
      aglAlt(400).altFt,
      aglAlt(400).altDisplay,
      160,
      '0.24',
      `Short final ${rwyLabel} at ${tngAirbase.ident}. On glideslope, 160 KIAS.`
    );
    addLeg(
      'TNG TOUCH & GO',
      'TNG',
      touchdownPos,
      fieldElev,
      `${fieldElev.toLocaleString()} ft MSL (0 ft AGL)`,
      140,
      '0.21',
      `Touch-and-go on ${rwyLabel} (${tngAirbase.ident}). Wheels on deck, military power, rotate.`
    );
    addLeg(
      'TNG CLIMB-OUT',
      'CLIMB',
      climbOutPos,
      aglAlt(1500).altFt,
      aglAlt(1500).altDisplay,
      250,
      '0.38',
      `Runway-heading climb-out ${rwyLabel}. Gear up, accelerate to 250 KIAS.`
    );

    // Departure turn so the return never needs a >90° reversal at the climb-out fix
    let lastTngPos: LatLon = climbOutPos;
    const brgClimbToHome = calculateBearingDeg(climbOutPos.lat, climbOutPos.lon, airbase.latitude, airbase.longitude);
    const reversal = angularDiffDeg(rwyTrue, brgClimbToHome);
    if (Math.abs(reversal) > 80) {
      const turnSide = reversal >= 0 ? 1 : -1;
      const turnPos = destinationPoint(climbOutPos.lat, climbOutPos.lon, 3, (rwyTrue + 90 * turnSide + 360) % 360);
      addLeg(
        'TNG DEPARTURE TURN',
        'CLIMB',
        turnPos,
        aglAlt(1500).altFt,
        aglAlt(1500).altDisplay,
        320,
        '0.49',
        `Turn ${turnSide > 0 ? 'right' : 'left'} off the climb-out towards ${airbase.ident}. Accelerate to 320 KIAS, descend to the return corridor.`
      );
      lastTngPos = turnPos;
    }

    // 5. Return low-level legs via a displaced via-point (separates return from outbound track)
    const egressApprox = destinationPoint(
      airbase.latitude,
      airbase.longitude,
      14,
      calculateBearingDeg(airbase.latitude, airbase.longitude, lastTngPos.lat, lastTngPos.lon)
    );
    const lineBrg = calculateBearingDeg(lastTngPos.lat, lastTngPos.lon, egressApprox.lat, egressApprox.lon);
    // Ramp out to the lateral offset within ~15 NM, run parallel, ramp back in towards home.
    const lineLen = calculateDistanceNm(lastTngPos.lat, lastTngPos.lon, egressApprox.lat, egressApprox.lon);
    const ramp = Math.min(15, 0.25 * lineLen);
    const lineP1 = destinationPoint(lastTngPos.lat, lastTngPos.lon, ramp, lineBrg);
    const lineP2 = destinationPoint(egressApprox.lat, egressApprox.lon, ramp, (lineBrg + 180) % 360);
    const buildReturnPoly = (sideBrg: number): LatLon[] => [
      lastTngPos,
      destinationPoint(lineP1.lat, lineP1.lon, returnOffsetNm, sideBrg),
      destinationPoint(lineP2.lat, lineP2.lon, returnOffsetNm, sideBrg),
      egressApprox,
    ];
    // Pick the side whose parallel track stays farther from the real outbound path.
    const minSeparation = (poly: LatLon[]): number => {
      let best = Infinity;
      const total = calculateDistanceNm(poly[0].lat, poly[0].lon, poly[1].lat, poly[1].lon) +
        calculateDistanceNm(poly[1].lat, poly[1].lon, poly[2].lat, poly[2].lon) +
        calculateDistanceNm(poly[2].lat, poly[2].lon, poly[3].lat, poly[3].lon);
      for (let d = 20; d < total - 20; d += 5) {
        const pt = pointAlongPolyline(poly, d).pos;
        best = Math.min(best, pointToPolylineNm(pt, outPoly));
      }
      return best;
    };
    const polyA = buildReturnPoly((lineBrg + 90) % 360);
    const polyB = buildReturnPoly((lineBrg + 270) % 360);
    // Prefer the side that keeps the first return turn moderate; among acceptable sides, the one
    // with the larger separation from the outbound track.
    const arrivalBrg = waypoints[waypoints.length - 1].bearingTrueDeg;
    const firstTurn = (poly: LatLon[]): number =>
      Math.abs(angularDiffDeg(arrivalBrg, calculateBearingDeg(lastTngPos.lat, lastTngPos.lon, poly[1].lat, poly[1].lon)));
    const turnA = firstTurn(polyA);
    const turnB = firstTurn(polyB);
    const MAX_FIRST_TURN = 100;
    let retPoly: LatLon[];
    if (forceSide !== undefined) {
      retPoly = forceSide === 0 ? polyA : polyB;
    } else if (turnA <= MAX_FIRST_TURN && turnB <= MAX_FIRST_TURN) {
      retPoly = minSeparation(polyA) >= minSeparation(polyB) ? polyA : polyB;
    } else if (turnA <= MAX_FIRST_TURN || turnB <= MAX_FIRST_TURN) {
      retPoly = turnA <= MAX_FIRST_TURN ? polyA : polyB;
    } else {
      retPoly = turnA <= turnB ? polyA : polyB;
    }
    let retLen = 0;
    for (let i = 0; i < retPoly.length - 1; i++) {
      retLen += calculateDistanceNm(retPoly[i].lat, retPoly[i].lon, retPoly[i + 1].lat, retPoly[i + 1].lon);
    }
    const numInbound = Math.max(1, Math.round(retLen / 20) - 1);

    const retCps: LatLon[] = [];
    for (let i = 1; i <= numInbound; i++) {
      const along = pointAlongPolyline(retPoly, (retLen * i) / (numInbound + 1));
      let nextPos: LatLon = along.pos;
      if (useDoglegs) {
        // Small lateral jitter, always towards the side that keeps clear of the outbound track.
        const amount = 1.5 + Math.random() * 1.5;
        const left = destinationPoint(along.pos.lat, along.pos.lon, amount, (along.bearing + 270) % 360);
        const right = destinationPoint(along.pos.lat, along.pos.lon, amount, (along.bearing + 90) % 360);
        nextPos = pointToPolylineNm(left, outPoly) >= pointToPolylineNm(right, outPoly) ? left : right;
      }
      const inSafety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
      const tacticalAltFt = inSafety.minSafeAltFt + Math.floor(Math.random() * 3) * 100;
      const agl = tacticalAltFt - inSafety.groundElevFt;
      const isLast = i === numInbound;

      addLeg(
        isLast ? 'IP HOME' : `CP ${getName()}`,
        isLast ? 'IP' : 'CHECKPOINT',
        nextPos,
        tacticalAltFt,
        `${tacticalAltFt.toLocaleString()} ft MSL (${agl.toLocaleString()} ft AGL)`,
        cruiseSpeedKts,
        mach,
        isLast
          ? `Initial Point for home recovery at ${airbase.ident}. Prepare for corridor egress and overhead break.`
          : `Return corridor from ${tngAirbase.ident} T&G, offset from the outbound track. 450 KIAS.`
      );
      retCps.push(nextPos);
      curPos = nextPos;
    }

    // 6. LLTR egress
    const distToHome = calculateDistanceNm(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
    const egressDist = Math.max(5, Math.min(12, distToHome - 12));
    const egressPos = destinationPoint(
      curPos.lat,
      curPos.lon,
      egressDist,
      calculateBearingDeg(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude)
    );
    const egressSafety = getLowLevelCorridorSafety(egressPos.lat, egressPos.lon, airbase.elevationFt);
    const egressAltFt = egressSafety.minSafeAltFt + 1500;

    addLeg(
      'LLTR EGRESS',
      'EGRESS',
      egressPos,
      egressAltFt,
      `${egressAltFt.toLocaleString()} ft MSL`,
      400,
      '0.64',
      `Corridor exit. Step climb to ${egressAltFt.toLocaleString()} ft MSL, contact ${airbase.ident} Tower (${airbase.towerMhz || '128.700 MHz'}).`
    );

    // 7. Recovery at the departure airbase
    addAirfieldRecovery(recoveryType, egressPos, airbase, depWeather, magDecl, addLeg);

    const lastWp = waypoints[waypoints.length - 1];
    const plan: GeneratedFlightPlan = {
      sortieId,
      callsign,
      flightRules: 'VFR',
      aircraftType: 'Fighter Jet',
      missionProfile: 'lltr_tng',
      recoveryType,
      operatingAirbase: airbase,
      destinationAirbase: undefined,
      tngAirbase,
      tngWeather,
      isPointToPoint: false,
      weatherMode: depWeather.source === 'STANDARD_ISA' ? 'neutral' : 'live',
      departureWeather: depWeather,
      totalDistanceNm: Math.round(lastWp.cumulativeDistNm),
      totalFlightTimeMin: Math.round(lastWp.cumulativeTimeSeconds / 60),
      assignedAltitude: '≥1,500 ft above the highest terrain on each leg (MSL varies)',
      cruiseSpeedKts,
      squawk,
      tacFrequencyMhz: tacFreq,
      sectorHeadingDeg: baseSectorHeading,
      sectorDescription,
      waypoints,
      generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    return { plan, outPoly, retCps };
  };

  // Validity: field is the farthest point, the pattern stays local, the entry turn is moderate,
  // and the mid-route return keeps its lateral separation from the outbound track.
  // Relaxed mode is a second pass for pairs where the strict rules cannot be met (short distances, where the
  // pattern geometry itself extends beyond the field, and some awkward runway/approach combinations).
  // level 0 = strict, 1 = relaxed, 2 = minimal (short pairs only: the fields are so close that sharp turns are unavoidable)
  const isValid = (attempt: ReturnType<typeof buildPlanAttempt>, level: 0 | 1 | 2 = 0): boolean => {
    const farMarginNm = [0, 14, 30][level];
    const entryTurnMaxDeg = [110, 140, 178][level];
    const turnMaxDeg = [115, 135, 178][level];
    const separationFactor = level === 0 ? 0.4 : level === 1 ? (distToTng < 40 ? 0 : 0.15) : 0;
    const wps = attempt.plan.waypoints;
    for (const wp of wps) {
      const dDep = calculateDistanceNm(airbase.latitude, airbase.longitude, wp.lat, wp.lon);
      if (wp.name.startsWith('TNG')) {
        if (calculateDistanceNm(field.lat, field.lon, wp.lat, wp.lon) > 10) return false;
      } else if (dDep >= distToTng + farMarginNm) {
        return false;
      }
    }
    const entryIdx = wps.findIndex((w) => w.name === 'TNG IP' || w.name === 'TNG PATTERN ENTRY');
    if (entryIdx < 0 || entryIdx >= wps.length - 1) return false;
    if (Math.abs(angularDiffDeg(wps[entryIdx].bearingTrueDeg, wps[entryIdx + 1].bearingTrueDeg)) > entryTurnMaxDeg) return false;

    for (let k = 1; k < wps.length - 1; k++) {
      const w = wps[k];
      const checked = w.name.startsWith('TNG') || ['CHECKPOINT', 'IP', 'EGRESS', 'MTR_ENTRY'].includes(w.type);
      if (checked && Math.abs(angularDiffDeg(w.bearingTrueDeg, wps[k + 1].bearingTrueDeg)) > turnMaxDeg) return false;
    }

    for (const cp of attempt.retCps) {
      const farFromField = calculateDistanceNm(cp.lat, cp.lon, field.lat, field.lon) > 20;
      const farFromHome = calculateDistanceNm(cp.lat, cp.lon, airbase.latitude, airbase.longitude) > 20;
      if (farFromField && farFromHome && pointToPolylineNm(cp, attempt.outPoly) < separationFactor * returnOffsetNm) return false;
    }
    return true;
  };

  // Random attempts first (preferred return side), then alternate forcing each return side.
  // If the home-side downwind join needs a too-sharp entry turn, try the far-side join too.
  // Finally a no-dogleg fallback on every combination.
  const patternSides: Array<1 | -1> = straightIn ? [preferredPatternDir] : [preferredPatternDir, preferredPatternDir === 1 ? -1 : 1];
  for (const dir of patternSides) {
    const attempts = dir === preferredPatternDir ? 120 : 60;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const forceSide = attempt < 30 ? undefined : ((attempt % 2) as 0 | 1);
      const built = buildPlanAttempt(true, forceSide, dir);
      if (isValid(built)) return built.plan;
    }
  }
  for (const dir of patternSides) {
    for (const side of [undefined, 0, 1] as const) {
      const fallback = buildPlanAttempt(false, side, dir);
      if (isValid(fallback)) return fallback.plan;
    }
  }
  // Second pass with relaxed rules. Any distance is allowed; the plan is simply less tidy when the fields are close.
  for (const dir of patternSides) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const forceSide = attempt < 20 ? undefined : ((attempt % 2) as 0 | 1);
      const built = buildPlanAttempt(true, forceSide, dir);
      if (isValid(built, 1)) return built.plan;
    }
  }
  for (const dir of patternSides) {
    for (const side of [undefined, 0, 1] as const) {
      const fallback = buildPlanAttempt(false, side, dir);
      if (isValid(fallback, 1)) return fallback.plan;
    }
  }
  // Very close fields: accept whatever geometry works
  if (distToTng < 30) {
    for (const dir of patternSides) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const built = buildPlanAttempt(attempt % 2 === 0, undefined, dir);
        if (isValid(built, 2)) return built.plan;
      }
    }
  }
  throw new Error('TNG_ROUTE_INVALID');
}

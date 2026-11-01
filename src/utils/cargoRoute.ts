import type {
  Airport,
  AirportWeather,
  FlightWaypoint,
  GeneratedFlightPlan,
  SortieDuration,
} from '../types/flightDesk';
import {
  angularDiffDeg,
  calculateBearingDeg,
  calculateDistanceNm,
  destinationPoint,
  magToTrue,
  trueToMag,
} from './geo';
import { getLowLevelCorridorSafety } from './lowLevelSafety';

/**
 * Tactical airlift (C-130 / A400M / C-295 class) low-level route generator.
 *
 * Same route concept as the fighter LLTR (departure arc, corridor entry, outbound legs, a turnaround
 * loop, inbound legs, egress, recovery) but tuned for a slower, heavier aircraft:
 *  - 250 KIAS in the corridor (fighters: 450 KIAS), speeds stepped down for each phase.
 *  - Gentler turns: legs bend by 15-26° (fighters 25-38°), the turnaround is flown in steps of
 *    at most 50° (fighters 60°), departure arcs use steps of at most 35°.
 *  - Longer climb: the aircraft needs about 3 NM to reach 1,000 ft AGL and climbs ~900 ft per step.
 *  - Recovery is a straight-in final or a wide (2 NM) visual pattern with cargo speeds,
 *    not a 350 KIAS overhead break.
 *  - Same obstacle assumption as the fighters (masts up to ~1,150 ft AGL), so low-level altitudes
 *    stay at least 1,500 ft above terrain: the terrain data has no obstacles in it.
 */

export const CARGO_CALLSIGNS = [
  'REACH',
  'HERKY',
  'ATLAS',
  'CARGO',
  'NOMAD',
  'MOOSE',
  'TROJAN',
  'HAULER',
  'SHERPA',
  'CAMEL',
];

// Checkpoint names avoid words that the exporters use to recognise special waypoints.
const CARGO_CHECKPOINT_NAMES = [
  'ATLAS',
  'SHERPA',
  'CARGO',
  'NOMAD',
  'MOOSE',
  'TROJAN',
  'HAULER',
  'CAMEL',
  'BEACON',
  'CARAVAN',
  'MESA',
  'HARBOR',
  'PILOT',
  'ANCHOR',
  'SADDLE',
  'FREIGHT',
  'DRAYMAN',
  'LANTERN',
];

/** Tunable cargo parameters (KIAS unless noted). */
export const CARGO_PROFILE = {
  lowLevelKias: 250,
  apexKias: 230,
  egressKias: 230,
  entryAltAboveFloorFt: 500,
  egressAltAboveFloorFt: 1500,
  maxApexStepDeg: 50,
  maxDepartureStepDeg: 35,
  apexLegNm: 6,
  departureLegNm: 3,
  patternWidthNm: 2,
  /** Recovery transition: maximum heading change per waypoint and distance between its waypoints. */
  maxRecoveryStepDeg: 55,
  /** The last corridor fix stays at least this far from the field. */
  minIpDistToFieldNm: 22,
  recoveryStepNm: 4,
};

type LatLon = { lat: number; lon: number };

type AddLeg = (
  name: string,
  type: FlightWaypoint['type'],
  pos: LatLon,
  altFt: number,
  altDisplay: string,
  speedKts: number,
  remarks: string
) => void;

export interface CargoLltrContext {
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
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Approximate Mach number for an indicated airspeed at an altitude (ISA, good to ~0.01 at these speeds). */
function machFor(kias: number, altFt: number): string {
  const tas = kias * (1 + 0.02 * (altFt / 1000));
  const soundKts = 661.5 * Math.sqrt((288.15 - 0.00198 * altFt) / 288.15);
  return (tas / soundKts).toFixed(2);
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Runway geometry shared by departure and recovery. */
function runwayGeometry(airbase: Airport, weather: AirportWeather, magDecl: number) {
  const rwyMag = weather.activeRunwayHeadingDeg;
  const rwyTrue =
    weather.activeRunwayTrueHeadingDeg !== undefined ? weather.activeRunwayTrueHeadingDeg : magToTrue(rwyMag, magDecl);
  const halfRwyNm = Math.min(1.2, Math.max(0.5, (airbase.longestRunwayFt || 8000) / 6076.1 / 2));
  const recip = (rwyTrue + 180) % 360;
  return { rwyMag, rwyTrue, halfRwyNm, recip };
}

/**
 * Takeoff, straight climb-out and a departure arc whose steps never exceed 35°.
 * Returns the last departure position.
 */
function addDeparture(
  waypoints: FlightWaypoint[],
  airbase: Airport,
  weather: AirportWeather,
  magDecl: number,
  targetPoint: LatLon,
  addLeg: AddLeg
): LatLon {
  const { rwyMag, rwyTrue, halfRwyNm, recip } = runwayGeometry(airbase, weather, magDecl);
  const elev = airbase.elevationFt;
  const rwy = weather.activeRunway;

  const thresholdPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyNm, recip);
  const derPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyNm, rwyTrue);
  const climboutPos = destinationPoint(derPos.lat, derPos.lon, 3, rwyTrue);

  waypoints.push({
    id: 'wp-0',
    name: airbase.ident,
    type: 'DEP',
    lat: thresholdPos.lat,
    lon: thresholdPos.lon,
    altFt: elev,
    altDisplay: `${fmt(elev)} ft MSL`,
    speedKts: 120,
    mach: machFor(120, elev),
    bearingTrueDeg: Math.round(rwyTrue),
    bearingMagDeg: rwyMag,
    legDistNm: 0,
    cumulativeDistNm: 0,
    legEteSeconds: 0,
    cumulativeTimeSeconds: 0,
    remarks: weather.isCalm
      ? `Takeoff ${rwy} threshold (HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T). Takeoff power, accelerate down the centerline.`
      : `Takeoff ${rwy} (HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T). Wind ${weather.windDirDeg}°@${weather.windSpeedKts}KT, QNH ${weather.altimeterInHg.toFixed(2)} inHg. Takeoff power, accelerate down the centerline.`,
  });

  addLeg(
    `${rwy} LIFTOFF`,
    'DEP',
    derPos,
    elev + 150,
    `${fmt(elev + 150)} ft MSL`,
    140,
    `Airborne over the departure end of ${rwy}. Positive rate, gear up, climb on runway heading ${rwyMag}°M.`
  );

  addLeg(
    `${rwy} CLIMBOUT`,
    'CLIMB',
    climboutPos,
    elev + 1000,
    `${fmt(elev + 1000)} ft MSL`,
    160,
    `Straight climb on the extended centerline ${rwyMag}°M to 1,000 ft AGL, flaps up, accelerate to 160 KIAS.`
  );

  const targetBrg = calculateBearingDeg(climboutPos.lat, climboutPos.lon, targetPoint.lat, targetPoint.lon);
  const turn = angularDiffDeg(rwyTrue, targetBrg);
  const absTurn = Math.abs(turn);
  const dir = turn >= 0 ? 1 : -1;

  if (absTurn <= CARGO_PROFILE.maxDepartureStepDeg) return climboutPos;

  // Every turn (the arc steps and the final turn onto the route) stays within maxDepartureStepDeg.
  const steps = Math.ceil(absTurn / CARGO_PROFILE.maxDepartureStepDeg) - 1;
  const stepAngle = absTurn / (steps + 1);
  let hdg = rwyTrue;
  let pos = climboutPos;

  for (let i = 1; i <= steps; i++) {
    hdg = (hdg + dir * stepAngle + 360) % 360;
    pos = destinationPoint(pos.lat, pos.lon, CARGO_PROFILE.departureLegNm, hdg);
    const altFt = elev + Math.min(6000, 1000 + 900 * i);
    const name =
      i === 1 ? 'CROSSWIND DEP' : i === steps ? 'DEPARTURE ROLLOUT' : i === 2 ? 'DOWNWIND ARC' : `DEPARTURE ARC ${i}`;
    addLeg(
      name,
      'CLIMB',
      pos,
      altFt,
      `${fmt(altFt)} ft MSL`,
      Math.min(230, 170 + 15 * i),
      i === steps
        ? `Rollout from the departure arc on course to the corridor (HDG ${trueToMag(hdg, magDecl)}°M). Climbing through ${fmt(altFt - elev)} ft AGL.`
        : `Departure turn ${dir > 0 ? 'right' : 'left'}, heading ${trueToMag(hdg, magDecl)}°M, bank 25° max. Climbing through ${fmt(altFt - elev)} ft AGL.`
    );
  }

  return pos;
}

type Fix = { name: string; pos: LatLon; aglFt: number; kias: number; remarks: string };

/** Largest heading change (degrees) along a path that arrives with `incomingBrg` at its first point. */
function maxTurnAlong(start: LatLon, incomingBrg: number, points: LatLon[]): number {
  let worst = 0;
  let prev = start;
  let brgIn = incomingBrg;
  for (const p of points) {
    const brgOut = calculateBearingDeg(prev.lat, prev.lon, p.lat, p.lon);
    worst = Math.max(worst, Math.abs(angularDiffDeg(brgIn, brgOut)));
    brgIn = brgOut;
    prev = p;
  }
  return worst;
}

/**
 * Turn-limited transition into the recovery. Starting at the first recovery fix and flying backwards
 * (away from the field, opposite to the arrival heading), steer towards the egress point with at most
 * maxRecoveryStepDeg of heading change per step. Reversed, this gives waypoints that join the first
 * fix on its arrival heading with no turn above the limit (no near-reversal after the egress).
 * Returns the waypoints in flight order, excluding the egress point and the first fix.
 */
function transitionPath(target: LatLon, arrivalHdg: number, from: LatLon, incomingBrg: number): LatLon[] {
  const step = CARGO_PROFILE.recoveryStepNm;
  const maxStep = CARGO_PROFILE.maxRecoveryStepDeg;
  const pts: LatLon[] = [];
  let pos = target;
  let hdg = (arrivalHdg + 180) % 360; // flying backwards from the fix

  for (let i = 0; i < 12; i++) {
    const brgToFrom = calculateBearingDeg(pos.lat, pos.lon, from.lat, from.lon);
    const turnHere = Math.abs(angularDiffDeg(hdg, brgToFrom));
    // Forward bearing of the leg that would leave `from` towards pos:
    const forwardBrg = (brgToFrom + 180) % 360;
    const turnAtFrom = Math.abs(angularDiffDeg(incomingBrg, forwardBrg));
    if (turnHere <= maxStep && turnAtFrom <= maxStep + 10) break;
    const diff = angularDiffDeg(hdg, brgToFrom);
    const turn = Math.max(-maxStep, Math.min(maxStep, diff));
    hdg = (hdg + turn + 360) % 360;
    pos = destinationPoint(pos.lat, pos.lon, step, hdg);
    pts.push(pos);
  }
  return pts.reverse();
}

/**
 * Recovery: a straight-in final or a wide visual pattern (2 NM) on either side.
 * All three are built and the one with the smallest turns from the egress point is flown.
 */
function addRecovery(
  lastPos: LatLon,
  incomingBrg: number,
  egressAltFt: number,
  airbase: Airport,
  weather: AirportWeather,
  magDecl: number,
  addLeg: AddLeg
): void {
  const { rwyMag, rwyTrue, halfRwyNm, recip } = runwayGeometry(airbase, weather, magDecl);
  const elev = airbase.elevationFt;
  const rwy = weather.activeRunway;
  const width = CARGO_PROFILE.patternWidthNm;

  const thresholdPos = destinationPoint(airbase.latitude, airbase.longitude, halfRwyNm, recip);
  const touchdownPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, 0.3, rwyTrue);
  const rolloutPos = destinationPoint(thresholdPos.lat, thresholdPos.lon, Math.max(0.6, halfRwyNm * 2 * 0.6), rwyTrue);

  // x: NM before the threshold on the approach side (negative: beyond the runway), y: NM to the pattern side.
  const rel = (x: number, y: number, sideBrg: number): LatLon => {
    const along =
      x >= 0
        ? destinationPoint(thresholdPos.lat, thresholdPos.lon, x, recip)
        : destinationPoint(thresholdPos.lat, thresholdPos.lon, -x, rwyTrue);
    return y === 0 ? along : destinationPoint(along.lat, along.lon, y, sideBrg);
  };

  const axisHdgText = `HDG ${rwyMag}°M / ${Math.round(rwyTrue)}°T`;

  const tail = (): Fix[] => [
    {
      name: `FINAL 3 NM ${rwy}`,
      pos: rel(3, 0, 0),
      aglFt: 1000,
      kias: 145,
      remarks: `3 NM final ${rwy}, ${axisHdgText}. Gear down, landing flaps, 145 KIAS.`,
    },
    {
      name: `SHORT FINAL ${rwy}`,
      pos: rel(1, 0, 0),
      aglFt: 330,
      kias: 130,
      remarks: `Short final ${rwy}. Stabilized on the 3° path, 130 KIAS.`,
    },
  ];

  const straightIn: Fix[] = [
    {
      name: `IAF ${rwy}`,
      pos: rel(10, 0, 0),
      aglFt: 3000,
      kias: 200,
      remarks: `Initial approach fix, 10 NM final ${rwy}, ${axisHdgText}. 3,000 ft AGL, 200 KIAS. Straight-in.`,
    },
    {
      name: `FINAL 5 NM ${rwy}`,
      pos: rel(5, 0, 0),
      aglFt: 1600,
      kias: 160,
      remarks: `5 NM final ${rwy}. Approach flaps, intercept the 3° path, 160 KIAS.`,
    },
    ...tail(),
  ];

  const joinFixes = (dir: 1 | -1): Fix[] => {
    const sideBrg = (rwyTrue + 90 * dir + 360) % 360;
    const side = dir > 0 ? 'right' : 'left';
    return [
      {
        name: `PATTERN ENTRY ${rwy}`,
        pos: rel(-4, width, sideBrg),
        aglFt: 1500,
        kias: 200,
        remarks: `Join the ${side} downwind for ${rwy} at 1,500 ft AGL, 200 KIAS, ${width} NM abeam the runway.`,
      },
      {
        name: `DOWNWIND ${rwy}`,
        pos: rel(0, width, sideBrg),
        aglFt: 1500,
        kias: 170,
        remarks: `Downwind abeam the touchdown zone. Gear down, approach flaps, 170 KIAS.`,
      },
      {
        name: `BASE TURN ${rwy}`,
        pos: rel(3, width, sideBrg),
        aglFt: 1400,
        kias: 155,
        remarks: `Start the descending ${side} turn to base. 155 KIAS.`,
      },
      {
        name: `BASE ${rwy}`,
        pos: rel(4, width / 2, sideBrg),
        aglFt: 1200,
        kias: 150,
        remarks: `Base leg, landing flaps. 150 KIAS.`,
      },
      ...tail(),
    ];
  };

  // Build the three recoveries, each with a turn-limited transition from the egress point, and fly the
  // shortest one whose turns stay small (a small bonus favours the straight-in).
  const options = [
    { fixes: straightIn, arrivalHdg: rwyTrue, bonus: -18 },
    { fixes: joinFixes(1), arrivalHdg: recip, bonus: 0 },
    { fixes: joinFixes(-1), arrivalHdg: recip, bonus: 0 },
  ].map((o) => {
    const trans = transitionPath(o.fixes[0].pos, o.arrivalHdg, lastPos, incomingBrg);
    const keyPoints = [...trans, o.fixes[0].pos, o.fixes[1].pos];
    const worstTurn = maxTurnAlong(lastPos, incomingBrg, keyPoints);
    let lengthNm = 0;
    let prev = lastPos;
    for (const p of [...trans, o.fixes[0].pos]) {
      lengthNm += calculateDistanceNm(prev.lat, prev.lon, p.lat, p.lon);
      prev = p;
    }
    return { ...o, trans, cost: lengthNm + 4 * Math.max(0, worstTurn - 60) + o.bonus };
  });
  options.sort((x, y) => x.cost - y.cost);
  const chosen = options[0];

  // Transition waypoints descend from the egress altitude to the first fix altitude.
  const firstFix = chosen.fixes[0];
  const firstAltFt = elev + firstFix.aglFt;
  const startAltFt = Math.max(firstAltFt, egressAltFt);
  chosen.trans.forEach((pos, i) => {
    const frac = (i + 1) / (chosen.trans.length + 1);
    const altFt = Math.round((startAltFt + (firstAltFt - startAltFt) * frac) / 100) * 100;
    addLeg(
      `RECOVERY TURN ${i + 1}`,
      'RECOVERY',
      pos,
      altFt,
      `${fmt(altFt)} ft MSL`,
      200,
      `Recovery transition, heading change 55° max per fix, 200 KIAS. Setting up for ${chosen.fixes === straightIn ? 'a straight-in' : 'the pattern join'} at ${rwy}.`
    );
  });

  for (const fix of chosen.fixes) {
    const altFt = elev + fix.aglFt;
    addLeg(fix.name, 'RECOVERY', fix.pos, altFt, `${fmt(altFt)} ft MSL`, fix.kias, fix.remarks);
  }

  addLeg(
    `${airbase.ident} TOUCHDOWN`,
    'ARR',
    touchdownPos,
    elev,
    `${fmt(elev)} ft MSL`,
    120,
    weather.isCalm
      ? `Touchdown ${rwy} aiming point. Reverse thrust, roll out on the centerline.`
      : `Touchdown ${rwy}. Surface wind ${weather.windDirDeg}°@${weather.windSpeedKts}KT (HW ${weather.headwindKts >= 0 ? `+${weather.headwindKts}` : weather.headwindKts}KT, XW ${Math.abs(weather.crosswindKts)}KT ${weather.crosswindKts >= 0 ? 'R' : 'L'}). Reverse thrust.`
  );

  addLeg(
    airbase.ident,
    'ARR',
    rolloutPos,
    elev,
    `${fmt(elev)} ft MSL`,
    30,
    `Rollout complete on ${rwy} centerline. Vacate at the next taxiway, taxi to the ramp.`
  );
}

/**
 * Tactical airlift low-level route (profile 'low_level_mtr', aircraft class 'cargo').
 */
export function generateCargoLltrPlan(ctx: CargoLltrContext): GeneratedFlightPlan {
  const { airbase, magDecl, callsign, sortieId, baseSectorHeading, sectorDescription, squawk, tacFreq, duration, depWeather } =
    ctx;
  const P = CARGO_PROFILE;
  const cruiseKts = P.lowLevelKias;

  const baseSafety = getLowLevelCorridorSafety(airbase.latitude, airbase.longitude, airbase.elevationFt);
  const assignedAltitude = `${fmt(baseSafety.minSafeAltFt)}–${fmt(baseSafety.minSafeAltFt + 600)} ft MSL (Low-Level / Obstacle Clear)`;

  const waypoints: FlightWaypoint[] = [];

  const addLeg: AddLeg = (name, type, pos, altFt, altDisplay, speedKts, remarks) => {
    const prev = waypoints[waypoints.length - 1];
    const legDist = Math.round(calculateDistanceNm(prev.lat, prev.lon, pos.lat, pos.lon) * 10) / 10;
    const legBrg = Math.round(calculateBearingDeg(prev.lat, prev.lon, pos.lat, pos.lon));
    const legEte = Math.round((legDist / speedKts) * 3600);
    waypoints.push({
      id: `wp-${waypoints.length}`,
      name,
      type,
      lat: pos.lat,
      lon: pos.lon,
      altFt,
      altDisplay,
      speedKts,
      mach: machFor(speedKts, altFt),
      bearingTrueDeg: legBrg,
      bearingMagDeg: trueToMag(legBrg, magDecl),
      legDistNm: legDist,
      cumulativeDistNm: Math.round((prev.cumulativeDistNm + legDist) * 10) / 10,
      legEteSeconds: legEte,
      cumulativeTimeSeconds: prev.cumulativeTimeSeconds + legEte,
      remarks,
    });
  };

  const config =
    duration === 'short'
      ? { entryDist: 8, numOutbound: 2, legDist: 12, numInbound: 2 }
      : duration === 'medium'
      ? { entryDist: 10, numOutbound: 4, legDist: 14, numInbound: 4 }
      : { entryDist: 12, numOutbound: 6, legDist: 16, numInbound: 6 };

  const approxEntryPos = destinationPoint(airbase.latitude, airbase.longitude, config.entryDist + 5, baseSectorHeading);

  // 1. Runway departure and gentle departure arc
  const departureExit = addDeparture(waypoints, airbase, depWeather, magDecl, approxEntryPos, addLeg);

  // 2. Corridor entry
  const entryPos = destinationPoint(
    departureExit.lat,
    departureExit.lon,
    config.entryDist,
    calculateBearingDeg(departureExit.lat, departureExit.lon, approxEntryPos.lat, approxEntryPos.lon)
  );
  const entrySafety = getLowLevelCorridorSafety(entryPos.lat, entryPos.lon, airbase.elevationFt);
  const entryAltFt = entrySafety.minSafeAltFt + P.entryAltAboveFloorFt;
  addLeg(
    'LLTR ENTRY',
    'MTR_ENTRY',
    entryPos,
    entryAltFt,
    `${fmt(entryAltFt)} ft MSL`,
    P.lowLevelKias,
    `Corridor ingress on sector ${baseSectorHeading}°T. Descend to the low-level floor (MSA ${fmt(entrySafety.minSafeAltFt)} ft MSL), 250 KIAS, flaps up.`
  );

  let curPos = entryPos;
  let curBrg = baseSectorHeading;
  let doglegSign = 1;

  const names = [...CARGO_CHECKPOINT_NAMES].sort(() => 0.5 - Math.random());
  let nameIdx = 0;
  const nextName = () => names[nameIdx++ % names.length];

  // 3. Outbound legs, 15°-26° bends, alternating sides
  for (let i = 1; i <= config.numOutbound; i++) {
    curBrg = (curBrg + randomInt(15, 26) * doglegSign + 360) % 360;
    doglegSign *= -1;
    const nextPos = destinationPoint(curPos.lat, curPos.lon, config.legDist, curBrg);
    const safety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
    const altFt = safety.minSafeAltFt + randomInt(0, 2) * 100;
    addLeg(
      `CP ${nextName()}`,
      'CHECKPOINT',
      nextPos,
      altFt,
      `${fmt(altFt)} ft MSL (${fmt(altFt - safety.groundElevFt)} ft AGL)`,
      cruiseKts,
      `Low-level corridor, clear of masts and wind turbines (MSA ${fmt(safety.minSafeAltFt)} ft MSL). 250 KIAS, bank 25° max.`
    );
    curPos = nextPos;
  }

  // 4. Turnaround loop: split into equal steps of at most 50° each
  const apexDir = doglegSign;
  const inboundTargetBrg = (baseSectorHeading + 180) % 360;
  const totalTurn = (((inboundTargetBrg - curBrg) * apexDir) % 360 + 360) % 360;
  const apexSteps = Math.max(3, Math.ceil(totalTurn / P.maxApexStepDeg));
  const apexStepDeg = totalTurn / apexSteps;
  const apexNames = (n: number): string[] =>
    Array.from({ length: n }, (_, i) =>
      i === 0 ? 'APEX FLANK' : i === n - 1 ? 'APEX ROLLOUT' : i === Math.floor((n - 1) / 2) ? 'CORRIDOR APEX' : `APEX TURN ${i + 1}`
    );
  const apexLabels = apexNames(apexSteps);

  let apexBrg = curBrg;
  for (let i = 0; i < apexSteps; i++) {
    apexBrg = i === apexSteps - 1 ? inboundTargetBrg : (apexBrg + apexDir * apexStepDeg + 360) % 360;
    const nextPos = destinationPoint(curPos.lat, curPos.lon, P.apexLegNm, apexBrg);
    const safety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
    const altFt = safety.minSafeAltFt + (i % 3) * 100;
    addLeg(
      apexLabels[i],
      'CHECKPOINT',
      nextPos,
      altFt,
      `${fmt(altFt)} ft MSL`,
      P.apexKias,
      i === apexSteps - 1
        ? `Turnaround complete. Roll out on the inbound corridor (MSA ${fmt(safety.minSafeAltFt)} ft MSL), accelerate to 250 KIAS.`
        : `Corridor turnaround, ${apexDir > 0 ? 'right' : 'left'} turn ${Math.round(apexStepDeg)}° at 230 KIAS, bank 25° max (MSA ${fmt(safety.minSafeAltFt)} ft MSL).`
    );
    curPos = nextPos;
  }
  curBrg = inboundTargetBrg;

  // 5. Inbound legs
  const outboundTotal = config.entryDist + config.numOutbound * config.legDist;
  const inboundLegDist = Math.max(8, Math.round(((outboundTotal - 16) / config.numInbound) * 10) / 10);

  for (let i = 1; i <= config.numInbound; i++) {
    const isLast = i === config.numInbound;
    curBrg = (curBrg + randomInt(12, 22) * doglegSign + 360) % 360;
    doglegSign *= -1;
    // The Initial Point stays well clear of the field so the recovery has room to line up
    // without a near-reversal (the aircraft needs about 9 NM to turn around gently).
    let legNm = inboundLegDist;
    if (isLast) {
      while (
        legNm > 2 &&
        (() => {
          const test = destinationPoint(curPos.lat, curPos.lon, legNm, curBrg);
          return calculateDistanceNm(test.lat, test.lon, airbase.latitude, airbase.longitude) < P.minIpDistToFieldNm;
        })()
      ) {
        legNm = Math.round((legNm - 1) * 10) / 10;
      }
    }
    const nextPos = destinationPoint(curPos.lat, curPos.lon, legNm, curBrg);
    const safety = getLowLevelCorridorSafety(nextPos.lat, nextPos.lon, airbase.elevationFt);
    const altFt = safety.minSafeAltFt + (isLast ? 200 : randomInt(0, 2) * 100);
    addLeg(
      isLast ? 'IP FOXTROT' : `CP ${nextName()}`,
      isLast ? 'IP' : 'CHECKPOINT',
      nextPos,
      altFt,
      `${fmt(altFt)} ft MSL (${fmt(altFt - safety.groundElevFt)} ft AGL)`,
      cruiseKts,
      isLast
        ? `Initial Point. Final low-level check (MSA ${fmt(safety.minSafeAltFt)} ft MSL), prepare to leave the corridor.`
        : `Inbound low-level leg, heading ${trueToMag(curBrg, magDecl)}°M (MSA ${fmt(safety.minSafeAltFt)} ft MSL). 250 KIAS.`
    );
    curPos = nextPos;
  }

  // 6. Egress: gentle exit turn, then climb towards the field
  const homeBrg0 = calculateBearingDeg(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
  const prevWp = waypoints[waypoints.length - 1];
  const turnToHome = angularDiffDeg(prevWp.bearingTrueDeg, homeBrg0);
  const distToApt0 = calculateDistanceNm(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);

  if (Math.abs(turnToHome) > 60 && distToApt0 > 20) {
    const dir = turnToHome >= 0 ? 1 : -1;
    const midBrg = (prevWp.bearingTrueDeg + (dir * Math.abs(turnToHome)) / 2 + 360) % 360;
    const midPos = destinationPoint(curPos.lat, curPos.lon, 7, midBrg);
    const safety = getLowLevelCorridorSafety(curPos.lat, curPos.lon, airbase.elevationFt);
    const midAltFt = safety.minSafeAltFt + 800;
    addLeg(
      'EGRESS TRANSITION',
      'EGRESS',
      midPos,
      midAltFt,
      `${fmt(midAltFt)} ft MSL`,
      240,
      `Corridor exit turn, heading ${trueToMag(midBrg, magDecl)}°M. Climb above the corridor.`
    );
    curPos = midPos;
  }

  const homeBrg = calculateBearingDeg(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
  const distToApt = calculateDistanceNm(curPos.lat, curPos.lon, airbase.latitude, airbase.longitude);
  const egressDist = Math.max(6, Math.min(14, distToApt - 14));
  const egressPos = destinationPoint(curPos.lat, curPos.lon, egressDist, homeBrg);
  const egressSafety = getLowLevelCorridorSafety(egressPos.lat, egressPos.lon, airbase.elevationFt);
  const egressAltFt = egressSafety.minSafeAltFt + P.egressAltAboveFloorFt;
  addLeg(
    'LLTR EGRESS',
    'EGRESS',
    egressPos,
    egressAltFt,
    `${fmt(egressAltFt)} ft MSL`,
    P.egressKias,
    `Corridor exit. Climb to ${fmt(egressAltFt)} ft MSL, contact approach.`
  );

  // 7. Recovery
  addRecovery(
    egressPos,
    waypoints[waypoints.length - 1].bearingTrueDeg,
    egressAltFt,
    airbase,
    depWeather,
    magDecl,
    addLeg
  );

  const last = waypoints[waypoints.length - 1];
  return {
    sortieId,
    callsign,
    flightRules: 'VFR',
    aircraftType: 'Cargo',
    missionProfile: 'low_level_mtr',
    recoveryType: 'visual_pattern',
    operatingAirbase: airbase,
    weatherMode: depWeather.source === 'STANDARD_ISA' ? 'neutral' : 'live',
    departureWeather: depWeather,
    totalDistanceNm: Math.round(last.cumulativeDistNm),
    totalFlightTimeMin: Math.round(last.cumulativeTimeSeconds / 60),
    assignedAltitude,
    cruiseSpeedKts: cruiseKts,
    squawk,
    tacFrequencyMhz: tacFreq,
    sectorHeadingDeg: baseSectorHeading,
    sectorDescription,
    waypoints,
    generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

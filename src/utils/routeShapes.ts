import type { RouteShapeId } from '../types/flightDesk';
import { angularDiffDeg, calculateBearingDeg, calculateDistanceNm, destinationPoint } from './geo';

/**
 * Shapes of the low-level corridor, for fighters and cargo aircraft.
 *
 * The corridor starts at the entry fix near the home field and ends at the Initial Point (IP), which lies
 * 24-34 NM from the field with the last leg heading back towards it. Between the two the route is a circuit
 * around the field, never an out-and-back along its own track:
 *   triangle - two wide turns of about 120°
 *   l_shape  - a right-angle turn, then a long diagonal back (the two legs of an "L" and the way home)
 *   box      - two right-angle turns (a "U" around the field)
 *   loop     - a five- or six-sided ring, turning one way all the time
 *   quad     - a four-leg circuit with three turns of different size
 * Every turn is cut into steps no larger than the aircraft's limit, long legs get a checkpoint every
 * `legNm` with a small sideways offset, and the finished route is checked (see validate) so it never
 * crosses or runs close beside itself and never passes over the home field.
 */

type LatLon = { lat: number; lon: number };
type XY = { x: number; y: number };

export const ROUTE_SHAPE_LABELS: Record<RouteShapeId, string> = {
  triangle: 'Triangle',
  l_shape: 'L-shape',
  box: 'Box',
  loop: 'Loop',
  quad: 'Four-leg circuit',
};

export interface CorridorLimits {
  /** Largest heading change at one waypoint (degrees). */
  maxStepDeg: number;
  /** Radius (NM) the wide turns are flown with. */
  cornerRadiusNm: number;
  /** Typical distance (NM) between checkpoints on a straight leg. */
  legNm: number;
  /** Sideways offset of a checkpoint on a straight leg, as a share of the leg length (min, max). */
  wiggle: [number, number];
  /** The IP lies between these distances (NM) from the home field. */
  minFinalDistNm: number;
  maxFinalDistNm: number;
  /** Largest angle (degrees) between the last leg and the direction to the field. */
  maxFinalTurnDeg: number;
  /** After the first leg the route stays at least this far (NM) from the field. */
  homeClearNm: number;
  /** Two parts of the route that are far apart along the track stay at least this far (NM) from each other. */
  separationNm: number;
  /** "Far apart along the track" (NM). */
  pathGapNm: number;
}

export interface CorridorSpec {
  home: LatLon;
  entry: LatLon;
  /** True heading on arrival at the entry fix. */
  entryHeadingDeg: number;
  /** Wanted length (NM) of the corridor from the entry fix to the IP. */
  lengthNm: number;
  limits: CorridorLimits;
}

export interface CorridorPoint {
  pos: LatLon;
  /** cp: checkpoint on a straight leg; turn: waypoint on a wide turn; ip: the last point. */
  kind: 'cp' | 'turn' | 'ip';
}

export interface Corridor {
  shape: RouteShapeId;
  points: CorridorPoint[];
  lengthNm: number;
}

type Rng = () => number;

const SHAPES: RouteShapeId[] = ['triangle', 'l_shape', 'box', 'loop', 'quad'];
const MIN_STRAIGHT_NM = 5;

const rad = (d: number) => (d * Math.PI) / 180;
const dir = (hdgDeg: number): XY => ({ x: Math.sin(rad(hdgDeg)), y: Math.cos(rad(hdgDeg)) });
const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

function toXY(home: LatLon, p: LatLon): XY {
  const d = calculateDistanceNm(home.lat, home.lon, p.lat, p.lon);
  const b = rad(calculateBearingDeg(home.lat, home.lon, p.lat, p.lon));
  return { x: d * Math.sin(b), y: d * Math.cos(b) };
}

function toLatLon(home: LatLon, p: XY): LatLon {
  const d = Math.hypot(p.x, p.y);
  if (d < 1e-9) return { lat: home.lat, lon: home.lon };
  const brg = ((Math.atan2(p.x, p.y) * 180) / Math.PI + 360) % 360;
  return destinationPoint(home.lat, home.lon, d, brg);
}

function ptSegDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function segSegDist(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b));
}

/** Turn angles (degrees, all turning the same way) of one shape, with a little random variation. */
function shapeTurns(shape: RouteShapeId, rng: Rng): number[] {
  switch (shape) {
    case 'triangle':
      return [between(rng, 108, 128), between(rng, 108, 128)];
    case 'l_shape': {
      const t = [between(rng, 82, 98), between(rng, 118, 142)];
      return rng() < 0.5 ? t : t.reverse();
    }
    case 'box':
      return [between(rng, 82, 98), between(rng, 82, 98)];
    case 'loop': {
      const sides = rng() < 0.5 ? 5 : 6;
      return Array.from({ length: sides - 1 }, () => 360 / sides + between(rng, -4, 4));
    }
    default: {
      for (let i = 0; i < 20; i++) {
        const t = [between(rng, 62, 100), between(rng, 62, 100), between(rng, 62, 100)];
        const sum = t[0] + t[1] + t[2];
        if (sum >= 235 && sum <= 285) return t;
      }
      return [80, 80, 80];
    }
  }
}

/** Intermediate checkpoints on a straight leg: one every `legNm` or so, offset a little to alternating sides. */
function subdivide(a: XY, b: XY, lim: CorridorLimits, rng: Rng, sign: { v: number }): XY[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const m = Math.max(1, Math.round(len / lim.legNm));
  const ux = (b.x - a.x) / (len || 1);
  const uy = (b.y - a.y) / (len || 1);
  const out: XY[] = [];
  for (let k = 1; k < m; k++) {
    const seg = len / m;
    const amp = seg * between(rng, lim.wiggle[0], lim.wiggle[1]) * sign.v;
    sign.v *= -1;
    out.push({
      x: a.x + (b.x - a.x) * (k / m) + -uy * amp,
      y: a.y + (b.y - a.y) * (k / m) + ux * amp,
    });
  }
  return out;
}

interface Built {
  points: { xy: XY; kind: CorridorPoint['kind'] }[];
}

/**
 * One candidate route: the skeleton of straight legs and turns, the turns rounded, the last leg cut where it
 * reaches the wanted distance from the field. Returns null when the skeleton does not fit.
 */
function build(
  spec: CorridorSpec,
  E: XY,
  turns: number[],
  side: 1 | -1,
  firstHdg: number,
  weights: number[],
  scale: number,
  ipDist: number,
  rng: Rng
): Built | null {
  const lim = spec.limits;
  const eff = lim.maxStepDeg * 0.8; // leaves room for the sideways offset of the checkpoints
  const R = lim.cornerRadiusNm;
  const legs = turns.length + 1;
  const tangent = turns.map((t) => (t > eff ? R * Math.tan(rad(t) / 2) : 0));
  const wSum = weights.reduce((a, b) => a + b, 0);

  // Skeleton length: wanted route length plus what the rounded corners save
  const savings = turns.reduce((s, t, i) => (tangent[i] > 0 ? s + 2 * tangent[i] - R * rad(t) : s), 0);
  const total = (spec.lengthNm + savings) * scale;

  const headings: number[] = [firstHdg];
  turns.forEach((t, i) => headings.push(headings[i] + side * t));

  // Corner vertices of the skeleton (all legs but the last have a set length)
  const V: XY[] = [E];
  for (let i = 0; i < legs - 1; i++) {
    const len = (total * weights[i]) / wSum;
    const need = (i > 0 ? tangent[i - 1] : 0) + tangent[i] + MIN_STRAIGHT_NM;
    if (len < need) return null;
    const u = dir(headings[i]);
    V.push({ x: V[i].x + u.x * len, y: V[i].y + u.y * len });
  }

  const pts: Built['points'] = [];
  const sign = { v: rng() < 0.5 ? 1 : -1 };
  let anchor = E;

  for (let i = 0; i < turns.length; i++) {
    const corner = V[i + 1];
    const u1 = dir(headings[i]);
    const u2 = dir(headings[i + 1]);
    const t = tangent[i];
    if (t === 0) {
      // Small turn: the corner itself is the waypoint
      for (const p of subdivide(anchor, corner, lim, rng, sign)) pts.push({ xy: p, kind: 'cp' });
      pts.push({ xy: corner, kind: 'turn' });
      anchor = corner;
      continue;
    }
    const tIn = { x: corner.x - u1.x * t, y: corner.y - u1.y * t };
    const tOut = { x: corner.x + u2.x * t, y: corner.y + u2.y * t };
    for (const p of subdivide(anchor, tIn, lim, rng, sign)) pts.push({ xy: p, kind: 'cp' });
    pts.push({ xy: tIn, kind: 'turn' });

    const n = Math.ceil(turns[i] / eff);
    const nrm = side > 0 ? { x: u1.y, y: -u1.x } : { x: -u1.y, y: u1.x }; // towards the inside of the turn
    const O = { x: tIn.x + nrm.x * R, y: tIn.y + nrm.y * R };
    const r0 = { x: tIn.x - O.x, y: tIn.y - O.y };
    for (let k = 1; k < n; k++) {
      const a = side * rad(turns[i]) * (k / n);
      pts.push({
        xy: { x: O.x + r0.x * Math.cos(a) + r0.y * Math.sin(a), y: O.y - r0.x * Math.sin(a) + r0.y * Math.cos(a) },
        kind: 'turn',
      });
    }
    pts.push({ xy: tOut, kind: 'turn' });
    anchor = tOut;
  }

  // Last leg: from the last anchor along the last heading, ending where it reaches the wanted distance from the field
  const uL = dir(headings[legs - 1]);
  const pu = anchor.x * uL.x + anchor.y * uL.y;
  const disc = pu * pu - (anchor.x * anchor.x + anchor.y * anchor.y) + ipDist * ipDist;
  if (disc < 0) return null;
  const lambda = -pu - Math.sqrt(disc);
  if (lambda < MIN_STRAIGHT_NM) return null;
  const ip = { x: anchor.x + uL.x * lambda, y: anchor.y + uL.y * lambda };
  for (const p of subdivide(anchor, ip, lim, rng, sign)) pts.push({ xy: p, kind: 'cp' });
  pts.push({ xy: ip, kind: 'ip' });
  return { points: pts };
}

/** Checks a finished route against the limits, on the real positions. Returns the track length, or null if it fails. */
function validate(spec: CorridorSpec, entry: LatLon, firstHdg: number, pts: LatLon[], lim: CorridorLimits): number | null {
  const all = [entry, ...pts];
  const n = all.length - 1;
  const brg: number[] = [];
  const cum: number[] = [0];
  for (let i = 1; i <= n; i++) {
    brg.push(calculateBearingDeg(all[i - 1].lat, all[i - 1].lon, all[i].lat, all[i].lon));
    cum.push(cum[i - 1] + calculateDistanceNm(all[i - 1].lat, all[i - 1].lon, all[i].lat, all[i].lon));
  }

  // Heading change at every waypoint
  if (Math.abs(angularDiffDeg(firstHdg, brg[0])) > lim.maxStepDeg) return null;
  for (let i = 0; i < n - 1; i++) if (Math.abs(angularDiffDeg(brg[i], brg[i + 1])) > lim.maxStepDeg) return null;

  // The IP and the heading home
  const ip = all[n];
  const ipDist = calculateDistanceNm(ip.lat, ip.lon, spec.home.lat, spec.home.lon);
  if (ipDist < lim.minFinalDistNm || ipDist > lim.maxFinalDistNm) return null;
  const toHome = calculateBearingDeg(ip.lat, ip.lon, spec.home.lat, spec.home.lon);
  if (Math.abs(angularDiffDeg(brg[n - 1], toHome)) > lim.maxFinalTurnDeg) return null;

  const xy = all.map((p) => toXY(spec.home, p));
  const H = { x: 0, y: 0 };

  // Clear of the home field after the first leg
  for (let i = 1; i < n; i++) if (ptSegDist(H, xy[i], xy[i + 1]) < lim.homeClearNm) return null;

  // Parts of the route far apart along the track stay apart (no crossing, no running alongside). The track flown
  // before the entry fix and the way home from the IP count too, up to 8 NM from the field where the pattern starts.
  const nearField = (p: XY): XY => {
    const d = Math.hypot(p.x, p.y) || 1;
    return { x: (p.x / d) * 8, y: (p.y / d) * 8 };
  };
  const ext = [nearField(xy[0]), ...xy, nearField(xy[n])];
  const extCum = [0];
  for (let i = 1; i < ext.length; i++) extCum.push(extCum[i - 1] + Math.hypot(ext[i].x - ext[i - 1].x, ext[i].y - ext[i - 1].y));
  for (let i = 0; i < ext.length - 1; i++) {
    for (let j = i + 2; j < ext.length - 1; j++) {
      if (extCum[j] - extCum[i + 1] < lim.pathGapNm) continue;
      if (segSegDist(ext[i], ext[i + 1], ext[j], ext[j + 1]) < lim.separationNm) return null;
    }
  }
  return cum[n];
}

/** Candidate limits, from strict (step 0) to very relaxed (step 4); the first step that gives a route wins. */
const RELAX_STEPS = 5;

function relaxed(l: CorridorLimits, step: number): CorridorLimits {
  if (step === 0) return l;
  const f = [1, 0.85, 0.7, 0.5, 0.3][step];
  return {
    ...l,
    cornerRadiusNm: step >= 3 ? l.cornerRadiusNm * (step === 3 ? 0.75 : 0.6) : l.cornerRadiusNm,
    homeClearNm: l.homeClearNm * f,
    separationNm: step === 4 ? l.separationNm * 0.1 : l.separationNm * (step === 1 ? 0.75 : step === 2 ? 0.5 : 0.3),
    pathGapNm: l.pathGapNm * (step === 4 ? 1.5 : step === 1 ? 0.9 : step === 2 ? 0.75 : 0.6),
    maxFinalTurnDeg: l.maxFinalTurnDeg + [0, 5, 10, 20, 30][step],
    maxFinalDistNm: l.maxFinalDistNm + (step === 4 ? 8 : 0),
  };
}

/**
 * Builds a random corridor between the entry fix and the IP. Throws 'ROUTE_SHAPE_FAILED' if nothing fits, which
 * the tests show does not happen for any entry position, heading, latitude or length in use.
 */
export function buildCorridor(spec: CorridorSpec, rng: Rng = Math.random): Corridor {
  const E = toXY(spec.home, spec.entry);
  const scales = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3];

  for (let step = 0; step < RELAX_STEPS; step++) {
    const lim = relaxed(spec.limits, step);
    const tol = [0.15, 0.25, 0.4, 0.5, 0.7][step];
    for (let attempt = 0; attempt < 90; attempt++) {
      const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
      const turns = shapeTurns(shape, rng);
      const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const firstHdg = (spec.entryHeadingDeg + between(rng, -20, 20) + 360) % 360;
      const weights = Array.from({ length: turns.length + 1 }, () => between(rng, 0.75, 1.25));
      const ipDist = between(rng, lim.minFinalDistNm + 2, lim.maxFinalDistNm - 4);

      for (const scale of scales) {
        const built = build({ ...spec, limits: lim }, E, turns, side, firstHdg, weights, scale, ipDist, rng);
        if (!built) continue;
        const latlons = built.points.map((p) => toLatLon(spec.home, p.xy));
        const length = validate(spec, spec.entry, firstHdg, latlons, lim);
        if (length === null) continue;
        if (Math.abs(length - spec.lengthNm) > spec.lengthNm * tol) continue;
        return {
          shape,
          lengthNm: length,
          points: built.points.map((p, i) => ({ pos: latlons[i], kind: p.kind })),
        };
      }
    }
  }
  throw new Error('ROUTE_SHAPE_FAILED');
}

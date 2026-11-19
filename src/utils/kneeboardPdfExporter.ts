import { jsPDF } from 'jspdf';
import type { GeneratedFlightPlan, FlightWaypoint, AirportWeather } from '../types/flightDesk';
import { formatRunway } from './geo';
import { DEFAULT_UNITS, altValue, convertText, distValue, formatPressure, speedValue, unitLabels, type Units } from './units';

type Rgb = [number, number, number];

export type KneeboardTheme = 'day' | 'night';

export interface KneeboardOptions {
  /** Colours of the theme. Ignored in print mode. */
  theme?: KneeboardTheme;
  /** Black on white, for printing. */
  print?: boolean;
  /** Display units; the plan itself stays in feet, knots and nautical miles. */
  units?: Units;
}

/** Units of the PDF being made (set at the start of generateKneeboardPdf). */
let U: Units = DEFAULT_UNITS;

/** The kneeboard uses the colours of the app: manila paper and black ink by day, dark green by night. */
interface Palette {
  page: Rgb;
  inset: Rgb;
  ink: Rgb;
  ink2: Rgb;
  ink3: Rgb;
  rule: Rgb;
  accent: Rgb;
  alert: Rgb;
  ok: Rgb;
  onInk: Rgb;
  hilite: Rgb;
  hazard: Rgb;
  /** Light bars of the hazard stripe (yellow on screen, white for printing). */
  stripe: Rgb;
}

const PALETTES: Record<KneeboardTheme, Palette> = {
  day: {
    page: [235, 228, 205],
    inset: [221, 212, 182],
    ink: [29, 31, 26],
    ink2: [74, 76, 63],
    ink3: [111, 111, 93],
    rule: [181, 172, 141],
    accent: [212, 64, 10],
    alert: [163, 32, 26],
    ok: [79, 106, 42],
    onInk: [235, 228, 205],
    hilite: [241, 201, 164],
    hazard: [29, 31, 26],
    stripe: [224, 168, 0],
  },
  night: {
    page: [22, 29, 18],
    inset: [35, 46, 30],
    ink: [214, 220, 185],
    ink2: [169, 178, 139],
    ink3: [125, 135, 101],
    rule: [56, 69, 47],
    accent: [255, 122, 61],
    alert: [255, 107, 90],
    ok: [168, 208, 106],
    onInk: [21, 28, 18],
    hilite: [70, 54, 26],
    hazard: [13, 18, 11],
    stripe: [224, 168, 0],
  },
};

/** Black on white: no filled pages, grey instead of colours, for printing. */
const PRINT_PALETTE: Palette = {
  page: [255, 255, 255],
  inset: [238, 238, 238],
  ink: [0, 0, 0],
  ink2: [55, 55, 55],
  ink3: [100, 100, 100],
  rule: [165, 165, 165],
  accent: [0, 0, 0],
  alert: [0, 0, 0],
  ok: [0, 0, 0],
  onInk: [255, 255, 255],
  hilite: [214, 214, 214],
  hazard: [0, 0, 0],
  stripe: [255, 255, 255],
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 8;
const CONTENT_W = PAGE_W - MARGIN * 2; // 194 mm
const FOOTER_Y = PAGE_H - 6;
const BOTTOM_LIMIT = PAGE_H - 12; // table rows stop above the footer
const ROW_H = 5.3;

/**
 * Keeps text printable with the built-in PDF fonts (WinAnsi): strips accents, maps a few symbols
 * and drops anything else, so a stray character can never show up as garbage in the PDF.
 */
function pdfSafe(text: string): string {
  const mapped = text
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[→›»]/g, '>')
    .replace(/[←‹«]/g, '<')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/ß/g, 'ss')
    .replace(/[\u2009\u202f\u00a0]/g, ' ');
  return mapped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e°•·—–‘’“”…±×]/g, '');
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Short type code for the navigation log. */
function deriveTypeLabel(wpType: string, name: string): string {
  const upper = name.toUpperCase();
  // Named checkpoints keep their own code, whatever the call-sign style name contains
  if (wpType === 'CHECKPOINT' && upper.startsWith('CP ')) return 'CP';
  if (upper.includes('TOUCHDOWN')) return 'TDZ';
  if (upper.includes('TOUCH & GO') || upper.includes('TOUCH AND GO') || wpType === 'TNG') return 'T&G';
  if (wpType === 'RANGE' || wpType === 'DROP') {
    if (upper.startsWith('TARGET')) return 'TGT';
    if (upper.startsWith('DZ ') && !upper.startsWith('DZ IP') && !upper.startsWith('DZ EXIT')) return 'DZ';
    if (upper.startsWith('CARP')) return 'CARP';
    if (upper.startsWith('ROLL-IN')) return 'ROLL';
    if (upper.startsWith('RUN-IN')) return 'RUN';
    if (upper.startsWith('PULL-OFF')) return 'PULL';
    if (upper.startsWith('DZ EXIT')) return 'DZX';
    if (upper.startsWith('RE-ENTRY')) return 'REENT';
    if (upper.startsWith('PERCH')) return 'PERCH';
    if (upper.startsWith('DOWNWIND')) return 'DWIND';
    if (upper.includes('TURN')) return 'TURN';
    if (upper.startsWith('BASE')) return 'BASE';
  }
  if (upper.startsWith('RANGE EXIT') || upper.startsWith('DZ DEPARTURE')) return 'EXIT';
  if (upper.startsWith('RTB')) return 'RTB';
  if (upper.startsWith('IAF')) return 'IAF';
  if (upper.includes('SHORT FINAL')) return 'SFINAL';
  if (upper.includes('FINAL')) return 'FINAL';
  if (upper.includes('INITIAL') || upper.includes('INIT')) return 'INIT';
  if (upper.includes('INTERCEPT')) return 'INTC';
  if (upper.includes('TRANSIT')) return 'TRANS';
  if (upper.includes('ARC')) return 'ARC';
  if (upper.includes('OVERHEAD')) return 'OVRHD';
  if (upper.includes('BREAK')) return 'BREAK';
  if (upper.includes('DOWNWIND')) return 'DWIND';
  if (upper.includes('PERCH')) return 'PERCH';
  if (upper.includes('PATTERN ENTRY')) return 'ENTRY';
  if (upper.includes('BASE')) return 'BASE';
  if (upper.includes('LIFTOFF')) return 'LOFF';
  if (upper.includes('CLIMB')) return 'CLB';
  if (upper.includes('EGRESS')) return 'EGRS';
  switch (wpType) {
    case 'DEP':
      return 'DEP';
    case 'ARR':
      return 'ARR';
    case 'IP':
      return 'IP';
    case 'RECOVERY':
      return 'RCV';
    case 'MTR_ENTRY':
      return 'ENTRY';
    case 'CHECKPOINT':
      return 'CP';
    case 'CLIMB':
      return 'CLB';
    case 'EGRESS':
      return 'EGRS';
    default:
      return wpType;
  }
}

/** Shortens long waypoint names so they fit the waypoint column. */
function shortenWaypointName(name: string): string {
  return name
    .replace(/HIGH-G HORIZONTAL REVERSAL/gi, 'HIGH-G HORIZ REV')
    .replace(/DYNAMIC VERTICAL SPLIT/gi, 'DYN VERT SPLIT')
    .replace(/LOWAT TACTICAL ENTRY/gi, 'LOWAT ENTRY')
    .replace(/LOWAT TACTICAL EGRESS/gi, 'LOWAT EGRESS')
    .replace(/INITIAL (RWY \w+) \(PITCH\)/gi, 'INITIAL $1')
    .replace(/360 BREAK \/ DOWNWIND PERCH/gi, '360 BREAK / PERCH')
    .replace(/FINAL APPROACH (RWY \w+)/gi, 'FINAL $1')
    .replace(/(RWY \w+) CLIMBOUT/gi, '$1 CLIMB')
    .replace(/EGRESS TRANSITION/gi, 'EGRESS TRANS');
}

/** Compact altitude text such as 2,150' MSL (1,800' AGL). */
function compactAlt(altDisplay: string, altFt: number): { full: string; short: string } {
  if (U.altitude === 'm') {
    const converted = altDisplay
      ? convertText(altDisplay, U).replace(/\s+/g, ' ').trim()
      : `${altValue(altFt, U).toLocaleString('en-US')} m MSL`;
    const mslM = converted.match(/([\d,]+ m MSL)/i);
    return { full: converted, short: mslM ? mslM[1] : converted };
  }
  if (!altDisplay) {
    const only = `${altFt.toLocaleString('en-US')}' MSL`;
    return { full: only, short: only };
  }
  const condensed = altDisplay
    .replace(/(\d{4,})/g, (n) => Number(n).toLocaleString('en-US'))
    .replace(/\s*ft\s*MSL/gi, "' MSL")
    .replace(/\s*ft\s*AGL/gi, "' AGL")
    .replace(/\s+/g, ' ')
    .trim();
  const msl = condensed.match(/([\d,]+'\s*MSL)/i);
  return { full: condensed, short: msl ? msl[1] : condensed };
}

/** Draws text that always stays inside maxWidth (truncated with an ellipsis as a last resort). */
function fitText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  align: 'left' | 'center' | 'right' = 'left'
): void {
  let str = pdfSafe(text);
  if (doc.getTextWidth(str) > maxWidth) {
    while (str.length > 3 && doc.getTextWidth(str + '…') > maxWidth) {
      str = str.slice(0, -1);
    }
    str += '…';
  }
  doc.text(str, x, y, { align });
}

function windText(w?: AirportWeather): string {
  if (!w) return 'NO DATA';
  if (w.isCalm || w.windSpeedKts === 0) return 'CALM';
  const gust = w.windGustKts ? `G${speedValue(w.windGustKts, U)}` : '';
  return `${String(Math.round(w.windDirDeg)).padStart(3, '0')}°/${speedValue(w.windSpeedKts, U)}${gust} ${unitLabels(U).spd.toUpperCase()}`;
}

function componentsText(w?: AirportWeather): string {
  if (!w || w.isCalm || w.windSpeedKts === 0) return '';
  const hw = w.headwindKts >= 0 ? `HW +${speedValue(w.headwindKts, U)}` : `TW ${speedValue(Math.abs(w.headwindKts), U)}`;
  return `${hw} · XW ${speedValue(Math.abs(w.crosswindKts), U)}${w.crosswindKts >= 0 ? 'R' : 'L'}`;
}

function runwayText(w?: AirportWeather): string {
  if (!w || !w.activeRunway) return 'N/A';
  return `${formatRunway(w.activeRunway)}${w.runwayEstimated ? ' (EST)' : ''}`;
}

function mhzText(freq?: string): string {
  if (!freq || !freq.trim()) return 'NOT AVAILABLE';
  return /mhz/i.test(freq) ? freq.trim() : `${freq.trim()} MHz`;
}

function recoveryText(plan: GeneratedFlightPlan): string {
  const hasIaf = plan.waypoints.some((w) => w.name.startsWith('IAF'));
  if (plan.aircraftType === 'Cargo') {
    return hasIaf ? 'STRAIGHT-IN, 200 KT' : 'VISUAL PATTERN, 200 KT';
  }
  return plan.recoveryType === 'instrument' ? 'STRAIGHT-IN, 260 KT' : 'OVERHEAD BREAK, 350 KT';
}

function cleanAltitude(text: string): string {
  return pdfSafe(
    text
      .replace(/\s*\(.*\)/, '')
      .replace(/\s*above the highest terrain on each leg/i, ' AGL')
      .replace(/TERRAIN FOLLOWING/gi, 'TF')
      .replace(/TACTICAL CONTOUR/gi, 'CONTOUR')
      .trim()
  );
}


function phaseColor(P: Palette, wp: FlightWaypoint, idx: number, last: number): Rgb | null {
  if (idx === 0 || idx === last) return P.ink;
  if (wp.type === 'IP') return P.accent;
  if (wp.type === 'TNG') return P.ok;
  if (wp.type === 'RANGE' || wp.type === 'DROP') return P.alert;
  if (wp.type === 'RECOVERY' || wp.type === 'ARR') return P.ink3;
  if (wp.type === 'MTR_ENTRY' || wp.type === 'EGRESS') return P.ink2;
  return null;
}

const TABLE_COLS = [
  { label: '#', w: 8, align: 'center' as const },
  { label: 'FIX', w: 46, align: 'left' as const },
  { label: 'TYPE', w: 14, align: 'center' as const },
  { label: 'HDG °M', w: 15, align: 'right' as const },
  { label: 'LEG NM', w: 15, align: 'right' as const },
  { label: 'TOTAL NM', w: 17, align: 'right' as const },
  { label: 'ALTITUDE', w: 33, align: 'left' as const },
  { label: 'SPEED', w: 24, align: 'right' as const },
  { label: 'ETE', w: 11, align: 'right' as const },
  { label: 'CUM', w: 11, align: 'right' as const },
];

function fill(doc: jsPDF, c: Rgb) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function stroke(doc: jsPDF, c: Rgb) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function color(doc: jsPDF, c: Rgb) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function drawPage(doc: jsPDF, P: Palette) {
  fill(doc, P.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
}

/** A black strip of label tape with paper-coloured capitals. Returns its width. */
function drawTape(doc: jsPDF, P: Palette, text: string, x: number, y: number, size = 7): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  const w = doc.getTextWidth(pdfSafe(text)) + 4;
  const h = size * 0.5 + 1.6;
  fill(doc, P.ink);
  doc.roundedRect(x, y, w, h, 0.4, 0.4, 'F');
  color(doc, P.onInk);
  doc.text(pdfSafe(text), x + 2, y + h - 1.4);
  return w;
}

/** Black and yellow hazard stripe. */
function drawHazard(doc: jsPDF, P: Palette, x: number, y: number, w: number, h: number) {
  fill(doc, P.stripe);
  doc.rect(x, y, w, h, 'F');
  stroke(doc, P.hazard);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, 'S');
  fill(doc, P.hazard);
  const period = 6;
  for (let px = x; px + h + 3 <= x + w; px += period) {
    doc.triangle(px, y + h, px + h, y, px + h + 3, y, 'F');
    doc.triangle(px, y + h, px + h + 3, y, px + 3, y + h, 'F');
  }
}

/** One boxed block of label / value rows. */
function drawBox(
  doc: jsPDF,
  P: Palette,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  rows: Array<[string, string]>
) {
  stroke(doc, P.rule);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.3);
  color(doc, P.ink3);
  fitText(doc, title, x + 2.5, y + 4.2, w - 5);
  rows.forEach(([label, value], i) => {
    const ry = y + 8.9 + i * 3.7;
    if (i > 0) {
      stroke(doc, P.rule);
      doc.setLineWidth(0.1);
      doc.line(x + 2.5, ry - 2.7, x + w - 2.5, ry - 2.7);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    color(doc, P.ink3);
    fitText(doc, label, x + 2.5, ry, 19);
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.4);
    color(doc, P.ink);
    fitText(doc, value, x + 22.5, ry, w - 25);
  });
}

/** Column list with the headings in the units of this PDF. */
function tableCols() {
  const dist = unitLabels(U).dist.toUpperCase();
  return TABLE_COLS.map((c) =>
    c.label === 'LEG NM'
      ? { ...c, label: `LEG ${dist}` }
      : c.label === 'TOTAL NM'
        ? { ...c, label: `TOTAL ${dist}` }
        : c.label === 'SPEED' && U.speed === 'kmh'
          ? { ...c, label: 'SPEED KM/H' }
          : c
  );
}

function drawTableHeader(doc: jsPDF, P: Palette, y: number): number {
  fill(doc, P.ink);
  doc.rect(MARGIN, y, CONTENT_W, 5.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  color(doc, P.onInk);
  let x = MARGIN;
  for (const col of tableCols()) {
    const tx = col.align === 'right' ? x + col.w - 1.5 : col.align === 'center' ? x + col.w / 2 : x + 2.5;
    fitText(doc, col.label, tx, y + 3.9, col.w - 2, col.align);
    x += col.w;
  }
  return y + 5.6;
}

/** North-up sketch of the route: grid, route line, airfields, IP, target, training ground, scale. */
function drawRouteChart(doc: jsPDF, P: Palette, plan: GeneratedFlightPlan, x: number, y: number, w: number, h: number) {
  fill(doc, P.inset);
  stroke(doc, P.rule);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'FD');

  const ix = x + 4;
  const iy = y + 9;
  const iw = w - 8;
  const ih = h - 13;
  const wps = plan.waypoints;
  if (wps.length < 2) return;

  // Bounds in nautical miles, including the training ground circle
  const lat0 = wps.reduce((s, p) => s + p.lat, 0) / wps.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 60;
  const ky = 60;
  const g = plan.trainingGround;
  const pts = wps.map((p) => ({ X: p.lon * kx, Y: -p.lat * ky }));
  let minX = Math.min(...pts.map((p) => p.X));
  let maxX = Math.max(...pts.map((p) => p.X));
  let minY = Math.min(...pts.map((p) => p.Y));
  let maxY = Math.max(...pts.map((p) => p.Y));
  if (g) {
    minX = Math.min(minX, g.lon * kx - g.radiusNm);
    maxX = Math.max(maxX, g.lon * kx + g.radiusNm);
    minY = Math.min(minY, -g.lat * ky - g.radiusNm);
    maxY = Math.max(maxY, -g.lat * ky + g.radiusNm);
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const s = Math.min(iw / spanX, ih / spanY); // mm per NM
  const offX = ix + (iw - spanX * s) / 2;
  const offY = iy + (ih - spanY * s) / 2;
  const mx = (X: number) => offX + (X - minX) * s;
  const my = (Y: number) => offY + (Y - minY) * s;

  // Grid
  const steps = [5, 10, 20, 25, 50, 100, 200];
  const step = steps.find((v) => spanX / v <= 6 && spanY / v <= 6) ?? 200;
  stroke(doc, P.rule);
  doc.setLineWidth(0.1);
  for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) doc.line(mx(gx), iy, mx(gx), iy + ih);
  for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step) doc.line(ix, my(gy), ix + iw, my(gy));

  // Training ground
  if (g) {
    stroke(doc, P.alert);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.2, 0.9], 0);
    doc.circle(mx(g.lon * kx), my(-g.lat * ky), g.radiusNm * s, 'S');
    doc.setLineDashPattern([], 0);
  }

  // Route
  stroke(doc, P.accent);
  doc.setLineWidth(0.55);
  const vectors: Array<[number, number]> = [];
  for (let i = 1; i < pts.length; i++) vectors.push([mx(pts[i].X) - mx(pts[i - 1].X), my(pts[i].Y) - my(pts[i - 1].Y)]);
  doc.lines(vectors, mx(pts[0].X), my(pts[0].Y), [1, 1], 'S', false);

  // Symbols
  let ipLabelled = false;
  let targetLabelled = false;
  wps.forEach((wp, idx) => {
    const px = mx(pts[idx].X);
    const py = my(pts[idx].Y);
    const isIp = wp.type === 'IP';
    const isTarget = /^(TARGET|DZ \d)/.test(wp.name);
    const isTouch = wp.type === 'TNG' && wp.name.includes('TOUCH & GO');
    if (idx === 0) {
      stroke(doc, P.ink);
      fill(doc, P.page);
      doc.setLineWidth(0.4);
      doc.circle(px, py, 1.6, 'FD');
      doc.line(px - 2.6, py, px + 2.6, py);
      doc.line(px, py - 2.6, px, py + 2.6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      color(doc, P.ink);
      doc.text(pdfSafe(plan.operatingAirbase.ident), px + 2.6, py - 1.8);
    } else if (isTarget && !targetLabelled) {
      targetLabelled = true;
      stroke(doc, P.alert);
      fill(doc, P.page);
      doc.setLineWidth(0.4);
      doc.circle(px, py, 1.7, 'FD');
      fill(doc, P.alert);
      doc.circle(px, py, 0.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      color(doc, P.alert);
      doc.text(plan.missionProfile === 'cargo_drop' ? 'DZ' : 'TGT', px + 2.4, py - 1.6);
    } else if (isIp && !ipLabelled) {
      ipLabelled = true;
      stroke(doc, P.ink);
      fill(doc, P.page);
      doc.setLineWidth(0.4);
      doc.triangle(px, py - 1.8, px + 1.6, py + 1.2, px - 1.6, py + 1.2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      color(doc, P.ink);
      doc.text('IP', px + 2.2, py + 0.8);
    } else if (isTouch) {
      stroke(doc, P.ink);
      fill(doc, P.ok);
      doc.setLineWidth(0.3);
      doc.rect(px - 1.3, py - 1.3, 2.6, 2.6, 'FD');
      if (plan.tngAirbase) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        color(doc, P.ink);
        doc.text(pdfSafe(plan.tngAirbase.ident), px + 2.4, py - 1.6);
      }
    } else if (wp.type === 'CHECKPOINT' && idx !== wps.length - 1) {
      stroke(doc, P.accent);
      fill(doc, P.page);
      doc.setLineWidth(0.3);
      doc.circle(px, py, 0.8, 'FD');
    }
  });

  // North arrow and scale bar
  const nx = x + w - 6;
  const ny = y + 5.5;
  fill(doc, P.ink);
  stroke(doc, P.ink);
  doc.triangle(nx, ny - 3, nx + 1.2, ny + 1, nx - 1.2, ny + 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  color(doc, P.ink);
  doc.text('N', nx - 0.9, ny + 4);
  const km = U.distance === 'km';
  const perUnit = km ? s / 1.852 : s; // mm per displayed unit
  const barVal = [5, 10, 20, 25, 50, 100, 200].find((v) => v * perUnit >= 14) ?? 200;
  const barMm = barVal * perUnit;
  const bx = x + 4;
  const by = y + h - 3;
  doc.setLineWidth(0.4);
  doc.line(bx, by, bx + barMm, by);
  doc.line(bx, by - 1, bx, by + 1);
  doc.line(bx + barMm, by - 1, bx + barMm, by + 1);
  doc.setFont('courier', 'bold');
  doc.setFontSize(6);
  doc.text(`${barVal} ${km ? 'km' : 'NM'}`, bx + barMm + 2, by + 0.9);
}

/** Rubber stamp, slightly turned, in the free middle of the footer. */
function drawStamp(doc: jsPDF, P: Palette, cx: number, cy: number) {
  const deg = 3;
  const rad = (deg * Math.PI) / 180;
  const hw = 15.5;
  const hh = 4.4;
  const rot = (dx: number, dy: number): [number, number] => [
    cx + dx * Math.cos(rad) + dy * Math.sin(rad),
    cy - dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
  const [x0, y0] = rot(-hw, -hh);
  const corners = [rot(hw, -hh), rot(hw, hh), rot(-hw, hh), [x0, y0]];
  stroke(doc, P.alert);
  doc.setLineWidth(0.5);
  let px = x0;
  let py = y0;
  const vectors: Array<[number, number]> = [];
  for (const c of corners) {
    vectors.push([c[0] - px, c[1] - py]);
    px = c[0];
    py = c[1];
  }
  doc.lines(vectors, x0, y0, [1, 1], 'S', true);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  color(doc, P.alert);
  for (const [text, dy] of [['SIMULATION', -1.6], ['USE ONLY', 2.2]] as const) {
    const tw = doc.getTextWidth(text);
    const [tx, ty] = rot(-tw / 2, dy);
    doc.text(text, tx, ty, { angle: deg });
  }
}

/**
 * Generates the sortie kneeboard PDF (A4, portrait) in the style of the app: a header with a hazard
 * stripe, key figures, a route chart beside the comms and airfield boxes, a navigation log with
 * repeated column headers, and a footer with page numbers. `theme` picks the colours.
 */
export function generateKneeboardPdf(plan: GeneratedFlightPlan, options: KneeboardOptions | KneeboardTheme = {}): jsPDF {
  const opts: KneeboardOptions = typeof options === 'string' ? { theme: options } : options;
  U = opts.units ?? DEFAULT_UNITS;
  const L = unitLabels(U);
  const agl = (ft: number) => `${altValue(ft, U).toLocaleString('en-US')} ${L.alt.toUpperCase()} AGL`;
  const P = opts.print ? PRINT_PALETTE : PALETTES[opts.theme ?? 'day'];
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const home = plan.operatingAirbase;
  const depW = plan.departureWeather;
  const isTng = plan.missionProfile === 'lltr_tng' && Boolean(plan.tngAirbase);
  const aircraft = plan.aircraftType === 'Cargo' ? 'CARGO' : 'FIGHTER JET';
  drawPage(doc, P);
  let y = MARGIN;

  // --- 1. Header --------------------------------------------------------------------------
  stroke(doc, P.ink);
  doc.setLineWidth(0.5);
  doc.circle(MARGIN + 4.2, y + 5.8, 3.2, 'S');
  doc.line(MARGIN + 4.2, y + 1.4, MARGIN + 4.2, y + 10.2);
  doc.line(MARGIN, y + 5.8, MARGIN + 8.4, y + 5.8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  color(doc, P.ink);
  doc.text('TACTICAL SORTIE KNEEBOARD', MARGIN + 11.5, y + 6);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.6);
  color(doc, P.ink2);
  fitText(doc, `${plan.callsign}  ·  ${plan.sortieId}  ·  ${aircraft}  ·  VFR`, MARGIN + 11.5, y + 10.6, 120);

  const profileLabel =
    plan.missionProfile === 'lltr_tng'
      ? 'LLTR + TOUCH & GO'
      : plan.missionProfile === 'range_strafe'
        ? 'RANGE STRAFING'
        : plan.missionProfile === 'cargo_drop'
          ? 'CARGO DROP'
          : plan.missionProfile === 'low_level_mtr'
            ? 'LLTR LOW-LEVEL'
            : 'TACTICAL SORTIE';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const tapeW = doc.getTextWidth(profileLabel) + 4;
  drawTape(doc, P, profileLabel, PAGE_W - MARGIN - tapeW, y + 0.8, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  color(doc, P.ink2);
  fitText(doc, home.name, PAGE_W - MARGIN, y + 10.2, 90, 'right');
  drawHazard(doc, P, MARGIN, y + 13.2, CONTENT_W, 2.4);
  y += 18.5;

  // --- 2. Key figures ---------------------------------------------------------------------
  const kpiH = 11;
  stroke(doc, P.rule);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, kpiH, 'S');
  const kpis = [
    { label: 'HOME BASE', val: `${home.ident}  ·  ${altValue(home.elevationFt, U).toLocaleString('en-US')} ${L.alt.toUpperCase()}` },
    { label: 'DISTANCE', val: `${Math.round(distValue(plan.totalDistanceNm, U))} ${L.dist}` },
    { label: 'FLIGHT TIME', val: `${plan.totalFlightTimeMin} MIN` },
    {
      label: 'ALTITUDE',
      val: plan.trainingGround
        ? plan.missionProfile === 'cargo_drop'
          ? `DROP ${agl(800)}`
          : `PATTERN ${agl(1500)}`
        : convertText(cleanAltitude(plan.assignedAltitude), U),
    },
  ];
  const colW = CONTENT_W / 4;
  kpis.forEach((k, i) => {
    const kx = MARGIN + i * colW + 3;
    if (i > 0) {
      stroke(doc, P.rule);
      doc.line(MARGIN + i * colW, y, MARGIN + i * colW, y + kpiH);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    color(doc, P.ink3);
    fitText(doc, k.label, kx, y + 4, colW - 6);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    color(doc, P.ink);
    fitText(doc, k.val, kx, y + 8.8, colW - 6);
  });
  y += kpiH + 3;

  // --- 3. Route chart and the boxes beside it ------------------------------------------------
  const mainH = 66;
  const chartW = 108;
  drawRouteChart(doc, P, plan, MARGIN, y, chartW, mainH);
  drawTape(doc, P, 'ROUTE', MARGIN + 1.8, y + 1.8, 6.5);

  const bx = MARGIN + chartW + 3;
  const bw = CONTENT_W - chartW - 3;
  const bh = 21;
  const bgap = 1.5;
  drawBox(doc, P, bx, y, bw, bh, 'COMMS & TRANSPONDER', [
    ['TWR / OPS', mhzText(home.towerMhz)],
    ['TAC FREQ', plan.tacFrequencyMhz || '—'],
    ['SQUAWK', plan.squawk],
    ['MAG VAR', home.magDecl || '—'],
  ]);
  const windLine = [windText(depW), componentsText(depW)].filter(Boolean).join('  ');
  drawBox(doc, P, bx, y + bh + bgap, bw, bh, `HOME RECOVERY  ·  ${home.ident}`, [
    ['RUNWAY', runwayText(depW)],
    ['WIND', windLine],
    ['QNH', depW ? formatPressure(depW.altimeterInHg, depW.altimeterHpa, U) : formatPressure(29.92, 1013, U)],
    ['RECOVERY', convertText(recoveryText(plan), U)],
  ]);
  const by3 = y + 2 * (bh + bgap);
  if (isTng && plan.tngAirbase) {
    const t = plan.tngAirbase;
    const tw = plan.tngWeather;
    drawBox(doc, P, bx, by3, bw, bh, `TOUCH & GO  ·  ${t.ident}`, [
      ['RUNWAY', runwayText(tw)],
      ['WIND', [windText(tw), componentsText(tw)].filter(Boolean).join('  ')],
      ['ELEVATION', `${altValue(t.elevationFt, U).toLocaleString('en-US')} ${L.alt.toUpperCase()}`],
      ['TWR / OPS', mhzText(t.towerMhz)],
    ]);
  } else if (plan.trainingGround) {
    const tg = plan.trainingGround;
    const drop = plan.missionProfile === 'cargo_drop';
    const n = plan.passes ?? 1;
    drawBox(doc, P, bx, by3, bw, bh, drop ? 'DROP ZONE' : 'RANGE', [
      ['TARGET', tg.name.replace('Test and Training Range', 'TTR')],
      [drop ? 'DROP HDG' : 'RUN-IN HDG', `${String(plan.runInHeadingMagDeg ?? 0).padStart(3, '0')}°M`],
      ['PASSES', drop ? `${n}${n > 1 ? ' (1 DRY)' : ''}` : `${n} (1 DRY, ${n - 1} LIVE)`],
      ['PATTERN', `${(plan.patternSide ?? 'left').toUpperCase()}, ${drop ? `DROP ${agl(800)}` : agl(1500)}`],
    ]);
  } else {
    drawBox(doc, P, bx, by3, bw, bh, 'SORTIE', [
      ['SECTOR', convertText(plan.sectorDescription, U)],
      ['CRUISE', `${speedValue(plan.cruiseSpeedKts, U)} ${L.spd.toUpperCase()}`],
      ['TERRAIN', plan.terrainSource === 'DEM' ? 'ELEVATION DATA' : 'ESTIMATED'],
      ['RULES', plan.flightRules],
    ]);
  }
  y += mainH + 4;

  // --- 4. Navigation log ------------------------------------------------------------------
  drawTape(doc, P, 'NAVIGATION LOG', MARGIN, y, 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  color(doc, P.ink3);
  fitText(doc, `${plan.waypoints.length} waypoints`, PAGE_W - MARGIN, y + 4, 60, 'right');
  y += 6.4;
  y = drawTableHeader(doc, P, y);

  const lastIdx = plan.waypoints.length - 1;
  plan.waypoints.forEach((wp, idx) => {
    if (y + ROW_H > BOTTOM_LIMIT) {
      doc.addPage();
      drawPage(doc, P);
      y = MARGIN;
      drawTape(doc, P, 'NAVIGATION LOG (CONTINUED)', MARGIN, y, 7);
      doc.setFont('courier', 'bold');
      doc.setFontSize(7);
      color(doc, P.ink2);
      fitText(doc, `${plan.callsign}  ·  ${plan.sortieId}`, PAGE_W - MARGIN, y + 4, 100, 'right');
      y += 6.4;
      y = drawTableHeader(doc, P, y);
    }

    const label = deriveTypeLabel(wp.type, wp.name);
    const key = idx === 0 || idx === lastIdx || label === 'IP' || label === 'TGT' || label === 'DZ' || label === 'T&G';
    if (label === 'IP' || label === 'TGT' || label === 'DZ') {
      fill(doc, P.hilite);
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F');
    } else if (idx % 2 === 0) {
      fill(doc, P.inset);
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F');
    }
    const accent = phaseColor(P, wp, idx, lastIdx);
    if (accent) {
      fill(doc, accent);
      doc.rect(MARGIN, y, 1.1, ROW_H, 'F');
    }
    stroke(doc, P.rule);
    doc.setLineWidth(0.12);
    doc.line(MARGIN, y + ROW_H, MARGIN + CONTENT_W, y + ROW_H);

    // vertical hairlines between the columns, like a ruled log
    let vx = MARGIN;
    for (let c = 0; c < TABLE_COLS.length - 1; c++) {
      vx += TABLE_COLS[c].w;
      doc.line(vx, y, vx, y + ROW_H);
    }

    const ty = y + 3.7;
    color(doc, P.ink);
    let x = MARGIN;
    const c = TABLE_COLS;

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.6);
    fitText(doc, String(idx + 1), x + c[0].w / 2 + 0.5, ty, c[0].w - 1.5, 'center');
    x += c[0].w;

    doc.setFont('courier', key ? 'bold' : 'normal');
    doc.setFontSize(7);
    fitText(doc, shortenWaypointName(wp.name), x + 2.5, ty, c[1].w - 4.5);
    x += c[1].w;

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.6);
    if (label === 'TGT' || label === 'DZ' || label === 'CARP') color(doc, P.alert);
    else if (label === 'IP') color(doc, P.accent);
    else color(doc, P.ink2);
    fitText(doc, label, x + c[2].w / 2, ty, c[2].w - 1, 'center');
    color(doc, P.ink);
    x += c[2].w;

    const right = (col: number, text: string) => fitText(doc, text, x + c[col].w - 1.5, ty, c[col].w - 2.5, 'right');
    right(3, idx === 0 ? '—' : `${String(Math.round(wp.bearingMagDeg) % 360).padStart(3, '0')}°`);
    x += c[3].w;
    right(4, idx === 0 ? '—' : distValue(wp.legDistNm, U).toFixed(1));
    x += c[4].w;
    right(5, distValue(wp.cumulativeDistNm, U).toFixed(1));
    x += c[5].w;

    const alt = compactAlt(wp.altDisplay, wp.altFt);
    const altW = c[6].w - 3.5;
    fitText(doc, doc.getTextWidth(pdfSafe(alt.full)) <= altW ? alt.full : alt.short, x + 2.5, ty, altW);
    x += c[6].w;

    // in km/h the unit is in the column heading, so the figure and the Mach number still fit
    right(7, U.speed === 'kmh' ? `${speedValue(wp.speedKts, U)} · M${wp.mach}` : `${wp.speedKts} kt · M${wp.mach}`);
    x += c[7].w;
    right(8, idx === 0 ? '—' : formatDuration(wp.legEteSeconds));
    x += c[8].w;
    doc.setFont('courier', 'bold');
    right(9, formatDuration(wp.cumulativeTimeSeconds));

    y += ROW_H;
  });

  // --- 5. Footer on every page ------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(doc, P.rule);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, FOOTER_Y - 3.8, PAGE_W - MARGIN, FOOTER_Y - 3.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    color(doc, P.ink3);
    fitText(doc, `MSFS Military Flight Desk  ·  ${plan.callsign}  ·  ${plan.sortieId}`, MARGIN, FOOTER_Y, 78);
    fitText(
      doc,
      `${plan.generatedAt ? `Generated ${plan.generatedAt}  ·  ` : ''}Page ${p} of ${pages}`,
      PAGE_W - MARGIN,
      FOOTER_Y,
      60,
      'right'
    );
    drawStamp(doc, P, 105, FOOTER_Y - 1.2);
  }

  return doc;
}

/**
 * Triggers browser download for the Kneeboard PDF file.
 */
export function downloadKneeboardPdf(plan: GeneratedFlightPlan, options: KneeboardOptions | KneeboardTheme = {}): void {
  const doc = generateKneeboardPdf(plan, options);
  const depIcao = plan.operatingAirbase.ident;
  const profile =
    plan.missionProfile === 'lltr_tng'
      ? 'LLTR_TNG'
      : plan.missionProfile === 'range_strafe'
        ? 'RANGE'
        : plan.missionProfile === 'cargo_drop'
          ? 'DROP'
          : plan.missionProfile === 'low_level_mtr'
            ? 'LLTR'
            : 'TACTICAL';
  const callsignClean = plan.callsign.replace(/\s+/g, '_');
  doc.save(`KNEEBOARD_${depIcao}_${profile}_${callsignClean}.pdf`);
}

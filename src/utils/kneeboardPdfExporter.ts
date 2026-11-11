import { jsPDF } from 'jspdf';
import type { GeneratedFlightPlan, FlightWaypoint, AirportWeather } from '../types/flightDesk';
import { formatRunway } from './geo';

type Rgb = [number, number, number];

const NAVY: Rgb = [15, 23, 42];
const BLUE: Rgb = [37, 99, 235];
const SKY: Rgb = [56, 189, 248];
const GRAY_LIGHT: Rgb = [241, 245, 249];
const GRAY_BORDER: Rgb = [203, 213, 225];
const TEXT_DARK: Rgb = [30, 41, 59];
const TEXT_MUTED: Rgb = [100, 116, 139];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const CONTENT_W = PAGE_W - MARGIN * 2; // 190 mm
const FOOTER_Y = PAGE_H - 6;
const BOTTOM_LIMIT = PAGE_H - 12; // table rows stop above the footer

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
  const gust = w.windGustKts ? `G${w.windGustKts}` : '';
  return `${String(Math.round(w.windDirDeg)).padStart(3, '0')}°/${w.windSpeedKts}${gust} KT`;
}

function componentsText(w?: AirportWeather): string {
  if (!w || w.isCalm || w.windSpeedKts === 0) return '';
  const hw = w.headwindKts >= 0 ? `HW +${w.headwindKts}` : `TW ${Math.abs(w.headwindKts)}`;
  return `${hw} · XW ${Math.abs(w.crosswindKts)}${w.crosswindKts >= 0 ? 'R' : 'L'}`;
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

function phaseColor(wp: FlightWaypoint, idx: number, last: number): Rgb | null {
  if (idx === 0 || idx === last) return BLUE;
  if (wp.type === 'IP') return [217, 119, 6];
  if (wp.type === 'TNG') return [22, 163, 74];
  if (wp.type === 'RANGE' || wp.type === 'DROP') return [220, 38, 38];
  if (wp.type === 'RECOVERY' || wp.type === 'ARR') return [100, 116, 139];
  if (wp.type === 'MTR_ENTRY' || wp.type === 'EGRESS') return [14, 165, 233];
  return null;
}

const TABLE_COLS = [
  { label: '#', w: 7, align: 'center' as const },
  { label: 'WAYPOINT / FIX', w: 44, align: 'left' as const },
  { label: 'TYPE', w: 13, align: 'center' as const },
  { label: 'HDG °M', w: 14, align: 'right' as const },
  { label: 'LEG NM', w: 14, align: 'right' as const },
  { label: 'TOTAL NM', w: 16, align: 'right' as const },
  { label: 'ALTITUDE', w: 33, align: 'left' as const },
  { label: 'SPEED', w: 24, align: 'right' as const },
  { label: 'ETE', w: 12.5, align: 'right' as const },
  { label: 'CUM', w: 12.5, align: 'right' as const },
];

function drawTableHeader(doc: jsPDF, y: number): number {
  const h = 6;
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y, CONTENT_W, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);
  let x = MARGIN;
  for (const col of TABLE_COLS) {
    const tx = col.align === 'right' ? x + col.w - 1.5 : col.align === 'center' ? x + col.w / 2 : x + 2.5;
    fitText(doc, col.label, tx, y + 4.1, col.w - 2, col.align);
    x += col.w;
  }
  return y + h;
}

/** One titled box with label / value rows. */
function drawPanel(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  rows: Array<[string, string]>
): void {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...GRAY_BORDER);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, 'FD');
  doc.setFillColor(...GRAY_LIGHT);
  doc.rect(x, y, w, 5.2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(...BLUE);
  fitText(doc, title, x + 2.5, y + 3.6, w - 5);

  const labelW = 15;
  rows.forEach(([label, value], i) => {
    const ry = y + 9.2 + i * 4.3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...TEXT_MUTED);
    fitText(doc, label, x + 2.5, ry, labelW - 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(...TEXT_DARK);
    fitText(doc, value, x + 2.5 + labelW, ry, w - labelW - 5);
  });
}

/**
 * Generates the sortie kneeboard PDF (A4, portrait): header, key figures, comms and airfield
 * panels, a paginated navigation log with repeated column headers, and a page footer.
 */
export function generateKneeboardPdf(plan: GeneratedFlightPlan): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const home = plan.operatingAirbase;
  const depW = plan.departureWeather;
  const isTng = plan.missionProfile === 'lltr_tng' && Boolean(plan.tngAirbase);
  const aircraft = plan.aircraftType === 'Cargo' ? 'CARGO' : 'FIGHTER JET';
  let y = MARGIN;

  // --- 1. Header banner ---------------------------------------------------------------------
  const headerH = 15;
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y, CONTENT_W, headerH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  fitText(doc, 'TACTICAL SORTIE KNEEBOARD', MARGIN + 3, y + 6, 100);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  fitText(doc, `${plan.callsign}  ·  ${plan.sortieId}  ·  ${aircraft}  ·  VFR`, MARGIN + 3, y + 11.4, 120);

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
  doc.setFontSize(9);
  doc.setTextColor(...SKY);
  fitText(doc, profileLabel, PAGE_W - MARGIN - 3, y + 6, 62, 'right');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(203, 213, 225);
  fitText(doc, home.name, PAGE_W - MARGIN - 3, y + 11.4, 62, 'right');
  y += headerH + 2.5;

  // --- 2. Key figures ----------------------------------------------------------------------
  const kpiH = 12;
  doc.setFillColor(...GRAY_LIGHT);
  doc.setDrawColor(...GRAY_BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CONTENT_W, kpiH, 'FD');
  const kpis = [
    { label: 'HOME BASE', val: `${home.ident}  ·  ${home.elevationFt.toLocaleString('en-US')} FT` },
    { label: 'ROUTE DISTANCE', val: `${plan.totalDistanceNm} NM` },
    { label: 'SORTIE FLIGHT TIME', val: `${plan.totalFlightTimeMin} MIN` },
    {
      label: 'ASSIGNED ALTITUDE',
      val: plan.trainingGround
        ? plan.missionProfile === 'cargo_drop'
          ? "DROP 800' AGL"
          : "PATTERN 1,500' AGL"
        : cleanAltitude(plan.assignedAltitude),
    },
  ];
  const colW = CONTENT_W / 4;
  kpis.forEach((k, i) => {
    const x = MARGIN + i * colW + 3;
    if (i > 0) {
      doc.setDrawColor(...GRAY_BORDER);
      doc.line(MARGIN + i * colW, y + 2, MARGIN + i * colW, y + kpiH - 2);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(...TEXT_MUTED);
    fitText(doc, k.label, x, y + 4.2, colW - 6);
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_DARK);
    fitText(doc, k.val, x, y + 9.3, colW - 6);
  });
  y += kpiH + 2.5;

  // --- 3. Comms, home recovery, and T&G / sortie panels ------------------------------------
  const panelH = 24;
  const gap = 2;
  const panelW = (CONTENT_W - gap * 2) / 3;
  const px = (i: number) => MARGIN + i * (panelW + gap);

  drawPanel(doc, px(0), y, panelW, panelH, 'COMMS & TRANSPONDER', [
    ['TWR / OPS', mhzText(home.towerMhz)],
    ['TAC FREQ', plan.tacFrequencyMhz || '—'],
    ['SQUAWK', plan.squawk],
    ['MAG VAR', home.magDecl || '—'],
  ]);

  const windLine = [windText(depW), componentsText(depW)].filter(Boolean).join('  ');
  drawPanel(doc, px(1), y, panelW, panelH, `HOME RECOVERY  ·  ${home.ident}`, [
    ['RUNWAY', runwayText(depW)],
    ['WIND', windLine],
    ['QNH', depW ? `${depW.altimeterInHg.toFixed(2)} inHg / ${Math.round(depW.altimeterHpa)} hPa` : '29.92 inHg'],
    ['RECOVERY', recoveryText(plan)],
  ]);

  if (isTng && plan.tngAirbase) {
    const t = plan.tngAirbase;
    const tw = plan.tngWeather;
    const windT = [windText(tw), componentsText(tw)].filter(Boolean).join('  ');
    drawPanel(doc, px(2), y, panelW, panelH, `TOUCH & GO  ·  ${t.ident}`, [
      ['RUNWAY', runwayText(tw)],
      ['WIND', windT],
      ['ELEVATION', `${t.elevationFt.toLocaleString('en-US')} FT`],
      ['TWR / OPS', mhzText(t.towerMhz)],
    ]);
  } else if (plan.trainingGround) {
    const g = plan.trainingGround;
    const drop = plan.missionProfile === 'cargo_drop';
    const n = plan.passes ?? 1;
    const passText = drop
      ? `${n}${n > 1 ? ' (1 DRY)' : ''}`
      : `${n} (1 DRY, ${n - 1} LIVE)`;
    drawPanel(doc, px(2), y, panelW, panelH, drop ? 'DROP ZONE' : 'RANGE', [
      ['TARGET', g.name.replace('Test and Training Range', 'TTR')],
      [drop ? 'DROP HDG' : 'RUN-IN HDG', `${String(plan.runInHeadingMagDeg ?? 0).padStart(3, '0')}°M`],
      ['PASSES', passText],
      ['PATTERN', `${(plan.patternSide ?? 'left').toUpperCase()}, ${drop ? "DROP 800' AGL" : "1,500' AGL"}`],
    ]);
  } else {
    drawPanel(doc, px(2), y, panelW, panelH, 'SORTIE', [
      ['SECTOR', plan.sectorDescription],
      ['CRUISE', `${plan.cruiseSpeedKts} KT`],
      ['TERRAIN', plan.terrainSource === 'DEM' ? 'ELEVATION DATA' : 'ESTIMATED'],
      ['RULES', plan.flightRules],
    ]);
  }
  y += panelH + 3.5;

  // --- 4. Navigation log ------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  fitText(doc, 'NAVIGATION LOG', MARGIN, y + 2.5, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...TEXT_MUTED);
  fitText(doc, `${plan.waypoints.length} waypoints`, PAGE_W - MARGIN, y + 2.5, 60, 'right');
  y += 4.2;
  y = drawTableHeader(doc, y);

  const rowH = 5.7;
  const lastIdx = plan.waypoints.length - 1;
  plan.waypoints.forEach((wp, idx) => {
    if (y + rowH > BOTTOM_LIMIT) {
      doc.addPage();
      y = MARGIN;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...NAVY);
      fitText(doc, `NAVIGATION LOG (CONTINUED)  ·  ${plan.callsign}  ·  ${plan.sortieId}`, MARGIN, y + 3, CONTENT_W);
      y += 5;
      y = drawTableHeader(doc, y);
    }

    const accent = phaseColor(wp, idx, lastIdx);
    if (idx === 0 || idx === lastIdx) {
      doc.setFillColor(239, 246, 255);
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
    } else if (wp.type === 'IP' && deriveTypeLabel(wp.type, wp.name) === 'IP') {
      doc.setFillColor(254, 243, 199);
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
    } else if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
    }
    if (accent) {
      doc.setFillColor(...accent);
      doc.rect(MARGIN, y, 1.1, rowH, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);

    const ty = y + 3.9;
    doc.setTextColor(...TEXT_DARK);
    let x = MARGIN;
    const c = TABLE_COLS;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    fitText(doc, String(idx + 1), x + c[0].w / 2 + 0.5, ty, c[0].w - 1.5, 'center');
    x += c[0].w;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    fitText(doc, shortenWaypointName(wp.name), x + 2.5, ty, c[1].w - 4.5);
    x += c[1].w;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    fitText(doc, deriveTypeLabel(wp.type, wp.name), x + c[2].w / 2, ty, c[2].w - 1, 'center');
    x += c[2].w;

    const right = (col: number, text: string) => fitText(doc, text, x + c[col].w - 1.5, ty, c[col].w - 2.5, 'right');
    right(3, idx === 0 ? '—' : `${String(Math.round(wp.bearingMagDeg) % 360).padStart(3, '0')}°`);
    x += c[3].w;
    right(4, idx === 0 ? '—' : wp.legDistNm.toFixed(1));
    x += c[4].w;
    right(5, wp.cumulativeDistNm.toFixed(1));
    x += c[5].w;

    const alt = compactAlt(wp.altDisplay, wp.altFt);
    const altW = c[6].w - 3.5;
    fitText(doc, doc.getTextWidth(pdfSafe(alt.full)) <= altW ? alt.full : alt.short, x + 2.5, ty, altW);
    x += c[6].w;

    right(7, `${wp.speedKts} kt · M${wp.mach}`);
    x += c[7].w;
    right(8, idx === 0 ? '—' : formatDuration(wp.legEteSeconds));
    x += c[8].w;
    doc.setFont('helvetica', 'bold');
    right(9, formatDuration(wp.cumulativeTimeSeconds));

    y += rowH;
  });

  // Legend under the table when there is room
  if (y + 9 < BOTTOM_LIMIT) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...TEXT_MUTED);
    fitText(
      doc,
      'DEP departure · CLB climb · ENTRY/EGRS low-level entry/egress · CP checkpoint · IP initial point · TGT/DZ target · CARP release point · IAF/INIT/FINAL approach · T&G touch-and-go · TDZ touchdown',
      MARGIN,
      y + 4.5,
      CONTENT_W
    );
  }

  // --- 5. Footer with page numbers on every page ------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...GRAY_BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, FOOTER_Y - 3.5, PAGE_W - MARGIN, FOOTER_Y - 3.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...TEXT_MUTED);
    fitText(doc, `MSFS Military Flight Desk  ·  ${plan.callsign}  ·  ${plan.sortieId}`, MARGIN, FOOTER_Y, 120);
    fitText(
      doc,
      `${plan.generatedAt ? `Generated ${plan.generatedAt}  ·  ` : ''}Page ${p} of ${pages}`,
      PAGE_W - MARGIN,
      FOOTER_Y,
      70,
      'right'
    );
  }

  return doc;
}

/**
 * Triggers browser download for the Kneeboard PDF file.
 */
export function downloadKneeboardPdf(plan: GeneratedFlightPlan): void {
  const doc = generateKneeboardPdf(plan);
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

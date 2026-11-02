import { jsPDF } from 'jspdf';
import { GeneratedFlightPlan } from '../types/flightDesk';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Derives a clean 3-5 letter waypoint category/type for the navigation log.
 */
function deriveTypeLabel(wpType: string, name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes('TOUCHDOWN')) return 'TDZ';
  if (upper.includes('TOUCH & GO') || upper.includes('TOUCH AND GO') || wpType === 'TNG') return 'T&G';
  if (upper.includes('FINAL')) return 'FINAL';
  if (upper.includes('INITIAL') || upper.includes('INIT')) return 'PITCH';
  if (upper.includes('OVERHEAD')) return 'OVRHD';
  if (upper.includes('BREAK')) return 'BREAK';
  if (upper.includes('DOWNWIND') || upper.includes('DWIND')) return 'DWIND';
  if (upper.includes('PERCH')) return 'PERCH';
  if (upper.includes('LIFTOFF')) return 'LOFF';
  if (upper.includes('CLIMB')) return 'CLB';
  if (upper.includes('EGRESS')) return 'EGRS';
  if (wpType === 'DEP') return 'DEP';
  if (wpType === 'ARR') return 'ARR';
  if (wpType === 'IP') return 'IP';
  if (wpType === 'RECOVERY') return 'RCV';
  if (wpType === 'MTR_ENTRY') return 'ENTRY';
  if (wpType === 'CHECKPOINT') return 'CP';
  return wpType;
}

/**
 * Shortens long waypoint names to fit cleanly inside kneeboard table columns.
 */
function shortenWaypointName(name: string): string {
  return name
    .replace(/HIGH-G HORIZONTAL REVERSAL/gi, 'HIGH-G HORIZ REV')
    .replace(/DYNAMIC VERTICAL SPLIT/gi, 'DYN VERT SPLIT')
    .replace(/CONTOUR RIDGE PASS/gi, 'CONTOUR RIDGE PASS')
    .replace(/LOWAT TACTICAL ENTRY/gi, 'LOWAT ENTRY')
    .replace(/LOWAT TACTICAL EGRESS/gi, 'LOWAT EGRESS')
    .replace(/INITIAL (RWY \w+) \(PITCH\)/gi, 'INIT $1')
    .replace(/INITIAL (RWY \w+)/gi, 'INIT $1')
    .replace(/360 BREAK \/ DOWNWIND PERCH/gi, '360 BREAK / PERCH')
    .replace(/FINAL APPROACH (RWY \w+)/gi, 'FINAL $1')
    .replace(/(RWY \w+) CLIMBOUT/gi, '$1 CLIMB')
    .replace(/(RWY \w+) TOUCHDOWN/gi, '$1 TDZ')
    .replace(/EGRESS TRANSITION/gi, 'EGRESS TRANS')
    .replace(/CROSSWIND DEP/gi, 'CROSSWIND DEP');
}

/**
 * Condenses altitude strings into compact aviation format (e.g. 2,150' MSL (1.8k AGL)).
 */
function formatKneeboardAlt(altDisplay: string, altFt: number): string {
  if (!altDisplay) return `${altFt.toLocaleString()}' MSL`;
  
  let condensed = altDisplay
    .replace(/ft\s*MSL/gi, "' MSL")
    .replace(/ft\s*AGL/gi, "' AGL")
    .replace(/\s+/g, ' ')
    .trim();

  // If still very long (over 20 chars), prioritize primary altitude
  if (condensed.length > 20) {
    const mslMatch = condensed.match(/([\d,]+'\s*MSL)/i);
    const aglMatch = condensed.match(/\(([\d,]+)'\s*AGL\)/i);
    if (mslMatch && aglMatch) {
      return `${mslMatch[1]} (${aglMatch[1]}' AGL)`;
    }
    if (mslMatch) {
      return mslMatch[1];
    }
  }

  return condensed;
}

/**
 * Renders text strictly within maxWidth, automatically truncating with ellipsis if needed.
 * Prevents text from ever spilling outside its cell or bounding box borders.
 */
function renderSafeText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options?: { align?: 'left' | 'center' | 'right' }
): void {
  let str = text;
  if (doc.getTextWidth(str) > maxWidth) {
    while (str.length > 3 && doc.getTextWidth(str + '…') > maxWidth) {
      str = str.slice(0, -1);
    }
    str += '…';
  }
  doc.text(str, x, y, options);
}

/**
 * Generates an airframe-neutral military flight plan Kneeboard PDF document.
 * Formatted cleanly with compact dimensions, strict text boundary enforcement,
 * and pure aeronautical navigation data.
 */
export function generateKneeboardPdf(plan: GeneratedFlightPlan): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2; // 190mm

  // Color palette
  const navyDark = [15, 23, 42]; // #0F172A
  const blueAccent = [37, 99, 235]; // #2563EB
  const grayLight = [241, 245, 249]; // #F1F5F9
  const grayBorder = [203, 213, 225]; // #CBD5E1
  const textDark = [30, 41, 59];
  const textMuted = [100, 116, 139];

  let currentY = margin;

  // --- 1. COMPACT TOP HEADER BANNER ---
  const headerH = 14;
  doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.rect(margin, currentY, contentWidth, headerH, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  renderSafeText(doc, 'TACTICAL SORTIE KNEEBOARD', margin + 3, currentY + 5.5, 95);

  // Subtitle
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  renderSafeText(
    doc,
    `SORTIE: ${plan.sortieId}  •  CALLSIGN: ${plan.callsign}  •  VFR`,
    margin + 3,
    currentY + 10.5,
    115
  );

  // Mission Profile badge (Top-Right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(56, 189, 248); // sky-400
  const profileLabel =
    plan.missionProfile === 'lltr_tng'
      ? 'LLTR + TOUCH & GO'
      : plan.missionProfile === 'low_level_mtr'
      ? 'LLTR LOW-LEVEL'
      : 'TACTICAL SORTIE';
  renderSafeText(doc, profileLabel, pageWidth - margin - 3, currentY + 8, 65, { align: 'right' });

  currentY += headerH + 2.5;

  // --- 2. KEY MISSION METRICS GRID (4 COLUMNS) ---
  const colW = contentWidth / 4;
  const kpiH = 12;

  doc.setFillColor(grayLight[0], grayLight[1], grayLight[2]);
  doc.setDrawColor(grayBorder[0], grayBorder[1], grayBorder[2]);
  doc.rect(margin, currentY, contentWidth, kpiH, 'FD');

  const cleanAssignedAlt = plan.assignedAltitude
    .replace(/\s*\(.*\)/, '')
    .replace(/TERRAIN FOLLOWING/gi, 'TF')
    .replace(/TACTICAL CONTOUR/gi, 'CONTOUR')
    .trim();

  const kpis = [
    { label: 'OPERATING BASE', val: `${plan.operatingAirbase.ident} (${plan.operatingAirbase.elevationFt} FT)` },
    { label: 'ROUTE DISTANCE', val: `${plan.totalDistanceNm} NM` },
    { label: 'SORTIE FLT TIME', val: `${plan.totalFlightTimeMin} MIN (${plan.waypoints.length} WPs)` },
    { label: 'ASSIGNED ALTITUDE', val: cleanAssignedAlt },
  ];

  kpis.forEach((k, idx) => {
    const x = margin + idx * colW + 2.5;
    const maxValW = colW - 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    renderSafeText(doc, k.label, x, currentY + 4, maxValW);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    renderSafeText(doc, k.val, x, currentY + 9, maxValW);
  });

  currentY += kpiH + 2.5;

  // --- 3. COMMS, NAV & 360° OVERHEAD RECOVERY STRIP ---
  const commBoxH = 19;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(grayBorder[0], grayBorder[1], grayBorder[2]);
  doc.rect(margin, currentY, contentWidth, commBoxH, 'FD');

  // Divider between Left and Right sub-boxes
  const leftW = 88;
  const dividerX = margin + leftW;
  doc.line(dividerX, currentY, dividerX, currentY + commBoxH);

  // Left Sub-box: Comms & Frequencies
  const leftMaxW = leftW - 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(blueAccent[0], blueAccent[1], blueAccent[2]);
  renderSafeText(doc, 'COMMS & TRANSPONDER', margin + 3, currentY + 4.5, leftMaxW);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  renderSafeText(
    doc,
    `TWR / OPS: ${plan.operatingAirbase.towerMhz || '128.700 MHz'}`,
    margin + 3,
    currentY + 8.5,
    leftMaxW
  );
  renderSafeText(
    doc,
    `TAC FREQ: ${plan.tacFrequencyMhz || '312.450 MHz'}`,
    margin + 3,
    currentY + 12.5,
    leftMaxW
  );
  renderSafeText(
    doc,
    `SQUAWK: ${plan.squawk}   MAG VAR: ${plan.operatingAirbase.magDecl || '0°'}`,
    margin + 3,
    currentY + 16.5,
    leftMaxW
  );

  // Right Sub-box: Real-Time Weather & 360° Overhead Pattern
  const rightX = dividerX + 3;
  const rightMaxW = contentWidth - leftW - 6;
  const depW = plan.departureWeather;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(blueAccent[0], blueAccent[1], blueAccent[2]);
  renderSafeText(
    doc,
    `RECOVERY: ACTIVE RWY ${depW?.activeRunway || 'PRIMARY'}${depW?.runwayEstimated ? ' (EST - VERIFY)' : ''}`,
    rightX,
    currentY + 4.5,
    rightMaxW
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);

  const windStr = depW ? `${depW.windDirDeg}°@${depW.windSpeedKts}KT` : 'CALM 000@00KT';
  const hwStr = depW
    ? `HW ${depW.headwindKts >= 0 ? `+${depW.headwindKts}` : depW.headwindKts} · XW ${Math.abs(depW.crosswindKts)}${depW.crosswindKts >= 0 ? 'R' : 'L'}`
    : 'CALM';
  const altStr = depW ? `${depW.altimeterInHg.toFixed(2)} inHg (${Math.round(depW.altimeterHpa)} hPa)` : '29.92 inHg';

  renderSafeText(doc, `SURFACE WIND: ${windStr}  (${hwStr})`, rightX, currentY + 8.5, rightMaxW);
  const isCargo = plan.aircraftType === 'Cargo';
  const straightIn = plan.waypoints.some((w) => w.name.startsWith('IAF'));
  renderSafeText(
    doc,
    isCargo
      ? `QNH: ${altStr}   ${straightIn ? "IAF: 3,000' AGL / 200 KT" : "PATTERN: 1,500' AGL / 200 KT"}`
      : `QNH: ${altStr}   PITCH: 1,500' AGL / 350 KT`,
    rightX,
    currentY + 12.5,
    rightMaxW
  );
  renderSafeText(
    doc,
    isCargo
      ? straightIn
        ? 'FINAL: IAF > 5 NM > 3 NM > SHORT FINAL > TDZ'
        : 'PATTERN: ENTRY > DOWNWIND > BASE > FINAL > TDZ'
      : 'PATTERN: OVERHEAD > DOWNWIND > PERCH > FINAL > TDZ',
    rightX,
    currentY + 16.5,
    rightMaxW
  );

  currentY += commBoxH + 3.5;

  // --- 4. OPERATIONAL NAVIGATION LOG (NAVLOG) TABLE ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(navyDark[0], navyDark[1], navyDark[2]);
  renderSafeText(doc, 'OPERATIONAL NAVIGATION LOG (NAVLOG)', margin, currentY + 2.5, 120);

  currentY += 4.5;

  // Table Column Definitions (Total Width = 190mm)
  // Perfectly calibrated to provide ample margin so no numbers or text overflow
  const tableCols = [
    { label: '#', w: 6, align: 'center' as const },
    { label: 'WAYPOINT / FIX', w: 46, align: 'left' as const },
    { label: 'TYPE', w: 12, align: 'center' as const },
    { label: 'HDG (°M)', w: 14, align: 'right' as const },
    { label: 'LEG (NM)', w: 14, align: 'right' as const },
    { label: 'TOTAL', w: 15, align: 'right' as const },
    { label: 'ALTITUDE', w: 35, align: 'left' as const },
    { label: 'SPEED', w: 22, align: 'right' as const },
    { label: 'ETE', w: 13, align: 'right' as const },
    { label: 'CUM TIME', w: 13, align: 'right' as const },
  ];

  // Table Header Row
  const thHeight = 6;
  doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
  doc.rect(margin, currentY, contentWidth, thHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);

  let curX = margin;
  tableCols.forEach((col) => {
    const textX = col.align === 'right' ? curX + col.w - 1.5 : col.align === 'center' ? curX + col.w / 2 : curX + 1.5;
    renderSafeText(doc, col.label, textX, currentY + 4.2, col.w - 1, { align: col.align });
    curX += col.w;
  });

  currentY += thHeight;

  // NavLog Data Rows
  const rowHeight = 5.6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);

  plan.waypoints.forEach((wp, idx) => {
    // Check page overflow and add subsequent page if required
    if (currentY + rowHeight > pageHeight - 10) {
      doc.addPage();
      currentY = margin;

      // Re-draw table header on next page
      doc.setFillColor(navyDark[0], navyDark[1], navyDark[2]);
      doc.rect(margin, currentY, contentWidth, thHeight, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(255, 255, 255);

      let headerX = margin;
      tableCols.forEach((col) => {
        const textX = col.align === 'right' ? headerX + col.w - 1.5 : col.align === 'center' ? headerX + col.w / 2 : headerX + 1.5;
        renderSafeText(doc, col.label, textX, currentY + 4.2, col.w - 1, { align: col.align });
        headerX += col.w;
      });
      currentY += thHeight;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
    }

    const isEven = idx % 2 === 0;
    const isBase = idx === 0 || idx === plan.waypoints.length - 1;
    const isIp = wp.type === 'IP';

    if (isBase) {
      doc.setFillColor(239, 246, 255); // very light blue
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
    } else if (isIp) {
      doc.setFillColor(254, 243, 199); // light amber
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
    } else if (isEven) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
    }

    // Row bottom separator line
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, currentY + rowHeight, margin + contentWidth, currentY + rowHeight);

    doc.setTextColor(textDark[0], textDark[1], textDark[2]);

    let rowX = margin;

    // 1. # (Index)
    renderSafeText(
      doc,
      String(idx + 1),
      rowX + tableCols[0].w / 2,
      currentY + 3.9,
      tableCols[0].w - 1,
      { align: 'center' }
    );
    rowX += tableCols[0].w;

    // 2. Waypoint Name (Shortened and safe)
    const displayName = shortenWaypointName(wp.name);
    doc.setFont('helvetica', 'bold');
    renderSafeText(doc, displayName, rowX + 1.5, currentY + 3.9, tableCols[1].w - 3, { align: 'left' });
    doc.setFont('helvetica', 'normal');
    rowX += tableCols[1].w;

    // 3. Type
    const typeLbl = deriveTypeLabel(wp.type, wp.name);
    renderSafeText(
      doc,
      typeLbl,
      rowX + tableCols[2].w / 2,
      currentY + 3.9,
      tableCols[2].w - 1,
      { align: 'center' }
    );
    rowX += tableCols[2].w;

    // 4. HDG (°M)
    const hdgStr = idx === 0 ? '—' : `${wp.bearingMagDeg.toString().padStart(3, '0')}°`;
    renderSafeText(
      doc,
      hdgStr,
      rowX + tableCols[3].w - 1.5,
      currentY + 3.9,
      tableCols[3].w - 2,
      { align: 'right' }
    );
    rowX += tableCols[3].w;

    // 5. Leg Distance (NM)
    const legStr = idx === 0 ? '—' : wp.legDistNm.toFixed(1);
    renderSafeText(
      doc,
      legStr,
      rowX + tableCols[4].w - 1.5,
      currentY + 3.9,
      tableCols[4].w - 2,
      { align: 'right' }
    );
    rowX += tableCols[4].w;

    // 6. Total Distance (NM)
    renderSafeText(
      doc,
      wp.cumulativeDistNm.toFixed(1),
      rowX + tableCols[5].w - 1.5,
      currentY + 3.9,
      tableCols[5].w - 2,
      { align: 'right' }
    );
    rowX += tableCols[5].w;

    // 7. Altitude (MSL / AGL)
    const altStr = formatKneeboardAlt(wp.altDisplay, wp.altFt);
    renderSafeText(doc, altStr, rowX + 1.5, currentY + 3.9, tableCols[6].w - 3, { align: 'left' });
    rowX += tableCols[6].w;

    // 8. Speed
    const spdStr = `${wp.speedKts} kt (M${wp.mach})`;
    renderSafeText(
      doc,
      spdStr,
      rowX + tableCols[7].w - 1.5,
      currentY + 3.9,
      tableCols[7].w - 2,
      { align: 'right' }
    );
    rowX += tableCols[7].w;

    // 9. ETE
    const eteStr = idx === 0 ? '—' : formatDuration(wp.legEteSeconds);
    renderSafeText(
      doc,
      eteStr,
      rowX + tableCols[8].w - 1.5,
      currentY + 3.9,
      tableCols[8].w - 2,
      { align: 'right' }
    );
    rowX += tableCols[8].w;

    // 10. Cumulative Time
    doc.setFont('helvetica', 'bold');
    renderSafeText(
      doc,
      formatDuration(wp.cumulativeTimeSeconds),
      rowX + tableCols[9].w - 1.5,
      currentY + 3.9,
      tableCols[9].w - 2,
      { align: 'right' }
    );
    doc.setFont('helvetica', 'normal');

    currentY += rowHeight;
  });

  // --- 5. CLEAN AIRFRAME-NEUTRAL FOOTER ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  renderSafeText(
    doc,
    `MSFS Military Flight Desk  •  Sortie: ${plan.callsign} (${plan.sortieId})  •  Generated: ${plan.generatedAt}  •  VFR Sortie`,
    margin,
    pageHeight - 4,
    contentWidth
  );

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
      : plan.missionProfile === 'low_level_mtr'
      ? 'LLTR'
      : 'TACTICAL';
  const callsignClean = plan.callsign.replace(/\s+/g, '_');
  const filename = `KNEEBOARD_${depIcao}_${profile}_${callsignClean}.pdf`;
  doc.save(filename);
}

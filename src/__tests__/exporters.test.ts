import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import { generateMsfs2020PlnXml } from '../utils/msfsExporter';
import { generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import { uniqueIdent, lowLevelCruiseAltitudeFt } from '../utils/exportCommon';
import type { Airport } from '../types/flightDesk';

const eplk: Airport = {
  ident: 'EPLK', icao: 'EPLK', name: '32nd Tactical Air Base', elevationFt: 633,
  magDecl: '5.2° East', longestRunwayFt: 9843, latitude: 51.5519, longitude: 19.1794, military: true,
};

describe('exportCommon', () => {
  it('uniqueIdent adds numeric suffixes within the length limit', () => {
    const used = new Set<string>();
    expect(uniqueIdent('DWIND', used, 5)).toBe('DWIND');
    expect(uniqueIdent('DWIND', used, 5)).toBe('DWIN2');
    expect(uniqueIdent('DWIND', used, 5)).toBe('DWIN3');
  });
});

describe('exports of a low-level plan', () => {
  it('has unique user waypoint idents in MSFS and Little Navmap files', () => {
    for (let i = 0; i < 10; i++) {
      const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium');
      const msfs = [...generateMsfs2020PlnXml(p).matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);
      expect(new Set(msfs).size).toBe(msfs.length);
      const lnm = [...generateLittleNavmapXml(p).matchAll(/<Ident>([^<]*)<\/Ident>\s*<Type>USER/g)].map((m) => m[1]);
      expect(new Set(lnm).size).toBe(lnm.length);
    }
  });

  it('uses the highest low-level waypoint as cruise altitude when terrain data is flagged, never 15,000 ft', () => {
    const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, getNeutralWeather(eplk));
    const flagged = { ...p, terrainSource: 'ESTIMATED' as const, assignedAltitude: 'Low-level (terrain data unavailable, verify AGL)' };
    const expected = lowLevelCruiseAltitudeFt(flagged);
    expect(expected).not.toBe(null);
    const xml = generateMsfs2020PlnXml(flagged);
    expect(xml).toContain(`<CruisingAlt>${expected}</CruisingAlt>`);
    expect(xml).not.toContain('<CruisingAlt>15000</CruisingAlt>');
  });
});

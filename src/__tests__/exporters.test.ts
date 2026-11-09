import { describe, it, expect } from 'vitest';
import { generateMilitaryFlightPlan } from '../utils/routeGenerator';
import { getNeutralWeather } from '../utils/weatherService';
import {
  generateMsfs2020PlnXml,
  generateMsfs2024PlnXml,
  msfsPlnFilename,
  parseRunwayFor2024,
} from '../utils/msfsExporter';
import { generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import { uniqueIdent, lowLevelCruiseAltitudeFt } from '../utils/exportCommon';
import { generateKneeboardPdf } from '../utils/kneeboardPdfExporter';
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

describe('MSFS 2024 export', () => {
  const userIdents = (xml: string) =>
    [...xml.matchAll(/<ATCWaypoint id="([^"]+)">\s*<ATCWaypointType>User/g)].map((m) => m[1]);

  it('uses the 2024 EFB layout, not the 2020 one', () => {
    const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium');
    const xml = generateMsfs2024PlnXml(p);
    expect(xml).toContain('<SimBase.Document>');
    expect(xml).not.toContain('AceXML');
    expect(xml).toContain('<DepartureID>EPLK</DepartureID>');
    expect(xml).toContain('<DestinationID>EPLK</DestinationID>');
    expect(xml).toContain('<AppVersionMajor>12</AppVersionMajor>');
    for (const tag of ['Title', 'Descr', 'FPType', 'CruisingAlt', 'AppVersion']) {
      expect(xml).toContain(`<${tag}>`);
    }
    // Airports are not waypoints in the 2024 file.
    expect(xml).not.toContain('<ATCWaypointType>Airport');
  });

  it('follows the same rules as 2020: same waypoints, idents, cruise altitude and title', () => {
    for (let i = 0; i < 10; i++) {
      const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium');
      const x20 = generateMsfs2020PlnXml(p);
      const x24 = generateMsfs2024PlnXml(p);
      expect(userIdents(x24)).toEqual(userIdents(x20));
      expect(userIdents(x24).length).toBe(p.waypoints.length - 2);
      expect(x24.match(/<CruisingAlt>[^<]*<\/CruisingAlt>/)![0]).toBe(x20.match(/<CruisingAlt>[^<]*<\/CruisingAlt>/)![0]);
      expect(x24.match(/<Title>[^<]*<\/Title>/)![0]).toBe(x20.match(/<Title>[^<]*<\/Title>/)![0]);
    }
  });

  it('gives every user waypoint a unique ident of at most 8 characters, a position and an ICAO block', () => {
    for (let i = 0; i < 10; i++) {
      const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'long');
      const xml = generateMsfs2024PlnXml(p);
      const ids = userIdents(xml);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.length).toBeLessThanOrEqual(8);
        expect(xml).toContain(`<ICAOIdent>${id}</ICAOIdent>`);
      }
      const positions = [...xml.matchAll(/<WorldPosition>([^<]+)<\/WorldPosition>/g)].map((m) => m[1]);
      expect(positions.length).toBe(ids.length);
      for (const pos of positions) expect(pos).toMatch(/^[NS]\d{2}° \d{2}' \d{2}\.\d{2}", [EW]\d{3}° \d{2}' \d{2}\.\d{2}", [+-]\d{6}\.00$/);
    }
  });

  it('also works for cargo and Touch & Go plans', () => {
    const cargo = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'medium', undefined, undefined, undefined, 'cargo');
    expect(userIdents(generateMsfs2024PlnXml(cargo))).toEqual(userIdents(generateMsfs2020PlnXml(cargo)));
    const epks: Airport = {
      ident: 'EPKS', icao: 'EPKS', name: 'Krzesiny', elevationFt: 279,
      magDecl: '4.8° East', longestRunwayFt: 8202, latitude: 52.3317, longitude: 16.9664, military: true,
    };
    const tng = generateMilitaryFlightPlan(eplk, 'lltr_tng', 'medium', epks, getNeutralWeather(eplk), getNeutralWeather(epks));
    const xml = generateMsfs2024PlnXml(tng);
    expect(userIdents(xml)).toEqual(userIdents(generateMsfs2020PlnXml(tng)));
    expect(userIdents(xml)).toContain('TNG');
  });

  it('writes the active runway as departure and arrival details', () => {
    const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'short', undefined, {
      ...getNeutralWeather(eplk),
      activeRunway: '27L',
    });
    const xml = generateMsfs2024PlnXml(p);
    expect(xml).toMatch(/<DepartureDetails>\s*<RunwayNumberFP>27<\/RunwayNumberFP>\s*<RunwayDesignatorFP>LEFT<\/RunwayDesignatorFP>\s*<\/DepartureDetails>/);
    expect(xml).toMatch(/<ArrivalDetails>\s*<RunwayNumberFP>27<\/RunwayNumberFP>\s*<RunwayDesignatorFP>LEFT<\/RunwayDesignatorFP>\s*<\/ArrivalDetails>/);
  });

  it('parses runway names', () => {
    expect(parseRunwayFor2024('27L')).toEqual({ number: '27', designator: 'LEFT' });
    expect(parseRunwayFor2024('09R')).toEqual({ number: '9', designator: 'RIGHT' });
    expect(parseRunwayFor2024('RWY 36')).toEqual({ number: '36', designator: undefined });
    expect(parseRunwayFor2024('18C')).toEqual({ number: '18', designator: 'CENTER' });
    expect(parseRunwayFor2024('')).toBe(null);
    expect(parseRunwayFor2024('H1')).toBe(null);
    expect(parseRunwayFor2024('45')).toBe(null);
  });

  it('names the 2024 file differently so both versions fit in one folder', () => {
    const p = generateMilitaryFlightPlan(eplk, 'low_level_mtr', 'short');
    expect(msfsPlnFilename(p, '2024')).toBe(msfsPlnFilename(p, '2020').replace('.pln', '_MSFS2024.pln'));
  });
});

describe('kneeboard pdf', () => {
  it('builds a short paginated document without doubled runway labels or an invented frequency', () => {
    for (const profile of ['low_level_mtr', 'lltr_tng'] as const) {
      const p = generateMilitaryFlightPlan(eplk, profile, 'long', profile === 'lltr_tng' ? { ...eplk, ident: 'EPKS', icao: 'EPKS', military: true } : undefined);
      const doc = generateKneeboardPdf(p);
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
      expect(doc.getNumberOfPages()).toBeLessThan(4);
      const raw = doc.output();
      expect(raw.includes('RWY RWY')).toBe(false);
      expect(raw.includes('128.700')).toBe(false);
    }
  });
});

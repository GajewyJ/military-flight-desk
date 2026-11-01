import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface DetailedRow {
  ident: string;
  icao: string;
  name: string;
  elevationFt: number;
  latitude: number;
  longitude: number;
  military?: boolean;
  runwayDesignator?: string;
}

const rows: DetailedRow[] = JSON.parse(
  readFileSync(new URL('../../public/detailed_airports.json', import.meta.url), 'utf8')
);
const byIdent = new Map(rows.map((r) => [r.ident, r]));

describe('detailed_airports.json', () => {
  it('has unique idents and complete basic fields', () => {
    expect(byIdent.size).toBe(rows.length);
    for (const r of rows) {
      expect(r.icao).toBe(r.ident);
      expect(r.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).toBe(true);
      expect(Number.isFinite(r.elevationFt)).toBe(true);
    }
  });

  it('contains the major Polish airports and the active Polish airbases', () => {
    const civil = ['EPWA', 'EPMO', 'EPKK', 'EPKT', 'EPGD', 'EPPO', 'EPWR', 'EPLL', 'EPSC', 'EPRZ', 'EPLB', 'EPBY', 'EPSY', 'EPZG', 'EPRA'];
    const bases = ['EPLK', 'EPKS', 'EPMB', 'EPMM', 'EPSN', 'EPPW', 'EPDE', 'EPOK', 'EPCE', 'EPMI', 'EPPR', 'EPIR'];
    for (const id of civil) {
      expect(byIdent.has(id)).toBe(true);
      expect(byIdent.get(id)!.military).toBe(false);
    }
    for (const id of bases) {
      expect(byIdent.has(id)).toBe(true);
      expect(byIdent.get(id)!.military).toBe(true);
    }
  });

  it('does not list Redzikowo (EPSK), and gives Koszalin-Zegrze Pomorskie its runway 07/25', () => {
    expect(byIdent.has('EPSK')).toBe(false);
    expect(byIdent.get('EPKZ')!.runwayDesignator).toBe('07/25');
  });

  it('places every Polish entry inside Poland', () => {
    for (const r of rows.filter((x) => x.ident.startsWith('EP'))) {
      expect(r.latitude).toBeGreaterThan(48.9);
      expect(r.latitude).toBeLessThan(54.9);
      expect(r.longitude).toBeGreaterThan(14.0);
      expect(r.longitude).toBeLessThan(24.2);
    }
  });

  it('only lists clean runway designators', () => {
    for (const r of rows.filter((x) => x.runwayDesignator)) {
      for (const pair of r.runwayDesignator!.split(',')) {
        expect(pair.trim()).toMatch(/^\d{2}[LRC]?\/\d{2}[LRC]?$/);
      }
    }
  });
});

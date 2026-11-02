import { describe, it, expect } from 'vitest';
import {
  buildAirports,
  buildRunways,
  formatMagDecl,
  keepRunwaysFor,
  looksMilitary,
  parseCsv,
} from '../../scripts/ourairports';
import { getAirportByIcao, loadAirportsFromJson } from '../data/airports';

const AIRPORTS_CSV = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code',
  '1,EPLK,medium_airport,"Łask Air Base",51.5519,19.1794,633,EU,PL,PL-LD,Łask,no,EPLK,,EPLK,',
  '2,EPPO,large_airport,"Poznań–Ławica Henryk Wieniawski Airport",52.4211,16.8263,308,EU,PL,PL-WP,Poznań,yes,EPPO,POZ,EPPO,',
  '3,EPXX,heliport,"Some Heliport",50.0,19.0,300,EU,PL,PL-MA,Kraków,no,,,,',
  '4,EPZZ,closed,"Closed Field",50.1,19.1,300,EU,PL,PL-MA,Kraków,no,,,,',
  '5,EPLK,small_airport,"Duplicate Ident",51.0,19.0,100,EU,PL,PL-LD,Łask,no,,,,',
  '6,00AK,small_airport,"Lowell Field",59.9492,-151.696,450,NA,US,US-AK,"Anchor Point, AK",no,,,00AK,00AK',
  '7,XY01,small_airport,"Test Field",50.5,19.5,500,EU,PL,PL-SL,Testville,no,,,,',
].join('\r\n');

const RUNWAYS_CSV = [
  'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,le_elevation_ft,le_heading_degT,le_displaced_threshold_ft,he_ident,he_latitude_deg,he_longitude_deg,he_elevation_ft,he_heading_degT,he_displaced_threshold_ft',
  '1,1,EPLK,9843,148,ASP,1,0,10,,,,97.3,,28,,,,277.3,',
  '2,1,EPLK,2000,60,GRS,0,0,04,,,,,,22,,,,,',
  '3,1,EPLK,5000,100,ASP,1,1,01,,,,,,19,,,,,',
  '4,2,EPPO,8202,148,CON,1,0,10,,,,,,28,,,,,',
  '5,7,XY01,4000,100,ASP,0,0,09,,,,,,27,,,,,',
].join('\n');

const FREQ_CSV = [
  'id,airport_ref,airport_ident,type,description,frequency_mhz',
  '1,1,EPLK,CTAF,"Łask CTAF",122.5',
  '2,1,EPLK,TWR,"Łask Tower",118.3',
  '3,2,EPPO,ATIS,"Poznań ATIS",127.45',
  '4,2,EPPO,TWR,"Poznań Tower",118.3',
  '5,7,XY01,TWR,"Test Tower",120.5',
].join('\n');

describe('parseCsv', () => {
  it('handles quotes, commas and line breaks inside quotes, escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('\ufeffa,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",z');
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ a: '1', b: 'x, y', c: 'say "hi"' });
    expect(rows[1].b).toBe('two\nlines');
    expect(rows[1].c).toBe('z');
  });

  it('keeps empty fields and ignores blank lines', () => {
    const rows = parseCsv('a,b,c\n1,,3\n\n4,5,\n');
    expect(rows).toEqual([
      { a: '1', b: '', c: '3' },
      { a: '4', b: '5', c: '' },
    ]);
  });
});

describe('small helpers', () => {
  it('formats magnetic declination like the app expects', () => {
    expect(formatMagDecl(6.54)).toBe('6.5° East');
    expect(formatMagDecl(-3.12)).toBe('3.1° West');
  });

  it('flags military names', () => {
    expect(looksMilitary('Łask Air Base')).toBe(true);
    expect(looksMilitary('Nellis AFB')).toBe(true);
    expect(looksMilitary('RAF Lakenheath')).toBe(true);
    expect(looksMilitary('Poznań–Ławica Henryk Wieniawski Airport')).toBe(false);
    expect(looksMilitary('Baseline Field')).toBe(false);
  });
});

describe('buildRunways', () => {
  const rw = buildRunways(parseCsv(RUNWAYS_CSV));

  it('skips closed runways and sorts longest first', () => {
    expect(rw.EPLK.map((r) => r.le)).toEqual(['10', '04']);
  });

  it('keeps true headings only when the data has them', () => {
    expect(rw.EPLK[0].leHdg).toBe(97.3);
    expect(rw.EPLK[0].heHdg).toBe(277.3);
    expect(rw.EPLK[1].leHdg).toBe(undefined);
    expect(rw.EPLK[0].len).toBe(9843);
    expect(rw.EPLK[0].surface).toBe('ASP');
  });
});

describe('keepRunwaysFor', () => {
  it('drops runway rows of airports that are not in the airport list', () => {
    const rw = buildRunways(parseCsv(RUNWAYS_CSV));
    const kept = keepRunwaysFor(rw, [{ ident: 'EPLK' }]);
    expect(Object.keys(kept)).toEqual(['EPLK']);
    expect(kept.EPLK.length).toBe(2);
  });
});

describe('buildAirports', () => {
  const runways = buildRunways(parseCsv(RUNWAYS_CSV));
  const built = buildAirports(parseCsv(AIRPORTS_CSV), runways, parseCsv(FREQ_CSV), () => 6.5);

  it('keeps only open airplane airfields and drops duplicate idents', () => {
    expect(built.map((a) => a.ident)).toEqual(['00AK', 'EPLK', 'EPPO', 'XY01']);
    expect(built.find((a) => a.ident === 'EPLK')!.name).toBe('Łask Air Base');
  });

  it('fills elevation, location, runway length, tower frequency and declination', () => {
    const a = built.find((x) => x.ident === 'EPLK')!;
    expect(a.elevationFt).toBe(633);
    expect(a.latitude).toBeCloseTo(51.5519, 4);
    expect(a.longestRunwayFt).toBe(9843);
    expect(a.towerMhz).toBe('118.300'); // the tower beats the CTAF
    expect(a.magDecl).toBe('6.5° East');
    expect(a.countryOrAreaCode).toBe('PL');
    expect(a.military).toBe(true);
    expect(built.find((x) => x.ident === 'EPPO')!.military).toBe(false);
  });

  it('leaves out the declination instead of inventing one', () => {
    const none = buildAirports(parseCsv(AIRPORTS_CSV), runways, [], () => undefined);
    expect(none[0].magDecl).toBe(undefined);
    expect(none[0].towerMhz).toBe(undefined);
  });

  it('uses the app\'s loader without changes', () => {
    // XY01 is not a curated airfield, so this test does not depend on whether the data files load
    const res = loadAirportsFromJson(built as unknown as Record<string, unknown>[], false);
    expect(res.count).toBe(4);
    const field = getAirportByIcao('XY01')!;
    expect(field.elevationFt).toBe(500);
    expect(field.magDecl).toBe('6.5° East');
    expect(field.towerMhz).toBe('120.500');
    expect(field.longestRunwayFt).toBe(4000);
    expect(field.military).toBe(false);
    expect(getAirportByIcao('00AK')!.city).toBe('Anchor Point, AK');
  });
});

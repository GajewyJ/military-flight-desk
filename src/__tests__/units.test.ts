import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UNITS,
  convertText,
  formatAlt,
  formatDist,
  formatPressure,
  formatSpeed,
  parseUnits,
  unitLabels,
  type Units,
} from '../utils/units';

const metric: Units = { altitude: 'm', speed: 'kmh', distance: 'km', pressure: 'hpa' };

describe('units', () => {
  it('formats single values', () => {
    expect(formatAlt(1500, DEFAULT_UNITS)).toBe('1,500 ft');
    expect(formatAlt(1500, metric)).toBe('457 m');
    expect(formatSpeed(450, metric)).toBe('833 km/h');
    expect(formatDist(10, metric)).toBe('18.5 km');
    expect(formatDist(10, DEFAULT_UNITS)).toBe('10.0 NM');
    expect(formatPressure(29.92, 1013, DEFAULT_UNITS)).toBe('29.92 inHg');
    expect(formatPressure(29.92, 1013, metric)).toBe('1013 hPa');
    expect(unitLabels(metric)).toEqual({ alt: 'm', spd: 'km/h', dist: 'km', press: 'hPa' });
  });

  it('leaves text alone in the default units', () => {
    expect(convertText('2,900 ft MSL (1,500 ft AGL)', DEFAULT_UNITS)).toBe('2,900 ft MSL (1,500 ft AGL)');
  });

  it('converts heights, speeds and distances inside text', () => {
    expect(convertText('2,900 ft MSL (1,500 ft AGL)', metric)).toBe('884 m MSL (457 m AGL)');
    expect(convertText('Pattern 1,500 ft AGL, pull-off ≥ 500 ft AGL', metric)).toBe('Pattern 457 m AGL, pull-off ≥ 152 m AGL');
    expect(convertText('350 – 400 KIAS', metric)).toBe('648 – 741 km/h');
    expect(convertText('420-540 kt cruise', metric)).toBe('778-1,000 km/h cruise');
    expect(convertText('35-300 NM from home', metric)).toBe('65-556 km from home');
    expect(convertText('Drop 800 ft AGL at 130 KIAS', metric)).toBe('Drop 244 m AGL at 241 km/h');
    expect(convertText('3 NM final', metric)).toBe('5.6 km final');
  });

  it('converts only the unit that was changed', () => {
    const altOnly: Units = { ...DEFAULT_UNITS, altitude: 'm' };
    expect(convertText('1,500 ft at 250 kt, 10 NM', altOnly)).toBe('457 m at 250 kt, 10 NM');
    const speedOnly: Units = { ...DEFAULT_UNITS, speed: 'kmh' };
    expect(convertText('1,500 ft at 250 kt, 10 NM', speedOnly)).toBe('1,500 ft at 463 km/h, 10 NM');
  });

  it('does not touch Mach numbers, headings or words that only contain a unit', () => {
    expect(convertText('M0.45 at 280° soft kilt NMEA', metric)).toBe('M0.45 at 280° soft kilt NMEA');
  });

  it('reads saved units and falls back to the defaults', () => {
    expect(parseUnits({ altitude: 'm', speed: 'kmh', distance: 'km', pressure: 'hpa' })).toEqual(metric);
    expect(parseUnits(null)).toEqual(DEFAULT_UNITS);
    expect(parseUnits({ altitude: 'furlongs' })).toEqual(DEFAULT_UNITS);
  });
});

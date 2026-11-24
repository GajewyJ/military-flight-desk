import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../hooks/useSettings';

describe('parseSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads saved values', () => {
    const s = parseSettings(
      '{"theme":"night","kneeboard":"print","simulator":"2020","units":{"altitude":"m","speed":"kmh","distance":"km","pressure":"hpa"}}'
    );
    expect(s.theme).toBe('night');
    expect(s.kneeboard).toBe('print');
    expect(s.simulator).toBe('2020');
    expect(s.units).toEqual({ altitude: 'm', speed: 'kmh', distance: 'km', pressure: 'hpa' });
  });

  it('keeps settings saved by an older version and fills in the new ones', () => {
    const s = parseSettings('{"theme":"night"}');
    expect(s.theme).toBe('night');
    expect(s.kneeboard).toBe('theme');
    expect(s.simulator).toBe('2024');
    expect(s.units).toEqual(DEFAULT_SETTINGS.units);
    expect(s.voiceAlerts).toBe(true);
  });

  it('has the spoken alerts on unless they were switched off', () => {
    expect(DEFAULT_SETTINGS.voiceAlerts).toBe(true);
    expect(parseSettings('{"voiceAlerts":false}').voiceAlerts).toBe(false);
    expect(parseSettings('{"voiceAlerts":true}').voiceAlerts).toBe(true);
    // Anything else is not an "off"
    expect(parseSettings('{"voiceAlerts":"no"}').voiceAlerts).toBe(true);
    expect(parseSettings('{"voiceAlerts":0}').voiceAlerts).toBe(true);
  });

  it('falls back to the defaults for anything invalid', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"theme":"purple","kneeboard":"x","simulator":"1999","units":{"altitude":"yd"}}')).toEqual(
      DEFAULT_SETTINGS
    );
  });

  it('returns a copy, so the defaults cannot be changed by accident', () => {
    const a = parseSettings(null);
    a.theme = 'night';
    a.units.altitude = 'm';
    expect(DEFAULT_SETTINGS.theme).toBe('day');
    expect(DEFAULT_SETTINGS.units.altitude).toBe('ft');
  });
});

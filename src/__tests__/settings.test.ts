import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../hooks/useSettings';

describe('parseSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a saved theme', () => {
    expect(parseSettings('{"theme":"night"}').theme).toBe('night');
    expect(parseSettings('{"theme":"day"}').theme).toBe('day');
  });

  it('falls back to the default theme for anything invalid', () => {
    expect(parseSettings('not json').theme).toBe('day');
    expect(parseSettings('{"theme":"purple"}').theme).toBe('day');
    expect(parseSettings('null').theme).toBe('day');
    expect(parseSettings('{"other":1}').theme).toBe('day');
  });

  it('returns a copy, so the defaults cannot be changed by accident', () => {
    const a = parseSettings(null);
    a.theme = 'night';
    expect(DEFAULT_SETTINGS.theme).toBe('day');
  });
});

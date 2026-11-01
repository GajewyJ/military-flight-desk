import { describe, it, expect } from 'vitest';
import { formatRunway } from '../utils/format';

describe('formatRunway', () => {
  it('adds the RWY prefix once', () => {
    expect(formatRunway('36')).toBe('RWY 36');
    expect(formatRunway('RWY 36')).toBe('RWY 36');
    expect(formatRunway('rwy 09L')).toBe('rwy 09L');
  });
});

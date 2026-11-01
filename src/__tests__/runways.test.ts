import { describe, it, expect } from 'vitest';
import { runwaysFromRaw, isRunwayEstimated, getRunwayCandidates } from '../utils/weatherService';
import type { Airport } from '../types/flightDesk';

const base: Airport = {
  ident: 'TEST', icao: 'TEST', name: 'Test Field', elevationFt: 100,
  magDecl: '0.0° East', latitude: 50, longitude: 10,
};

describe('runwaysFromRaw', () => {
  it('skips helipads and junk designators', () => {
    const out = runwaysFromRaw(
      [{ le: 'H1', he: '' }, { le: 'ALL', he: 'ALL' }, { le: '-', he: '' }, { le: 'PAD', he: '' }],
      0
    );
    expect(out.length).toBe(0);
  });

  it('gives compass designators their real heading (E is 090, W is 270), not 360/180', () => {
    const out = runwaysFromRaw([{ le: 'E', he: 'W' }], 0);
    expect(out.map((r) => r.name)).toEqual(['RWY E', 'RWY W']);
    expect(Math.round(out[0].magHeadingDeg)).toBe(90);
    expect(Math.round(out[1].magHeadingDeg)).toBe(270);
  });

  it('uses the designator for numeric ends without a surveyed heading', () => {
    const out = runwaysFromRaw([{ le: '09L', he: '27R' }], 0);
    expect(Math.round(out[0].magHeadingDeg)).toBe(90);
    expect(Math.round(out[1].magHeadingDeg)).toBe(270);
  });

  it('uses the surveyed true heading and derives the other end as +180', () => {
    const out = runwaysFromRaw([{ le: '05', he: '23', leHdg: 47 }], 0);
    expect(Math.round(out[0].trueHeadingDeg)).toBe(47);
    expect(Math.round(out[1].trueHeadingDeg)).toBe(227);
  });

  it('rejects out-of-range numbers', () => {
    expect(runwaysFromRaw([{ le: '45', he: '00' }], 0).length).toBe(0);
  });
});

describe('isRunwayEstimated', () => {
  it('is true when there is no runway data at all', () => {
    expect(isRunwayEstimated(base)).toBe(true);
  });

  it('is false when the airfield has a curated runway designator', () => {
    const apt = { ...base, runwayDesignator: '11/29' };
    expect(isRunwayEstimated(apt)).toBe(false);
    expect(getRunwayCandidates(apt).map((r) => r.name)).toEqual(['RWY 11', 'RWY 29']);
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateDistanceNm,
  calculateBearingDeg,
  destinationPoint,
  parseMagDecl,
  trueToMag,
  magToTrue,
} from '../utils/geo';

describe('geo', () => {
  it('computes great-circle distance (London to Paris is about 190 NM)', () => {
    const d = calculateDistanceNm(51.4775, -0.4614, 49.0097, 2.5479);
    expect(d).toBeGreaterThan(180);
    expect(d).toBeLessThan(200);
  });

  it('computes bearing due east along the equator', () => {
    expect(Math.round(calculateBearingDeg(0, 0, 0, 10))).toBe(90);
  });

  it('destinationPoint round-trips with distance and bearing', () => {
    const p = destinationPoint(52, 19, 50, 45);
    expect(calculateDistanceNm(52, 19, p.lat, p.lon)).toBeCloseTo(50, 0);
  });

  it('parses declination strings', () => {
    expect(parseMagDecl('5.2° East')).toBeCloseTo(5.2);
    expect(parseMagDecl('3.9° West')).toBeCloseTo(-3.9);
    expect(parseMagDecl(undefined)).toBe(0);
  });

  it('converts true/magnetic with east declination (mag = true - E)', () => {
    expect(trueToMag(100, 5)).toBeCloseTo(95);
    expect(magToTrue(95, 5)).toBeCloseTo(100);
    expect(trueToMag(2, 5)).toBeCloseTo(357);
  });
});

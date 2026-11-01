import { describe, it, expect } from 'vitest';
import {
  generationError,
  invalidIcaoError,
  sameAirfieldError,
  unknownAirportError,
} from '../utils/errorMessages';

describe('error messages', () => {
  it('names the unknown airfield and says what to do', () => {
    const e = unknownAirportError('ZZZZ', true);
    expect(e.title).toBe('Airfield not found');
    expect(e.message).toContain('ZZZZ');
    expect((e.hints ?? []).length).toBeGreaterThan(0);
  });

  it('tells the user to wait while the database is still loading', () => {
    const e = unknownAirportError('EPLK', false);
    expect(e.title).toBe('Airport database is loading');
    expect(e.message).not.toContain('not found');
  });

  it('names which airfield needs a code', () => {
    expect(invalidIcaoError('departure').message).toContain('departure airfield');
    expect(invalidIcaoError('touchAndGo').message).toContain('Touch & Go airfield');
    expect(invalidIcaoError('destination').message).toContain('destination airfield');
  });

  it('explains the same-airfield mistake', () => {
    expect(sameAirfieldError('touchAndGo').message).toContain('different from the departure airfield');
  });

  it('turns TNG_ROUTE_INVALID into a route message with the airfield and hints', () => {
    const e = generationError(new Error('TNG_ROUTE_INVALID'), ' epkz ');
    expect(e.title).toBe('No valid route found');
    expect(e.message).toContain('EPKZ');
    expect(e.detail).toBe(undefined);
    expect((e.hints ?? []).length).toBeGreaterThan(1);
  });

  it('keeps the technical detail of unexpected errors', () => {
    const e = generationError(new Error('boom'), 'EPKS');
    expect(e.title).toBe('Plan generation failed');
    expect(e.detail).toBe('boom');
    expect(generationError('not an Error', 'EPKS').detail).toBe(undefined);
  });
});

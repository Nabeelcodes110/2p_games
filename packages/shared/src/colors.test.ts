import { describe, expect, it } from 'vitest';
import { colorDistance, decideRound, normalizeHexColor, type ColorsPick } from './colors.js';

const pick = (distance: number, elapsedMs: number): ColorsPick => ({ color: '#000000', distance, elapsedMs });

describe('color helpers', () => {
  it('normalizes only 6-digit hex colors', () => {
    expect(normalizeHexColor(' #a1b2c3 ')).toBe('#A1B2C3');
    for (const bad of ['a1b2c3', '#abc', '#12345g', '', 42, null, '#1234567']) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it('measures perceptual distance', () => {
    expect(colorDistance('#336699', '#336699')).toBe(0);
    expect(colorDistance('#000000', '#FFFFFF')).toBeCloseTo(100, 0);
    expect(colorDistance('#336699', '#346699')).toBeLessThan(colorDistance('#336699', '#33FF99'));
    expect(colorDistance('#FF0000', '#00FF00')).toBe(colorDistance('#00FF00', '#FF0000'));
  });
});

describe('decideRound', () => {
  const ids = ['a', 'b'];
  it('closest color wins', () => {
    expect(decideRound({ a: pick(5, 9000), b: pick(2, 12000) }, ids)).toEqual({ winnerId: 'b', reason: 'closest' });
  });
  it('equal distance: faster wins', () => {
    expect(decideRound({ a: pick(3, 9000), b: pick(3, 4000) }, ids)).toEqual({ winnerId: 'b', reason: 'faster' });
  });
  it('equal distance and time: nobody scores', () => {
    expect(decideRound({ a: pick(3, 4000), b: pick(3, 4000) }, ids)).toEqual({ winnerId: null, reason: 'tie' });
  });
  it('lone answer wins; no answers is no point', () => {
    expect(decideRound({ a: null, b: pick(40, 100) }, ids)).toEqual({ winnerId: 'b', reason: 'forfeit' });
    expect(decideRound({ a: null, b: null }, ids)).toEqual({ winnerId: null, reason: 'noAnswer' });
  });
});

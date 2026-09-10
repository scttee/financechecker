import { describe, expect, it } from 'vitest';
import { compositeWellbeingScore, type WellbeingRatings } from '@/lib/domain/wellbeing';

function ratings(value: number): WellbeingRatings {
  return {
    control: value,
    security: value,
    freedom: value,
    confidence: value,
    shockAbsorption: value,
    enjoyment: value,
  };
}

describe('how money feels', () => {
  it('is 100 when every dimension is a perfect 10', () => {
    expect(compositeWellbeingScore(ratings(10))).toBe(100);
  });

  it('is 10 when every dimension is the lowest rating, 1', () => {
    expect(compositeWellbeingScore(ratings(1))).toBe(10);
  });

  it('is the equal-weighted mean, not skewed toward any one dimension', () => {
    const mixed: WellbeingRatings = {
      control: 8,
      security: 6,
      freedom: 4,
      confidence: 7,
      shockAbsorption: 5,
      enjoyment: 6,
    };
    // (8+6+4+7+5+6)/6 = 6 exactly -> 60
    expect(compositeWellbeingScore(mixed)).toBe(60);
  });

  it('clamps ratings outside 1-10 rather than letting a bad input skew the score', () => {
    const outOfRange: WellbeingRatings = {
      control: 15,
      security: -3,
      freedom: 5,
      confidence: 5,
      shockAbsorption: 5,
      enjoyment: 5,
    };
    const result = compositeWellbeingScore(outOfRange);
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(100);
  });
});

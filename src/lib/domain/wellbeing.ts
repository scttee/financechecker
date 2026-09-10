/**
 * How money feels.
 *
 * Six 1-10 self-ratings, averaged into a single 0-100 figure so it can sit
 * next to the objective Financial Health score for comparison — but it is a
 * composite of a feeling, not a formula, and the two scores are never
 * averaged together into one number. Deliberately the simplest possible
 * aggregation: an equal-weighted mean. There is no "correct" weighting for
 * how much control matters relative to enjoyment.
 */

export interface WellbeingRatings {
  control: number;
  security: number;
  freedom: number;
  confidence: number;
  shockAbsorption: number;
  enjoyment: number;
}

export const WELLBEING_DIMENSIONS: ReadonlyArray<{ key: keyof WellbeingRatings; label: string }> = [
  { key: 'control', label: 'Control' },
  { key: 'security', label: 'Security' },
  { key: 'freedom', label: 'Freedom' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'shockAbsorption', label: 'Ability to absorb shocks' },
  { key: 'enjoyment', label: 'Ability to enjoy money' },
];

/** 0-100, comparable in scale to the Financial Health score, not in meaning. */
export function compositeWellbeingScore(ratings: WellbeingRatings): number {
  const values = WELLBEING_DIMENSIONS.map((d) => clamp(ratings[d.key]));
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(average * 10);
}

function clamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

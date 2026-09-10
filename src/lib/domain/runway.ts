/**
 * Runway.
 *
 * How long a balance covers a monthly cost, and what one more month costs.
 * Pure division — which costs count and which balance funds it are judgment
 * calls that live in the service calling this, not here. Three runways
 * (survival, normal-life, career-break) are the same function called three
 * times with different inputs, not three different formulas.
 */

import type { Cents } from '@/lib/money';

export interface RunwayResult {
  /** Null when there is not enough spending history for a monthly cost yet. */
  months: number | null;
  monthlyCostCents: Cents;
  fundingBalanceCents: Cents;
}

export function calculateRunway(input: {
  fundingBalanceCents: Cents;
  monthlyCostCents: Cents;
}): RunwayResult {
  const { fundingBalanceCents, monthlyCostCents } = input;

  if (monthlyCostCents <= 0) {
    return { months: null, monthlyCostCents, fundingBalanceCents };
  }

  const months = Math.max(0, fundingBalanceCents) / monthlyCostCents;
  return {
    months: Math.round(months * 10) / 10,
    monthlyCostCents,
    fundingBalanceCents,
  };
}

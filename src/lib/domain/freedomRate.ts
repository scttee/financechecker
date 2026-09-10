/**
 * Freedom rate.
 *
 * Share of net income directed toward future choice — Emergency while below
 * target, Future Options, and long-term investing — rather than everyday
 * life. A behavioural read of where a pay actually went, not the plan's own
 * percentages (which describe intent; this describes what happened).
 */

import type { Cents } from '@/lib/money';

export interface FreedomRateResult {
  /** Percentage, one decimal place. 0 when there was no income to measure against. */
  pct: number;
  futureChoiceCents: Cents;
  netIncomeCents: Cents;
}

export function calculateFreedomRate(input: {
  futureChoiceCents: Cents;
  netIncomeCents: Cents;
}): FreedomRateResult {
  const { futureChoiceCents, netIncomeCents } = input;

  if (netIncomeCents <= 0) {
    return { pct: 0, futureChoiceCents, netIncomeCents };
  }

  const pct = Math.round((futureChoiceCents / netIncomeCents) * 1000) / 10;
  return { pct, futureChoiceCents, netIncomeCents };
}

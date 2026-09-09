/**
 * Goal projection.
 *
 * "When will this be funded at the current rate" — the forward-looking
 * question Today and Goals don't answer, because everything else in this app
 * is deliberately about where things stand right now, not where they're
 * headed. Built from the same plan the rest of the app already trusts: the
 * current phase's allocation percentage for a role, applied to the typical
 * pay, is what "the current rate" means here — not a rolling average of
 * noisy history.
 *
 * A projection is a straight line through today's numbers, not a forecast.
 * It says so.
 */

import type { Cents } from '@/lib/money';

export interface GoalProjection {
  remainingCents: Cents;
  /** What the plan currently sends this role each pay cycle. */
  perCycleCents: Cents;
  /**
   * Cycles until the target is met at this rate. Null when the target is
   * already met, or when the current phase sends nothing here — Phase 2
   * sends 0% to Emergency, for instance, so "cycles remaining" would be
   * infinite rather than a real answer.
   */
  cyclesRemaining: number | null;
  projectedDate: Date | null;
}

export function projectGoal(input: {
  currentCents: Cents;
  targetCents: Cents;
  perCycleCents: Cents;
  now: Date;
  /** Length of one pay cycle, in days. */
  cycleLengthDays: number;
}): GoalProjection {
  const { currentCents, targetCents, perCycleCents, now, cycleLengthDays } = input;
  const remainingCents = Math.max(0, targetCents - currentCents);

  if (remainingCents === 0) {
    return { remainingCents: 0, perCycleCents, cyclesRemaining: 0, projectedDate: now };
  }

  if (perCycleCents <= 0) {
    return { remainingCents, perCycleCents, cyclesRemaining: null, projectedDate: null };
  }

  const cyclesRemaining = Math.ceil(remainingCents / perCycleCents);
  const projectedDate = new Date(now.getTime() + cyclesRemaining * cycleLengthDays * 86_400_000);
  return { remainingCents, perCycleCents, cyclesRemaining, projectedDate };
}

/**
 * Financial health.
 *
 * Five existing signals — pace, spending room, Emergency coverage,
 * attentiveness to leakage, and how current the pay cycle is — rolled into
 * one number, the way a health app rolls sleep, movement and heart signals
 * into a single score instead of asking you to read five graphs.
 *
 * This computes no new fact. Every input already exists and is already shown
 * elsewhere in full; this is a weighted read of numbers this app already
 * trusts, not a second opinion. The weights are a judgment call, documented
 * rather than hidden, and every factor is returned so the score can be
 * opened up rather than taken on faith.
 *
 * Same tone rules as everywhere else: nothing here is a failing grade.
 */

import type { Cents } from '@/lib/money';
import type { CategoryLine } from './status';
import type { SafeToSpendResult } from './safeToSpend';

export type HealthTier = 'THRIVING' | 'STEADY' | 'TIGHTENING' | 'NEEDS_A_LOOK';

export const HEALTH_TIER_LABEL: Record<HealthTier, string> = {
  THRIVING: 'Thriving',
  STEADY: 'Steady',
  TIGHTENING: 'Tightening',
  NEEDS_A_LOOK: 'Needs a look',
};

export interface HealthFactor {
  key: 'PACE' | 'HEADROOM' | 'EMERGENCY' | 'ATTENTIVENESS' | 'CURRENCY';
  label: string;
  /** 0-100. */
  score: number;
  /** Share of the total score this factor contributes, e.g. 0.35. */
  weight: number;
  detail: string;
}

export interface FinancialHealth {
  status: 'READY';
  /** 0-100, weighted. */
  score: number;
  tier: HealthTier;
  tierLabel: string;
  /**
   * Answers "should I be spending right now" directly, from the same
   * safe-to-spend figure shown elsewhere — never a rival number.
   */
  spendingGuidance: string;
  factors: HealthFactor[];
}

export interface InsufficientHealth {
  status: 'INSUFFICIENT_DATA';
  headline: string;
  detail: string;
}

const WEIGHTS = {
  PACE: 0.35,
  HEADROOM: 0.3,
  EMERGENCY: 0.2,
  ATTENTIVENESS: 0.1,
  CURRENCY: 0.05,
} as const;

export function computeFinancialHealth(input: {
  categories: readonly CategoryLine[];
  safeToSpend: SafeToSpendResult;
  emergencyProgressPct: number;
  unreviewedLeakageCount: number;
  cycleOverdue: boolean;
}): FinancialHealth {
  const { categories, safeToSpend, emergencyProgressPct, unreviewedLeakageCount, cycleOverdue } = input;

  const factors: HealthFactor[] = [
    paceFactor(categories),
    headroomFactor(safeToSpend),
    emergencyFactor(emergencyProgressPct),
    attentivenessFactor(unreviewedLeakageCount),
    currencyFactor(cycleOverdue),
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0));
  const tier = tierFor(score);

  return {
    status: 'READY',
    score,
    tier,
    tierLabel: HEALTH_TIER_LABEL[tier],
    spendingGuidance: spendingGuidanceFor(safeToSpend),
    factors,
  };
}

function tierFor(score: number): HealthTier {
  if (score >= 85) return 'THRIVING';
  if (score >= 65) return 'STEADY';
  if (score >= 45) return 'TIGHTENING';
  return 'NEEDS_A_LOOK';
}

/**
 * How many tracked, actionable categories (not protected, not reserved) are
 * on track versus running hot, near their limit, or spent.
 */
function paceFactor(categories: readonly CategoryLine[]): HealthFactor {
  const tracked = categories.filter((c) => c.status !== 'PROTECTED' && c.status !== 'RESERVED');

  if (tracked.length === 0) {
    return {
      key: 'PACE',
      label: 'Pace',
      score: 70,
      weight: WEIGHTS.PACE,
      detail: 'Nothing tracked against the clock yet this cycle.',
    };
  }

  const onTrack = tracked.filter((c) => c.status === 'ON_TRACK').length;
  const score = Math.round((onTrack / tracked.length) * 100);

  return {
    key: 'PACE',
    label: 'Pace',
    score,
    weight: WEIGHTS.PACE,
    detail: `${onTrack} of ${tracked.length} tracked categories moving with the clock, not ahead of it.`,
  };
}

/**
 * Room to spend without touching anything protected. Deliberately reuses
 * safe-to-spend's own signals — flooredAtZero and cappedByBalance — rather
 * than inventing a dollar threshold for "healthy".
 */
function headroomFactor(safeToSpend: SafeToSpendResult): HealthFactor {
  if (safeToSpend.flooredAtZero) {
    return {
      key: 'HEADROOM',
      label: 'Spending room',
      score: 0,
      weight: WEIGHTS.HEADROOM,
      detail: 'The plan would have gone negative before payday, so it is floored at zero.',
    };
  }

  if (safeToSpend.safeToSpendCents === 0) {
    return {
      key: 'HEADROOM',
      label: 'Spending room',
      score: 25,
      weight: WEIGHTS.HEADROOM,
      detail: 'Nothing discretionary spare until payday. The essentials are still funded.',
    };
  }

  if (safeToSpend.cappedByBalance) {
    return {
      key: 'HEADROOM',
      label: 'Spending room',
      score: 60,
      weight: WEIGHTS.HEADROOM,
      detail: 'The plan allows more than the account actually holds right now.',
    };
  }

  return {
    key: 'HEADROOM',
    label: 'Spending room',
    score: 100,
    weight: WEIGHTS.HEADROOM,
    detail: 'The full discretionary allowance is available and unconstrained.',
  };
}

function emergencyFactor(progressPct: number): HealthFactor {
  const score = Math.max(0, Math.min(100, Math.round(progressPct)));
  return {
    key: 'EMERGENCY',
    label: 'Emergency fund',
    score,
    weight: WEIGHTS.EMERGENCY,
    detail: `${score}% of the Emergency target funded.`,
  };
}

function attentivenessFactor(unreviewedCount: number): HealthFactor {
  const score = unreviewedCount === 0 ? 100 : unreviewedCount === 1 ? 60 : 30;
  return {
    key: 'ATTENTIVENESS',
    label: 'Attentiveness',
    score,
    weight: WEIGHTS.ATTENTIVENESS,
    detail:
      unreviewedCount === 0
        ? 'Nothing waiting for a leakage verdict.'
        : `${unreviewedCount} leakage ${unreviewedCount === 1 ? 'finding' : 'findings'} waiting for a look.`,
  };
}

function currencyFactor(overdue: boolean): HealthFactor {
  return {
    key: 'CURRENCY',
    label: 'Pay cycle',
    score: overdue ? 40 : 100,
    weight: WEIGHTS.CURRENCY,
    detail: overdue
      ? 'Payday is running late, so the figures behind this score are stretching past the cycle they were built for.'
      : 'The current pay cycle is up to date.',
  };
}

function spendingGuidanceFor(safeToSpend: SafeToSpendResult): string {
  if (safeToSpend.safeToSpendCents === 0) {
    return 'Hold off on discretionary spending until payday — the everyday buckets are already fully committed.';
  }
  return `${formatShort(safeToSpend.safeToSpendCents)} of discretionary room, about ${formatShort(
    safeToSpend.perDayCents,
  )} a day until payday. Spending inside that is exactly what it is there for.`;
}

function formatShort(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

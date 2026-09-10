/**
 * Financial health, v2.
 *
 * Six dimensions — Cashflow, Resilience, Wealth Building, Optionality,
 * Protection, Admin — each made of named, additive sub-factors, the way the
 * spec for this version asked for it: "Resilience 18/20 — Emergency target
 * funded +8, Survival runway above 3 months +6, No high-interest debt +4."
 * Every number here is deterministic. Claude is never in this file, and
 * never sees a task more specific than "explain this after the fact."
 *
 * v1 was four factors on a single flat list (Pace, Spending room, Emergency,
 * Future Options), each a smooth 0-100 percentage. This version keeps that
 * for the naturally continuous things (pace, runway, funding percentages)
 * but adds two dimensions v1 had no way to represent: Wealth Building
 * (nothing previously reflected whether investing was actually happening)
 * and Protection/Admin (binary, checklist-shaped facts that don't belong on
 * a smooth scale at all — forcing "insurance recorded or not" into a
 * percentage is exactly the kind of thing that read as arbitrary before).
 * `scoreVersion` on every stored snapshot is 2 from here on; nothing older
 * exists yet to migrate.
 *
 * This computes no new fact that isn't already visible elsewhere in the
 * app. Every dimension is a weighted, itemised read of numbers the rest of
 * the app already trusts — never a second opinion, never invented.
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

export type HealthDimensionKey =
  | 'CASHFLOW'
  | 'RESILIENCE'
  | 'WEALTH_BUILDING'
  | 'OPTIONALITY'
  | 'PROTECTION'
  | 'ADMIN';

export interface HealthSubFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface HealthDimension {
  key: HealthDimensionKey;
  label: string;
  points: number;
  maxPoints: number;
  subFactors: HealthSubFactor[];
}

export interface FinancialHealth {
  status: 'READY';
  scoreVersion: 2;
  /** 0-100, the sum of every dimension's points. */
  score: number;
  tier: HealthTier;
  tierLabel: string;
  /**
   * Answers "should I be spending right now" directly, from the same
   * safe-to-spend figure shown elsewhere — never a rival number.
   */
  spendingGuidance: string;
  dimensions: HealthDimension[];
}

export interface InsufficientHealth {
  status: 'INSUFFICIENT_DATA';
  headline: string;
  detail: string;
}

export type ProtectionKind = 'DEATH' | 'TPD' | 'INCOME_PROTECTION' | 'HEALTH' | 'BENEFICIARY';

const PROTECTION_LABEL: Record<ProtectionKind, string> = {
  DEATH: 'Death cover',
  TPD: 'TPD cover',
  INCOME_PROTECTION: 'Income protection',
  HEALTH: 'Private health',
  BENEFICIARY: 'Super beneficiary',
};

const DIMENSION_LABEL: Record<HealthDimensionKey, string> = {
  CASHFLOW: 'Cashflow',
  RESILIENCE: 'Resilience',
  WEALTH_BUILDING: 'Wealth building',
  OPTIONALITY: 'Optionality',
  PROTECTION: 'Protection',
  ADMIN: 'Admin',
};

export function computeFinancialHealth(input: {
  categories: readonly CategoryLine[];
  safeToSpend: SafeToSpendResult;
  emergencyProgressPct: number;
  futureOptionsProgressPct: number;
  /** Null when there isn't enough spending history for a runway yet. */
  survivalRunwayMonths: number | null;
  /** Positive amount owed, 0 if no debt is tracked. */
  debtCents: Cents;
  investedThisCycleCents: Cents;
  plannedInvestingCents: Cents;
  /** How many of the last 3 pay cycles had a non-zero investing contribution, 0-3. */
  recentCyclesWithContribution: number;
  freedomRatePct: number;
  freedomRateTargetPct: number;
  protectionItems: ReadonlyArray<{
    kind: ProtectionKind;
    recorded: boolean;
    reviewedRecently: boolean;
  }>;
  adminUpToDateCount: number;
  adminTotalCount: number;
}): FinancialHealth {
  const dimensions: HealthDimension[] = [
    cashflowDimension(input.categories, input.safeToSpend),
    resilienceDimension(input.emergencyProgressPct, input.survivalRunwayMonths, input.debtCents),
    wealthBuildingDimension(
      input.investedThisCycleCents,
      input.plannedInvestingCents,
      input.recentCyclesWithContribution,
    ),
    optionalityDimension(input.futureOptionsProgressPct, input.freedomRatePct, input.freedomRateTargetPct),
    protectionDimension(input.protectionItems),
    adminDimension(input.adminUpToDateCount, input.adminTotalCount),
  ];

  const score = Math.round(dimensions.reduce((sum, d) => sum + d.points, 0));
  const tier = tierFor(score);

  return {
    status: 'READY',
    scoreVersion: 2,
    score,
    tier,
    tierLabel: HEALTH_TIER_LABEL[tier],
    spendingGuidance: spendingGuidanceFor(input.safeToSpend),
    dimensions,
  };
}

function tierFor(score: number): HealthTier {
  if (score >= 85) return 'THRIVING';
  if (score >= 65) return 'STEADY';
  if (score >= 45) return 'TIGHTENING';
  return 'NEEDS_A_LOOK';
}

function dimension(
  key: HealthDimensionKey,
  maxPoints: number,
  subFactors: HealthSubFactor[],
): HealthDimension {
  const points = Math.round(subFactors.reduce((sum, f) => sum + f.points, 0) * 10) / 10;
  return { key, label: DIMENSION_LABEL[key], points, maxPoints, subFactors };
}

// ---------------------------------------------------------------------------
// Cashflow — 20 points. Day-to-day control: is spending on pace, is there
// room. The two factors v1 called Pace and Spending room, unchanged.
// ---------------------------------------------------------------------------

function cashflowDimension(
  categories: readonly CategoryLine[],
  safeToSpend: SafeToSpendResult,
): HealthDimension {
  const tracked = categories.filter((c) => c.status !== 'PROTECTED' && c.status !== 'RESERVED');
  const onTrack = tracked.filter((c) => c.status === 'ON_TRACK').length;
  const paceRatio = tracked.length === 0 ? 0.7 : onTrack / tracked.length;

  const pace: HealthSubFactor = {
    key: 'PACE',
    label: 'Pace',
    points: Math.round(paceRatio * 12 * 10) / 10,
    maxPoints: 12,
    detail:
      tracked.length === 0
        ? 'Nothing tracked against the clock yet this cycle.'
        : `${onTrack} of ${tracked.length} tracked categories moving with the clock, not ahead of it.`,
  };

  let roomPoints: number;
  let roomDetail: string;
  if (safeToSpend.flooredAtZero) {
    roomPoints = 0;
    roomDetail = 'The plan would have gone negative before payday, so it is floored at zero.';
  } else if (safeToSpend.safeToSpendCents === 0) {
    roomPoints = 2;
    roomDetail = 'Nothing discretionary spare until payday. The essentials are still funded.';
  } else if (safeToSpend.cappedByBalance) {
    roomPoints = 5;
    roomDetail = 'The plan allows more than the account actually holds right now.';
  } else {
    roomPoints = 8;
    roomDetail = 'The full discretionary allowance is available and unconstrained.';
  }

  const room: HealthSubFactor = {
    key: 'SPENDING_ROOM',
    label: 'Spending room',
    points: roomPoints,
    maxPoints: 8,
    detail: roomDetail,
  };

  return dimension('CASHFLOW', 20, [pace, room]);
}

// ---------------------------------------------------------------------------
// Resilience — 20 points. Emergency coverage, whether that coverage would
// actually last a real gap in income, and whether debt is quietly eating
// into it.
// ---------------------------------------------------------------------------

function resilienceDimension(
  emergencyProgressPct: number,
  survivalRunwayMonths: number | null,
  debtCents: Cents,
): HealthDimension {
  const emergencyPts = Math.max(0, Math.min(100, Math.round(emergencyProgressPct))) / 100;
  const emergency: HealthSubFactor = {
    key: 'EMERGENCY_FUNDED',
    label: 'Emergency target funded',
    points: Math.round(emergencyPts * 10 * 10) / 10,
    maxPoints: 10,
    detail: `${Math.max(0, Math.min(100, Math.round(emergencyProgressPct)))}% of the Emergency target funded.`,
  };

  let runwayPoints: number;
  let runwayDetail: string;
  if (survivalRunwayMonths === null) {
    runwayPoints = 3; // neutral — not enough spending history to say either way
    runwayDetail = 'Not enough spending history yet to estimate a survival runway.';
  } else {
    runwayPoints = Math.min(6, Math.round((survivalRunwayMonths / 3) * 6 * 10) / 10);
    runwayDetail = `${survivalRunwayMonths} months of essential costs covered by Emergency${
      survivalRunwayMonths >= 3 ? ', at or above the 3-month reference point.' : '.'
    }`;
  }
  const runway: HealthSubFactor = {
    key: 'SURVIVAL_RUNWAY',
    label: 'Survival runway above 3 months',
    points: runwayPoints,
    maxPoints: 6,
    detail: runwayDetail,
  };

  const debt: HealthSubFactor = {
    key: 'NO_DEBT',
    label: 'No tracked debt',
    points: debtCents <= 0 ? 4 : 0,
    maxPoints: 4,
    detail:
      debtCents <= 0
        ? 'No debt currently recorded on the balance sheet.'
        : 'Debt is currently recorded on the balance sheet.',
  };

  return dimension('RESILIENCE', 20, [emergency, runway, debt]);
}

// ---------------------------------------------------------------------------
// Wealth building — 20 points. Nothing in v1 reflected whether long-term
// investing was actually happening. This is the gap that filled.
// ---------------------------------------------------------------------------

function wealthBuildingDimension(
  investedThisCycleCents: Cents,
  plannedInvestingCents: Cents,
  recentCyclesWithContribution: number,
): HealthDimension {
  const ratio = plannedInvestingCents > 0 ? Math.min(1, investedThisCycleCents / plannedInvestingCents) : 0;
  const thisCycle: HealthSubFactor = {
    key: 'INVESTING_THIS_CYCLE',
    label: 'Investing this cycle',
    points: Math.round(ratio * 12 * 10) / 10,
    maxPoints: 12,
    detail:
      plannedInvestingCents > 0
        ? `${Math.round(ratio * 100)}% of this cycle's planned investing contribution has gone through.`
        : 'The current phase does not plan an investing contribution this cycle.',
  };

  const consistencyRatio = Math.max(0, Math.min(3, recentCyclesWithContribution)) / 3;
  const consistency: HealthSubFactor = {
    key: 'INVESTING_CONSISTENCY',
    label: 'Contributed in each of the last 3 cycles',
    points: Math.round(consistencyRatio * 8 * 10) / 10,
    maxPoints: 8,
    detail: `Investing contributions landed in ${Math.max(0, Math.min(3, recentCyclesWithContribution))} of the last 3 pay cycles.`,
  };

  return dimension('WEALTH_BUILDING', 20, [thisCycle, consistency]);
}

// ---------------------------------------------------------------------------
// Optionality — 15 points. Future Options funding, and the behavioural
// Freedom Rate — how much of take-home pay actually went toward future
// choice this quarter, not just what the plan says it should.
// ---------------------------------------------------------------------------

function optionalityDimension(
  futureOptionsProgressPct: number,
  freedomRatePct: number,
  freedomRateTargetPct: number,
): HealthDimension {
  const fo = Math.max(0, Math.min(100, Math.round(futureOptionsProgressPct)));
  const futureOptions: HealthSubFactor = {
    key: 'FUTURE_OPTIONS_FUNDED',
    label: 'Future Options funded',
    points: Math.round((fo / 100) * 10 * 10) / 10,
    maxPoints: 10,
    detail: `${fo}% of the Future Options target funded.`,
  };

  const freedomRatio =
    freedomRateTargetPct > 0 ? Math.max(0, Math.min(1, freedomRatePct / freedomRateTargetPct)) : 0;
  const freedom: HealthSubFactor = {
    key: 'FREEDOM_RATE',
    label: 'Freedom rate',
    points: Math.round(freedomRatio * 5 * 10) / 10,
    maxPoints: 5,
    detail: `${freedomRatePct}% of take-home income this period went toward future choice, against a ${freedomRateTargetPct}% reference point.`,
  };

  return dimension('OPTIONALITY', 15, [futureOptions, freedom]);
}

// ---------------------------------------------------------------------------
// Protection — 15 points. Five things tracked by hand, 3 points each:
// recorded at all (2), plus reviewed within the last year (1 more). No
// adequacy judgement — a cover amount is never scored as "enough" or "not
// enough" unless an explicit threshold is configured, and none is yet.
// ---------------------------------------------------------------------------

function protectionDimension(
  items: ReadonlyArray<{ kind: ProtectionKind; recorded: boolean; reviewedRecently: boolean }>,
): HealthDimension {
  const byKind = new Map(items.map((i) => [i.kind, i]));
  const kinds: ProtectionKind[] = ['DEATH', 'TPD', 'INCOME_PROTECTION', 'HEALTH', 'BENEFICIARY'];

  const subFactors = kinds.map((kind) => {
    const item = byKind.get(kind);
    const points = !item || !item.recorded ? 0 : item.reviewedRecently ? 3 : 2;
    const detail = !item || !item.recorded
      ? 'Not recorded yet.'
      : item.reviewedRecently
        ? 'Recorded and reviewed within the last year.'
        : 'Recorded, but not reviewed in the last year.';

    return {
      key: kind,
      label: PROTECTION_LABEL[kind],
      points,
      maxPoints: 3,
      detail,
    };
  });

  return dimension('PROTECTION', 15, subFactors);
}

// ---------------------------------------------------------------------------
// Admin — 10 points. Deliberately one line, not a task list: how many of
// the tracked admin items are currently up to date.
// ---------------------------------------------------------------------------

function adminDimension(upToDateCount: number, totalCount: number): HealthDimension {
  const ratio = totalCount > 0 ? Math.max(0, Math.min(1, upToDateCount / totalCount)) : 0;
  const subFactor: HealthSubFactor = {
    key: 'ADMIN_UP_TO_DATE',
    label: 'Admin items up to date',
    points: Math.round(ratio * 10 * 10) / 10,
    maxPoints: 10,
    detail:
      totalCount > 0
        ? `${upToDateCount} of ${totalCount} tracked admin items are up to date.`
        : 'Nothing tracked yet.',
  };

  return dimension('ADMIN', 10, [subFactor]);
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

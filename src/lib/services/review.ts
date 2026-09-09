/**
 * Reviews.
 *
 * Three windows: a week, a month, six months. The weekly one has a hard
 * constraint — it must be readable in about thirty seconds — which means a
 * handful of figures and exactly one thing to notice, not a report.
 */

import 'server-only';

import type { AccountRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { formatCents, type Cents } from '@/lib/money';
import { roleLabel } from '@/lib/domain/roles';
import { categoryStatus, type CategoryLine } from '@/lib/domain/status';
import { elapsedPercent } from '@/lib/time';
import { getBalancesByRole, getSettings, thresholdsFrom } from './settings';
import { leakageInPeriod } from './leakageService';
import { spendByRole } from './overview';

export type ReviewPeriod = 'WEEK' | 'MONTH' | 'SIX_MONTHS';

export const PERIOD_LABEL: Record<ReviewPeriod, string> = {
  WEEK: 'This week',
  MONTH: 'This month',
  SIX_MONTHS: 'Last six months',
};

export interface ReviewSummary {
  period: ReviewPeriod;
  from: Date;
  to: Date;
  spentCents: Cents;
  savedCents: Cents;
  investedCents: Cents;
  incomeCents: Cents;
  categories: CategoryLine[];
  travelInCents: Cents;
  gearRemainingCents: Cents;
  emergencyBalanceCents: Cents;
  emergencyTargetCents: Cents;
  futureOptionsBalanceCents: Cents;
  leakage: { cents: Cents; count: number };
  /** The single line worth reading. */
  oneThing: { headline: string; detail: string } | null;
}

function periodStart(period: ReviewPeriod, now: Date): Date {
  switch (period) {
    case 'WEEK':
      return new Date(now.getTime() - 7 * 86_400_000);
    case 'MONTH':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'SIX_MONTHS':
      return new Date(now.getTime() - 182 * 86_400_000);
  }
}

export async function getReview(
  period: ReviewPeriod,
  now: Date = new Date(),
): Promise<ReviewSummary> {
  const settings = await getSettings();
  const from = periodStart(period, now);

  const [spentByRoleMap, balances, income, invested, saved, leakage] = await Promise.all([
    spendByRole(from, now),
    getBalancesByRole(),
    incomeIn(from, now),
    investedIn(from, now),
    savedIn(from, now),
    leakageInPeriod(from, now),
  ]);

  // Allocations for the cycles overlapping the window, so a weekly review is
  // measured against a fortnight's budget rather than nothing.
  const allocations = await allocationsOverlapping(from, now);
  const thresholds = thresholdsFrom(settings);
  const elapsed = elapsedPercent({ start: from, end: now }, now);

  const roles = new Set<AccountRole>([...allocations.keys(), ...spentByRoleMap.keys()]);
  const categories = [...roles].map((role) =>
    categoryStatus({
      role,
      allocatedCents: scaleAllocation(allocations.get(role) ?? 0, period),
      spentCents: spentByRoleMap.get(role) ?? 0,
      // A review window is not a pay cycle, so the pace comparison uses how far
      // through the window we are.
      elapsedPct: period === 'WEEK' ? 100 : elapsed,
      thresholds,
    }),
  );

  const spentCents = [...spentByRoleMap.values()].reduce((a, b) => a + b, 0);

  return {
    period,
    from,
    to: now,
    spentCents,
    savedCents: saved,
    investedCents: invested,
    incomeCents: income,
    categories: categories.sort((a, b) => b.spentCents - a.spentCents),
    travelInCents: await transfersInto('TRAVEL', from, now),
    gearRemainingCents: balances.get('GEAR_OBJECTS') ?? 0,
    emergencyBalanceCents: balances.get('EMERGENCY') ?? 0,
    emergencyTargetCents: settings.emergencyTargetCents,
    futureOptionsBalanceCents: balances.get('FUTURE_OPTIONS') ?? 0,
    leakage,
    oneThing: await pickOneThing(from, now, categories, leakage),
  };
}

/**
 * A weekly window sits inside a fortnightly allocation, so the allocation is
 * halved to make the comparison mean something. Six months is left alone —
 * over that horizon the cycle-by-cycle detail is not the interesting part.
 */
function scaleAllocation(cents: Cents, period: ReviewPeriod): Cents {
  if (period === 'WEEK') return Math.round(cents / 2);
  return cents;
}

async function allocationsOverlapping(from: Date, to: Date): Promise<Map<AccountRole, number>> {
  const cycles = await prisma.payCycle.findMany({
    where: { startAt: { lt: to }, endAt: { gt: from } },
    include: { allocations: true },
  });

  const totals = new Map<AccountRole, number>();
  for (const cycle of cycles) {
    for (const allocation of cycle.allocations) {
      totals.set(
        allocation.role,
        (totals.get(allocation.role) ?? 0) + allocation.allocatedCents,
      );
    }
  }
  return totals;
}

async function incomeIn(from: Date, to: Date): Promise<Cents> {
  const result = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: from, lt: to },
      isSalary: true,
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });
  return result._sum.amountCents ?? 0;
}

async function investedIn(from: Date, to: Date): Promise<Cents> {
  const result = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: from, lt: to },
      role: 'INVESTING',
      amountCents: { lt: 0 },
      isInternalTransfer: false,
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });
  return Math.abs(result._sum.amountCents ?? 0);
}

/**
 * Money that moved into Savers whose job is to hold it: Emergency, Future
 * Options, Travel and Gear. Deliberately not "income minus spending", which
 * would count money sitting briefly in the spending account as saved.
 */
async function savedIn(from: Date, to: Date): Promise<Cents> {
  const roles: AccountRole[] = ['EMERGENCY', 'FUTURE_OPTIONS', 'TRAVEL', 'GEAR_OBJECTS'];
  let total = 0;
  for (const role of roles) {
    total += await transfersInto(role, from, to);
  }
  return total;
}

async function transfersInto(role: AccountRole, from: Date, to: Date): Promise<Cents> {
  const mappings = await prisma.accountRoleMapping.findMany({ where: { role } });
  if (mappings.length === 0) return 0;

  const result = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: from, lt: to },
      accountId: { in: mappings.map((m) => m.accountId) },
      isInternalTransfer: true,
      amountCents: { gt: 0 },
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });
  return result._sum.amountCents ?? 0;
}

/**
 * The one thing worth saying.
 *
 * Ordered by how much it would change a decision, and phrased so that a
 * perfectly ordinary week reads as perfectly ordinary. "No action needed yet"
 * is a complete and acceptable finding.
 */
async function pickOneThing(
  from: Date,
  to: Date,
  categories: readonly CategoryLine[],
  leakage: { cents: Cents; count: number },
): Promise<{ headline: string; detail: string } | null> {
  if (leakage.count > 0) {
    return {
      headline: `${formatCents(leakage.cents)} moved out of purpose-built Savers and was spent shortly after.`,
      detail:
        'Correlation in timing and amount, not proof. Mark each one on this screen and the figure will start meaning something over time.',
    };
  }

  // Repeated small spending in one place is the classic quiet drain, and the
  // useful version of it says the number without saying it was a mistake.
  const clusters = await prisma.transaction.groupBy({
    by: ['description'],
    where: {
      createdAt: { gte: from, lt: to },
      amountCents: { lt: 0 },
      isInternalTransfer: false,
      deletedAt: null,
      role: { in: ['DINING_SOCIAL', 'FUN'] },
    },
    _sum: { amountCents: true },
    _count: { _all: true },
    having: { description: { _count: { gte: 3 } } },
    orderBy: { _sum: { amountCents: 'asc' } },
    take: 1,
  });

  const cluster = clusters[0];
  if (cluster) {
    const total = Math.abs(cluster._sum.amountCents ?? 0);
    return {
      headline: `${cluster._count._all} purchases at ${cluster.description} came to ${formatCents(total)}.`,
      detail: 'Worth seeing rather than worth changing. No action needed yet.',
    };
  }

  const hot = categories
    .filter((c) => c.status === 'RUNNING_HOT' && !c.isProtected)
    .sort((a, b) => b.spentPct - b.elapsedPct - (a.spentPct - a.elapsedPct))[0];

  if (hot) {
    return {
      headline: `${hot.label} is moving faster than the rest.`,
      detail: hot.explanation,
    };
  }

  const spent = categories.filter((c) => c.status === 'SPENT' && !c.isEssential && !c.isProtected)[0];
  if (spent) {
    return {
      headline: `${spent.label} is fully spent.`,
      detail: `Nothing left in it until the next pay lands. ${roleLabel(spent.role)} does not borrow from anywhere else.`,
    };
  }

  return {
    headline: 'Nothing stands out.',
    detail: 'Spending is tracking the plan. That is what an ordinary week looks like.',
  };
}

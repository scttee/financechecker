/**
 * The overview service.
 *
 * Assembles what the Today, Pay Cycle and Goals screens need. Everything here
 * reads from the database and calls the pure domain functions. No calculation
 * logic lives in a React component.
 */

import 'server-only';

import type { AccountRole, Phase } from '@prisma/client';
import { prisma } from '@/lib/db';
import { calculateSafeToSpend, type SafeToSpendResult, type UpcomingCommitment } from '@/lib/domain/safeToSpend';
import { categoryStatus, type CategoryLine } from '@/lib/domain/status';
import { computeFinancialHealth, type FinancialHealth, type InsufficientHealth } from '@/lib/domain/health';
import { calculatePaydayAllocation } from '@/lib/domain/allocation';
import { budgetedRoles, roleDefinition } from '@/lib/domain/roles';
import { cycleProgress, spendingDaysRemaining, type CycleProgress, type DerivedPayCycle } from '@/lib/domain/payCycle';
import { expectedBefore } from '@/lib/domain/recurring';
import { getAllocationPercents, getBalancesByRole, getLiquidBalance, getSettings, thresholdsFrom } from './settings';
import { leakageInPeriod } from './leakageService';
import { buildInsight, type Insight } from './insight';
import { getBalanceSheet } from './balanceSheet';
import { getFreedomRate } from './freedomRate';
import { getRunway } from './runway';
import { getProtectionInputs } from './protection';
import { getAdminInputs } from './admin';

// ---------------------------------------------------------------------------
// Cycle view
// ---------------------------------------------------------------------------

export interface CycleView {
  id: string;
  startAt: Date;
  endAt: Date;
  endIsProjected: boolean;
  incomeCents: number;
  rentCents: number;
  allocatableCents: number;
  phase: Phase;
  progress: CycleProgress;
  categories: CategoryLine[];
  /** Spend by role for the cycle, including roles with no allocation. */
  spentByRole: Map<AccountRole, number>;
  investedCents: number;
  totalSpentCents: number;
}

export async function getCurrentCycleView(now: Date = new Date()): Promise<CycleView | null> {
  const cycle = await prisma.payCycle.findFirst({
    where: { startAt: { lte: now } },
    orderBy: { startAt: 'desc' },
    include: { allocations: true },
  });
  if (!cycle) return null;
  return buildCycleView(cycle.id, now);
}

export async function buildCycleView(cycleId: string, now: Date = new Date()): Promise<CycleView | null> {
  const settings = await getSettings();
  const cycle = await prisma.payCycle.findUnique({
    where: { id: cycleId },
    include: { allocations: true },
  });
  if (!cycle) return null;

  const spentByRole = await spendByRole(cycle.startAt, cycle.endAt);

  const derived: DerivedPayCycle = {
    startAt: cycle.startAt,
    endAt: cycle.endAt,
    endIsProjected: cycle.endIsProjected,
    incomeCents: cycle.incomeCents,
    salaryTransactionIds: cycle.salaryTransactionId ? [cycle.salaryTransactionId] : [],
    salaryTransactionId: cycle.salaryTransactionId,
  };
  const progress = cycleProgress(derived, now, settings.timezone);

  const allocationByRole = new Map(cycle.allocations.map((a) => [a.role, a.allocatedCents]));
  const thresholds = thresholdsFrom(settings);

  const categories: CategoryLine[] = budgetedRoles()
    .filter((role) => allocationByRole.has(role) || (spentByRole.get(role) ?? 0) > 0)
    .map((role) =>
      categoryStatus({
        role,
        allocatedCents: allocationByRole.get(role) ?? 0,
        spentCents: spentByRole.get(role) ?? 0,
        elapsedPct: progress.elapsedPct,
        thresholds,
      }),
    );

  const totalSpentCents = [...spentByRole.values()].reduce((a, b) => a + b, 0);

  return {
    id: cycle.id,
    startAt: cycle.startAt,
    endAt: cycle.endAt,
    endIsProjected: cycle.endIsProjected,
    incomeCents: cycle.incomeCents,
    rentCents: cycle.rentCents,
    allocatableCents: cycle.allocatableCents,
    phase: cycle.phase,
    progress,
    categories,
    spentByRole,
    investedCents: spentByRole.get('INVESTING') ?? 0,
    totalSpentCents,
  };
}

/**
 * Spending per bucket across a window.
 *
 * Internal transfers are excluded. Moving money between my own Savers is not
 * expenditure, and counting it would make every payday look like a spending
 * spree.
 */
export async function spendByRole(from: Date, to: Date): Promise<Map<AccountRole, number>> {
  const rows = await prisma.transaction.groupBy({
    by: ['role'],
    where: {
      createdAt: { gte: from, lt: to },
      deletedAt: null,
      isInternalTransfer: false,
      amountCents: { lt: 0 },
      role: { not: null },
    },
    _sum: { amountCents: true },
  });

  const map = new Map<AccountRole, number>();
  for (const row of rows) {
    if (!row.role) continue;
    map.set(row.role, Math.abs(row._sum.amountCents ?? 0));
  }
  return map;
}

export async function listPayCycles(limit = 14) {
  return prisma.payCycle.findMany({
    orderBy: { startAt: 'desc' },
    take: limit,
    include: { allocations: true },
  });
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export interface GoalView {
  key: string;
  name: string;
  role: AccountRole;
  balanceCents: number;
  targetCents: number;
  progressPct: number;
  reachedAt: Date | null;
  isHardFloor: boolean;
}

export interface TodayView {
  cycle: CycleView | null;
  goals: GoalView[];
  travelBalanceCents: number;
  gearBalanceCents: number;
  emergencyBalanceCents: number;
  futureOptionsBalanceCents: number;
  investedThisCycleCents: number;
  safeToSpend: SafeToSpendResult | null;
  insight: Insight;
  health: FinancialHealth | InsufficientHealth;
  leakageThisMonth: { cents: number; count: number };
  openReviewCount: number;
  phase: Phase;
  timezone: string;
  lastSyncAt: Date | null;
}

export async function getTodayView(now: Date = new Date()): Promise<TodayView> {
  const settings = await getSettings();
  const [cycle, balances, goalRows, liquid, openReviewCount, lastSync] = await Promise.all([
    getCurrentCycleView(now),
    getBalancesByRole(),
    prisma.financialGoal.findMany({ orderBy: { sortOrder: 'asc' } }),
    getLiquidBalance(),
    prisma.reviewItem.count({ where: { dismissedAt: null } }),
    prisma.syncRun.findFirst({
      where: { status: { in: ['SUCCEEDED', 'PARTIAL'] } },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  const goals: GoalView[] = goalRows.map((g) => {
    const balanceCents = balances.get(g.role) ?? 0;
    return {
      key: g.key,
      name: g.name,
      role: g.role,
      balanceCents,
      targetCents: g.targetCents,
      progressPct:
        g.targetCents > 0 ? Math.min(100, Math.round((balanceCents / g.targetCents) * 100)) : 0,
      reachedAt: g.reachedAt,
      isHardFloor: g.isHardFloor,
    };
  });

  let safeToSpend: SafeToSpendResult | null = null;
  if (cycle) {
    const commitments = await upcomingCommitments(now, cycle.endAt);
    const days = spendingDaysRemaining(
      {
        startAt: cycle.startAt,
        endAt: cycle.endAt,
        endIsProjected: cycle.endIsProjected,
        incomeCents: cycle.incomeCents,
        salaryTransactionIds: [],
        salaryTransactionId: null,
      },
      now,
      settings.timezone,
    );

    safeToSpend = calculateSafeToSpend({
      categories: cycle.categories,
      upcomingCommitments: commitments,
      liquidBalanceCents: liquid,
      daysRemaining: days,
      discretionaryRoles: await discretionaryRoles(),
    });
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const leakageThisMonth = await leakageInPeriod(monthStart, now);

  const insight = await buildInsight({ cycle, safeToSpend, goals, leakageThisMonth, now });

  let health: FinancialHealth | InsufficientHealth = {
    status: 'INSUFFICIENT_DATA',
    headline: 'Not enough to score yet',
    detail: cycle
      ? 'Once a pay cycle is fully worked out, a score starts appearing here.'
      : 'Once a salary payment is found, a score starts appearing here.',
  };

  if (cycle && safeToSpend) {
    const [runway, balanceSheet, allocationPercents, recentInvesting, freedomRate, protectionItems, admin] =
      await Promise.all([
        getRunway(now),
        getBalanceSheet(),
        getAllocationPercents(cycle.phase),
        recentCyclesWithInvesting(cycle.id, 3),
        getFreedomRate(now),
        getProtectionInputs(now),
        getAdminInputs(now),
      ]);

    health = computeFinancialHealth({
      categories: cycle.categories,
      safeToSpend,
      emergencyProgressPct: goals.find((g) => g.key === 'emergency')?.progressPct ?? 0,
      futureOptionsProgressPct: goals.find((g) => g.key === 'future_options')?.progressPct ?? 0,
      survivalRunwayMonths: runway.survival.months,
      debtCents: balanceSheet.debtCents,
      investedThisCycleCents: cycle.investedCents,
      plannedInvestingCents: plannedInvestingCents(cycle, allocationPercents),
      recentCyclesWithContribution: recentInvesting,
      freedomRatePct: freedomRate.cycle.pct,
      freedomRateTargetPct: settings.freedomRateTargetPct,
      protectionItems,
      adminUpToDateCount: admin.upToDateCount,
      adminTotalCount: admin.totalCount,
    });
  }

  return {
    cycle,
    goals,
    travelBalanceCents: balances.get('TRAVEL') ?? 0,
    gearBalanceCents: balances.get('GEAR_OBJECTS') ?? 0,
    emergencyBalanceCents: balances.get('EMERGENCY') ?? 0,
    futureOptionsBalanceCents: balances.get('FUTURE_OPTIONS') ?? 0,
    investedThisCycleCents: cycle?.investedCents ?? 0,
    safeToSpend,
    insight,
    health,
    leakageThisMonth,
    openReviewCount,
    phase: settings.phase,
    timezone: settings.timezone,
    lastSyncAt: lastSync?.startedAt ?? null,
  };
}

/**
 * What the plan itself says should go to Investing this cycle, using the
 * cycle's own captured income and rent rather than the settings default —
 * a bonus pay changes what "planned" means for that cycle.
 */
function plannedInvestingCents(
  cycle: CycleView,
  percentages: ReadonlyArray<{ role: AccountRole; basisPoints: number }>,
): number {
  const allocation = calculatePaydayAllocation({
    incomeCents: cycle.incomeCents,
    rentCents: cycle.rentCents,
    phase: cycle.phase,
    percentages,
  });
  return allocation.rows.find((r) => r.role === 'INVESTING')?.allocatedCents ?? 0;
}

/**
 * How many of the pay cycles immediately before this one had a real
 * investing contribution — a consistency signal, not just "did it happen
 * this cycle".
 */
export async function recentCyclesWithInvesting(currentCycleId: string, take: number): Promise<number> {
  const current = await prisma.payCycle.findUnique({ where: { id: currentCycleId } });
  if (!current) return 0;

  const previous = await prisma.payCycle.findMany({
    where: { startAt: { lt: current.startAt } },
    orderBy: { startAt: 'desc' },
    take,
  });

  let count = 0;
  for (const cyc of previous) {
    const invested = await prisma.transaction.aggregate({
      where: {
        createdAt: { gte: cyc.startAt, lt: cyc.endAt },
        role: 'INVESTING',
        amountCents: { lt: 0 },
        isInternalTransfer: false,
        deletedAt: null,
      },
      _sum: { amountCents: true },
    });
    if ((invested._sum.amountCents ?? 0) < 0) count += 1;
  }
  return count;
}

/**
 * Which buckets count as everyday spending money.
 *
 * Reads the per-account override from Settings when one exists, and falls back
 * to the role's default. This is what lets me decide that, say, Fun should not
 * count without editing code.
 */
export async function discretionaryRoles(): Promise<AccountRole[]> {
  const mappings = await prisma.accountRoleMapping.findMany();
  if (mappings.length === 0) {
    return budgetedRoles().filter((r) => roleDefinition(r).discretionary);
  }

  const roles = new Set<AccountRole>();
  for (const mapping of mappings) {
    if (mapping.isDiscretionary) roles.add(mapping.role);
  }
  // If nothing has been marked either way, fall back to the defaults rather
  // than reporting that there is no money to spend at all.
  if (roles.size === 0) {
    return budgetedRoles().filter((r) => roleDefinition(r).discretionary);
  }
  return [...roles];
}

/** Recurring charges expected between now and payday. */
export async function upcomingCommitments(from: Date, to: Date): Promise<UpcomingCommitment[]> {
  const rows = await prisma.recurringMerchant.findMany({
    where: { status: { notIn: ['CANCELLED', 'NOT_RECURRING'] } },
  });

  const due = expectedBefore(rows, to, from);

  // Map each merchant back to the bucket its charges land in.
  const merchantRoles = new Map<string, AccountRole>();
  for (const row of due) {
    const sample = await prisma.transaction.findFirst({
      where: { description: row.displayName, role: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { role: true },
    });
    if (sample?.role) merchantRoles.set(row.merchantKey, sample.role);
  }

  return due.map((row) => ({
    id: row.id,
    label: row.displayName,
    amountCents: row.typicalAmountCents,
    dueAt: row.nextExpectedAt ?? to,
    role: merchantRoles.get(row.merchantKey) ?? 'BILLS',
  }));
}

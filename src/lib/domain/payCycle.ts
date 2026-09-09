/**
 * Pay cycles.
 *
 * This app thinks in fortnights, not calendar months. A pay cycle runs from
 * the moment a salary lands until the moment the next one does. Boundaries are
 * derived from observed salary transactions, never from a fixed day of the
 * month, because paydays move around public holidays.
 *
 * All functions here are pure. They take transactions and settings and return
 * cycles. Persistence happens in the service layer.
 */

import type { AccountRole, MatchType, Phase, SalaryCadence } from '@prisma/client';
import { addDaysUtc, calendarDaysBetween, DEFAULT_TIMEZONE, elapsedPercent, daysRemaining, zonedStartOfDay } from '@/lib/time';
import type { DateRange } from '@/lib/time';
import type { Cents } from '@/lib/money';

// ---------------------------------------------------------------------------
// Salary detection
// ---------------------------------------------------------------------------

export interface SalaryRuleInput {
  id: string;
  label: string;
  pattern: string;
  matchType: MatchType;
  minCents: number | null;
  priority: number;
  enabled: boolean;
}

export interface TransactionLike {
  id: string;
  description: string;
  rawText?: string | null;
  message?: string | null;
  amountCents: Cents;
  createdAt: Date;
  accountId: string;
  isInternalTransfer?: boolean;
  deletedAt?: Date | null;
}

export interface SalaryMatch {
  transactionId: string;
  ruleId: string;
  ruleLabel: string;
  amountCents: Cents;
  at: Date;
}

function textMatches(haystack: string, pattern: string, matchType: MatchType): boolean {
  const h = haystack.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (p === '') return false;

  switch (matchType) {
    case 'EXACT':
      return h.trim() === p;
    case 'CONTAINS':
      return h.includes(p);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(haystack);
      } catch {
        // A rule with a broken regex should never take the app down. It just
        // never matches, and Settings shows it as invalid.
        return false;
      }
  }
}

/**
 * Does this transaction look like salary?
 *
 * A salary must be a credit (positive), must not be an internal transfer
 * between my own accounts, must clear the minimum amount, and must match an
 * enabled rule on its description, raw text or message.
 */
export function matchSalary(
  tx: TransactionLike,
  rules: readonly SalaryRuleInput[],
  globalMinCents: number,
): SalaryMatch | null {
  if (tx.deletedAt) return null;
  if (tx.amountCents <= 0) return null;
  if (tx.isInternalTransfer) return null;

  const haystacks = [tx.description, tx.rawText ?? '', tx.message ?? ''];
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  for (const rule of ordered) {
    const min = rule.minCents ?? globalMinCents;
    if (tx.amountCents < min) continue;
    if (haystacks.some((h) => textMatches(h, rule.pattern, rule.matchType))) {
      return {
        transactionId: tx.id,
        ruleId: rule.id,
        ruleLabel: rule.label,
        amountCents: tx.amountCents,
        at: tx.createdAt,
      };
    }
  }
  return null;
}

export function findSalaryTransactions(
  transactions: readonly TransactionLike[],
  rules: readonly SalaryRuleInput[],
  globalMinCents: number,
): SalaryMatch[] {
  return transactions
    .map((tx) => matchSalary(tx, rules, globalMinCents))
    .filter((m): m is SalaryMatch => m !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export function cadenceDays(cadence: SalaryCadence): number {
  switch (cadence) {
    case 'WEEKLY':
      return 7;
    case 'FORTNIGHTLY':
      return 14;
    case 'MONTHLY':
      return 30;
  }
}

// ---------------------------------------------------------------------------
// Cycle derivation
// ---------------------------------------------------------------------------

export interface DerivedPayCycle {
  startAt: Date;
  /** Exclusive. */
  endAt: Date;
  /** True while endAt is a projection rather than an observed next payday. */
  endIsProjected: boolean;
  incomeCents: Cents;
  salaryTransactionIds: string[];
  /** The primary salary transaction, used as the cycle's stable identity. */
  salaryTransactionId: string | null;
}

/**
 * Group salary matches into cycles.
 *
 * Two salary credits landing on the same local day are one payday with a split
 * deposit, not two cycles. Anything closer than half a cadence apart is
 * treated the same way, which absorbs an employer paying in two parts a day
 * apart without inventing a one-day pay cycle.
 */
export function derivePayCycles(
  salaries: readonly SalaryMatch[],
  options: {
    cadence: SalaryCadence;
    timeZone?: string;
    /** Instant used to project the end of the open cycle. */
    now?: Date;
  },
): DerivedPayCycle[] {
  const { cadence, timeZone = DEFAULT_TIMEZONE } = options;
  const days = cadenceDays(cadence);
  const mergeWindowDays = Math.max(1, Math.floor(days / 2));

  const sorted = [...salaries].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sorted.length === 0) return [];

  // Group nearby salary credits into a single payday.
  const groups: SalaryMatch[][] = [];
  for (const salary of sorted) {
    const currentGroup = groups[groups.length - 1];
    const anchor = currentGroup?.[0];
    if (
      currentGroup &&
      anchor &&
      calendarDaysBetween(anchor.at, salary.at, timeZone) < mergeWindowDays
    ) {
      currentGroup.push(salary);
    } else {
      groups.push([salary]);
    }
  }

  return groups.map((group, index) => {
    const anchor = group[0]!;
    const nextGroup = groups[index + 1];
    const incomeCents = group.reduce((acc, s) => acc + s.amountCents, 0);
    const projectedEnd = addDaysUtc(anchor.at, days);

    return {
      startAt: anchor.at,
      endAt: nextGroup ? nextGroup[0]!.at : projectedEnd,
      endIsProjected: !nextGroup,
      incomeCents,
      salaryTransactionIds: group.map((s) => s.transactionId),
      salaryTransactionId: anchor.transactionId,
    };
  });
}

/** The cycle containing `now`, or the most recent one if `now` is past the end. */
export function currentCycle(
  cycles: readonly DerivedPayCycle[],
  now: Date,
): DerivedPayCycle | null {
  if (cycles.length === 0) return null;
  const containing = cycles.find(
    (c) => c.startAt.getTime() <= now.getTime() && now.getTime() < c.endAt.getTime(),
  );
  if (containing) return containing;
  const past = cycles.filter((c) => c.startAt.getTime() <= now.getTime());
  return past.length > 0 ? past[past.length - 1]! : null;
}

// ---------------------------------------------------------------------------
// Cycle progress
// ---------------------------------------------------------------------------

export interface CycleProgress {
  range: DateRange;
  elapsedPct: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  nextPayday: Date;
  /** True when the next payday is a projection, not an observed transaction. */
  nextPaydayIsProjected: boolean;
  isOverdue: boolean;
}

/**
 * Where we are in the cycle.
 *
 * When the projected payday has passed without a salary arriving, we do not
 * pretend the cycle has ended. `isOverdue` is set, elapsed stays at 100, and
 * days remaining is 0. The dashboard says the pay has not landed yet rather
 * than silently starting a phantom cycle.
 */
export function cycleProgress(
  cycle: DerivedPayCycle,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): CycleProgress {
  const range: DateRange = { start: cycle.startAt, end: cycle.endAt };
  const daysTotal = Math.max(1, calendarDaysBetween(cycle.startAt, cycle.endAt, timeZone));
  const daysElapsedRaw = calendarDaysBetween(cycle.startAt, now, timeZone);
  const daysElapsed = Math.min(daysTotal, Math.max(0, daysElapsedRaw));

  return {
    range,
    elapsedPct: elapsedPercent(range, now),
    daysTotal,
    daysElapsed,
    daysRemaining: daysRemaining(range, now, timeZone),
    nextPayday: cycle.endAt,
    nextPaydayIsProjected: cycle.endIsProjected,
    isOverdue: cycle.endIsProjected && now.getTime() >= cycle.endAt.getTime(),
  };
}

/**
 * Days left to spread money over, counting today. Never zero, so the
 * per-day pace figure can never divide by zero.
 */
export function spendingDaysRemaining(
  cycle: DerivedPayCycle,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const endDay = zonedStartOfDay(cycle.endAt, timeZone);
  const today = zonedStartOfDay(now, timeZone);
  return Math.max(1, calendarDaysBetween(today, endDay, timeZone));
}

// ---------------------------------------------------------------------------
// Allocation for a cycle
// ---------------------------------------------------------------------------

export interface CycleAllocationInput {
  incomeCents: Cents;
  rentCents: Cents;
  phase: Phase;
  percentages: ReadonlyArray<{ role: AccountRole; basisPoints: number }>;
}

export interface CycleAllocationResult {
  incomeCents: Cents;
  rentCents: Cents;
  allocatableCents: Cents;
  phase: Phase;
  rows: Array<{ role: AccountRole; basisPoints: number; allocatedCents: Cents }>;
  /** Sum of rows. Equals allocatableCents exactly when percentages total 100%. */
  totalAllocatedCents: Cents;
}

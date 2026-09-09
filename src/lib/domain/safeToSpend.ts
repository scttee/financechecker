/**
 * Safe to spend.
 *
 * The number this app refuses to show is "bank balance". A balance is not an
 * answer to "what can I spend", because most of it is already promised to
 * rent, bills, Emergency and Future Options.
 *
 * What is calculated instead: what is left in the buckets that exist to be
 * spent, minus what is already owed before the next pay lands. Protected money
 * never appears. Travel never appears, because Travel is for travel.
 *
 * Every step is returned as a labelled line so the screen can show its
 * working. There is no score and nothing is hidden.
 */

import type { AccountRole } from '@prisma/client';
import { floorAtZero, type Cents } from '@/lib/money';
import { roleDefinition, roleLabel } from './roles';
import type { CategoryLine } from './status';

export interface UpcomingCommitment {
  id: string;
  label: string;
  amountCents: Cents;
  dueAt: Date;
  /** Which bucket is supposed to pay for it. */
  role: AccountRole;
}

export type BreakdownKind = 'START' | 'ADD' | 'SUBTRACT' | 'CAP' | 'FLOOR' | 'RESULT';

export interface BreakdownLine {
  kind: BreakdownKind;
  label: string;
  amountCents: Cents;
  /** The running total after this line. */
  runningCents: Cents;
  detail: string;
}

export interface SafeToSpendResult {
  safeToSpendCents: Cents;
  /** Days left to spread it over, counting today. Never zero. */
  daysRemaining: number;
  perDayCents: Cents;
  breakdown: BreakdownLine[];
  /** Buckets that fed the starting figure. */
  discretionaryRoles: AccountRole[];
  /** Roles deliberately left out, with the reason. Shown in "How was this calculated?". */
  exclusions: Array<{ role: AccountRole; reason: string }>;
  /** True when the liquid-balance cap is what determined the answer. */
  cappedByBalance: boolean;
  /** True when the result would have been negative and was floored at zero. */
  flooredAtZero: boolean;
}

export interface SafeToSpendInput {
  /** One line per budgeted role for the current cycle. */
  categories: readonly CategoryLine[];
  /** Known charges expected to land before the next payday. */
  upcomingCommitments?: readonly UpcomingCommitment[];
  /**
   * Total balance across accounts that are not protected. Acts as a ceiling:
   * the plan cannot authorise money that is not there.
   */
  liquidBalanceCents?: Cents;
  daysRemaining: number;
  /**
   * Roles to treat as discretionary. Defaults to the roles marked
   * discretionary in the role definitions, overridable from Settings.
   */
  discretionaryRoles?: readonly AccountRole[];
}

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const {
    categories,
    upcomingCommitments = [],
    liquidBalanceCents,
    daysRemaining,
  } = input;

  const discretionaryRoles =
    input.discretionaryRoles ??
    categories.filter((c) => roleDefinition(c.role).discretionary).map((c) => c.role);

  const discretionarySet = new Set(discretionaryRoles);
  const byRole = new Map(categories.map((c) => [c.role, c]));

  const breakdown: BreakdownLine[] = [];
  const exclusions: Array<{ role: AccountRole; reason: string }> = [];

  // --- 1. Start with what is left in the spendable buckets -----------------
  //
  // The remaining figure is signed on purpose. A bucket that has gone past its
  // allocation has spent money that came from somewhere real, so it reduces
  // the total rather than being quietly rounded up to zero.
  let running = 0;
  const contributing = categories.filter((c) => discretionarySet.has(c.role));

  for (const line of contributing) {
    running += line.remainingCents;
    breakdown.push({
      kind: breakdown.length === 0 ? 'START' : line.remainingCents >= 0 ? 'ADD' : 'SUBTRACT',
      label: line.label,
      amountCents: line.remainingCents,
      runningCents: running,
      detail:
        line.remainingCents >= 0
          ? `${fmt(line.remainingCents)} left of a ${fmt(line.allocatedCents)} allocation.`
          : `${fmt(Math.abs(line.remainingCents))} past its ${fmt(line.allocatedCents)} allocation, so it comes off the total.`,
    });
  }

  if (contributing.length === 0) {
    breakdown.push({
      kind: 'START',
      label: 'No discretionary buckets',
      amountCents: 0,
      runningCents: 0,
      detail:
        'No buckets are marked as discretionary yet. Map your Up accounts to roles in Settings.',
    });
  }

  // --- 2. Record what was deliberately left out ---------------------------
  for (const line of categories) {
    if (discretionarySet.has(line.role)) continue;
    const def = roleDefinition(line.role);
    if (def.protected) {
      exclusions.push({
        role: line.role,
        reason: `${line.label} is protected. It never counts as spendable.`,
      });
    } else if (line.role === 'TRAVEL') {
      exclusions.push({
        role: line.role,
        reason: 'Travel is for travel. It is not part of everyday spending money.',
      });
    } else if (def.reserved) {
      exclusions.push({
        role: line.role,
        reason: `${line.label} is already spoken for by known commitments.`,
      });
    } else if (def.essential) {
      exclusions.push({
        role: line.role,
        reason: `${line.label} is an essential. Its allocation stays with it.`,
      });
    }
  }

  // --- 3. Take off essential shortfalls -----------------------------------
  //
  // If groceries has already gone past its allocation, that money has to come
  // out of the discretionary pool, because it has to come from somewhere.
  let essentialShortfall = 0;
  const shortfallDetail: string[] = [];
  for (const line of categories) {
    if (discretionarySet.has(line.role)) continue;
    const def = roleDefinition(line.role);
    if (!def.essential && !def.reserved) continue;
    if (def.protected) continue;
    const over = line.spentCents - line.allocatedCents;
    if (over > 0) {
      essentialShortfall += over;
      shortfallDetail.push(`${line.label} ${fmt(over)}`);
    }
  }

  if (essentialShortfall > 0) {
    running -= essentialShortfall;
    breakdown.push({
      kind: 'SUBTRACT',
      label: 'Essential shortfalls',
      amountCents: -essentialShortfall,
      runningCents: running,
      detail: `${shortfallDetail.join(', ')} went past allocation. That money still has to come from somewhere, so it comes off here.`,
    });
  }

  // --- 4. Take off commitments landing before payday ----------------------
  //
  // Only the part a commitment's own bucket cannot cover. If Bills still holds
  // enough for the electricity bill, the electricity bill does not reduce
  // discretionary spending.
  const commitmentsByRole = new Map<AccountRole, UpcomingCommitment[]>();
  for (const c of upcomingCommitments) {
    const list = commitmentsByRole.get(c.role) ?? [];
    list.push(c);
    commitmentsByRole.set(c.role, list);
  }

  let unfundedCommitments = 0;
  const commitmentDetail: string[] = [];

  for (const [role, list] of commitmentsByRole) {
    const total = list.reduce((acc, c) => acc + c.amountCents, 0);
    const line = byRole.get(role);
    const bucketCover = line && !discretionarySet.has(role) ? floorAtZero(line.remainingCents) : 0;
    const unfunded = floorAtZero(total - bucketCover);
    if (unfunded > 0) {
      unfundedCommitments += unfunded;
      const names = list.map((c) => c.label).join(', ');
      commitmentDetail.push(
        bucketCover > 0
          ? `${roleLabel(role)}: ${names} totalling ${fmt(total)}, of which ${fmt(bucketCover)} is already covered`
          : `${roleLabel(role)}: ${names} totalling ${fmt(total)}`,
      );
    }
  }

  if (unfundedCommitments > 0) {
    running -= unfundedCommitments;
    breakdown.push({
      kind: 'SUBTRACT',
      label: 'Commitments before payday',
      amountCents: -unfundedCommitments,
      runningCents: running,
      detail: `${commitmentDetail.join('; ')}. Held back so these do not land on an empty account.`,
    });
  }

  // --- 5. Cap at money that actually exists -------------------------------
  let cappedByBalance = false;
  if (typeof liquidBalanceCents === 'number' && running > liquidBalanceCents) {
    breakdown.push({
      kind: 'CAP',
      label: 'Capped at available balance',
      amountCents: liquidBalanceCents - running,
      runningCents: liquidBalanceCents,
      detail: `The unprotected accounts hold ${fmt(liquidBalanceCents)} in total, which is less than the allocations suggest. The lower figure is the real one.`,
    });
    running = liquidBalanceCents;
    cappedByBalance = true;
  }

  // --- 6. Floor at zero ---------------------------------------------------
  let flooredAtZero = false;
  if (running < 0) {
    breakdown.push({
      kind: 'FLOOR',
      label: 'Floored at zero',
      amountCents: -running,
      runningCents: 0,
      detail:
        'The buckets that fund everyday spending are already committed for this cycle. There is no negative allowance, just nothing spare.',
    });
    running = 0;
    flooredAtZero = true;
  }

  const safeToSpendCents = floorAtZero(running);
  const days = Math.max(1, daysRemaining);
  const perDayCents = Math.floor(safeToSpendCents / days);

  breakdown.push({
    kind: 'RESULT',
    label: 'Safe to spend until payday',
    amountCents: safeToSpendCents,
    runningCents: safeToSpendCents,
    detail: `Spread over ${days} ${days === 1 ? 'day' : 'days'}, that is a pace of about ${fmt(perDayCents)} a day.`,
  });

  return {
    safeToSpendCents,
    daysRemaining: days,
    perDayCents,
    breakdown,
    discretionaryRoles: [...discretionarySet],
    exclusions,
    cappedByBalance,
    flooredAtZero,
  };
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

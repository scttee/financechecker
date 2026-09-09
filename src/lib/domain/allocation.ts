/**
 * Payday allocation.
 *
 * When a salary lands: take rent off the top, then split what is left across
 * the buckets according to the current phase's percentages.
 *
 * This app never moves money. Up's own Pay Splitting does that. What happens
 * here is arithmetic and an audit: this is what the system says should have
 * happened, this is what actually landed in each Saver, here is the difference.
 */

import type { AccountRole, Phase } from '@prisma/client';
import { BASIS_POINTS_TOTAL, allocateByBasisPoints, floorAtZero, type Cents } from '@/lib/money';
import { roleLabel } from './roles';

/** Sentinel key for the part of a pay no percentage claims. */
const UNALLOCATED = '__unallocated__';

export interface AllocationRow {
  role: AccountRole;
  basisPoints: number;
  allocatedCents: Cents;
  /**
   * True for money taken off the top before the percentages are applied.
   * Rent is the only one. It matters because an off-the-top row is fully
   * allocated by definition: spending it is the plan working, not a shortfall
   * that has to come out of everyday money.
   */
  isOffTheTop: boolean;
}

export interface PaydayAllocation {
  incomeCents: Cents;
  rentCents: Cents;
  allocatableCents: Cents;
  phase: Phase;
  rows: AllocationRow[];
  totalAllocatedCents: Cents;
  /** Money no percentage claims. Non-zero only when the phase is misconfigured. */
  unallocatedCents: Cents;
  /** Rent exceeding income, or percentages that do not add to 100%. */
  warnings: string[];
}

/**
 * Split a pay.
 *
 * Rent comes off first and in full. If rent somehow exceeds the pay, the
 * allocatable amount floors at zero and a warning is returned rather than
 * producing negative allocations that would poison every downstream figure.
 *
 * The split uses largest-remainder distribution, so the rows sum to exactly
 * the allocatable amount. No leftover cent, no cent invented.
 */
export function calculatePaydayAllocation(input: {
  incomeCents: Cents;
  rentCents: Cents;
  phase: Phase;
  percentages: ReadonlyArray<{ role: AccountRole; basisPoints: number }>;
}): PaydayAllocation {
  const { incomeCents, rentCents, phase, percentages } = input;
  const warnings: string[] = [];

  let allocatableCents = incomeCents - rentCents;
  if (allocatableCents < 0) {
    warnings.push(
      `Rent of ${rentCents / 100} is more than this pay of ${incomeCents / 100}. Nothing is left to allocate.`,
    );
    allocatableCents = 0;
  }
  allocatableCents = floorAtZero(allocatableCents);

  const active = percentages.filter((p) => p.basisPoints > 0);
  const totalBasisPoints = active.reduce((acc, p) => acc + p.basisPoints, 0);

  // When the percentages do not add to 100%, the honest thing is to allocate
  // what they actually say and show the gap. Quietly scaling them up to fill
  // the pay would hide the misconfiguration behind numbers that look right.
  const weights: Array<{ key: string; basisPoints: number }> = active.map((p) => ({
    key: p.role as string,
    basisPoints: p.basisPoints,
  }));

  if (totalBasisPoints < BASIS_POINTS_TOTAL) {
    weights.push({ key: UNALLOCATED, basisPoints: BASIS_POINTS_TOTAL - totalBasisPoints });
    warnings.push(
      `The percentages for this phase add to ${(totalBasisPoints / 100).toFixed(2)}%, not 100%. ${((BASIS_POINTS_TOTAL - totalBasisPoints) / 100).toFixed(2)}% of this pay is not claimed by any bucket. Fix the percentages in Settings.`,
    );
  } else if (totalBasisPoints > BASIS_POINTS_TOTAL) {
    warnings.push(
      `The percentages for this phase add to ${(totalBasisPoints / 100).toFixed(2)}%, which is more than the pay. The amounts below have been scaled down to fit. Fix the percentages in Settings.`,
    );
  }

  const distributed = allocateByBasisPoints(allocatableCents, weights);
  const byRole = new Map(distributed.map((d) => [d.key, d.cents]));

  const rows: AllocationRow[] = percentages.map((p) => ({
    role: p.role,
    basisPoints: p.basisPoints,
    allocatedCents: byRole.get(p.role as string) ?? 0,
    isOffTheTop: false,
  }));

  const totalAllocatedCents = rows.reduce((acc, r) => acc + r.allocatedCents, 0);

  // Rent is allocated in full, off the top, before any percentage applies.
  // Recording it as a row with a real allocation is what stops the rent
  // payment reading as a shortfall that everyday spending has to absorb.
  //
  // It is capped at the income: when rent is larger than the pay, the plan
  // cannot allocate money that did not arrive, and saying otherwise would put
  // a figure on screen that no account contains.
  if (rentCents > 0 && !rows.some((r) => r.role === 'RENT')) {
    rows.unshift({
      role: 'RENT',
      basisPoints: 0,
      allocatedCents: Math.min(rentCents, Math.max(0, incomeCents)),
      isOffTheTop: true,
    });
  }
  const unallocatedCents = byRole.get(UNALLOCATED) ?? 0;

  return {
    incomeCents,
    rentCents,
    allocatableCents,
    phase,
    rows,
    totalAllocatedCents,
    unallocatedCents,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Payday audit
// ---------------------------------------------------------------------------

export interface ObservedTransfer {
  role: AccountRole;
  /** Net cents that actually landed in this role's account around payday. */
  observedCents: Cents;
}

export type AuditStatus = 'MATCHED' | 'UNDER' | 'OVER' | 'MISSING' | 'NOT_TRACKED';

export interface AuditRow {
  role: AccountRole;
  label: string;
  basisPoints: number;
  isOffTheTop: boolean;
  expectedCents: Cents;
  observedCents: Cents;
  /** observed minus expected. Negative means less went in than the plan says. */
  differenceCents: Cents;
  status: AuditStatus;
  explanation: string;
}

export interface PaydayAudit {
  rows: AuditRow[];
  matchedCount: number;
  totalExpectedCents: Cents;
  totalObservedCents: Cents;
  /** Roles the app cannot verify because no Up account is mapped to them. */
  untrackedRoles: AccountRole[];
}

/**
 * Compare what the plan says should have moved against what actually moved.
 *
 * `toleranceCents` exists because Up's Pay Splitting works in whole dollars
 * and percentages of its own, so an exact cent match is not the realistic bar.
 * A few dollars either way is the system working, not a problem.
 */
export function auditPayday(input: {
  allocation: PaydayAllocation;
  observed: ReadonlyArray<ObservedTransfer>;
  /** Roles with a mapped Up account. Anything else cannot be verified. */
  trackedRoles: ReadonlySet<AccountRole>;
  toleranceCents?: Cents;
}): PaydayAudit {
  const { allocation, observed, trackedRoles, toleranceCents = 500 } = input;

  const observedByRole = new Map<AccountRole, Cents>();
  for (const o of observed) {
    observedByRole.set(o.role, (observedByRole.get(o.role) ?? 0) + o.observedCents);
  }

  const untrackedRoles: AccountRole[] = [];
  const rows: AuditRow[] = allocation.rows
    .filter((r) => r.basisPoints > 0 || r.isOffTheTop)
    .map((r) => {
      const label = roleLabel(r.role);
      const tracked = trackedRoles.has(r.role);
      const observedCents = observedByRole.get(r.role) ?? 0;
      const differenceCents = observedCents - r.allocatedCents;

      if (!tracked) {
        untrackedRoles.push(r.role);
        return {
          role: r.role,
          label,
          basisPoints: r.basisPoints,
          isOffTheTop: r.isOffTheTop,
          expectedCents: r.allocatedCents,
          observedCents: 0,
          differenceCents: 0,
          status: 'NOT_TRACKED' as const,
          explanation: `No Up account is mapped to ${label}, so this one cannot be checked. Map it in Settings.`,
        };
      }

      let status: AuditStatus;
      let explanation: string;

      if (observedCents === 0) {
        status = 'MISSING';
        explanation = `Nothing moved into ${label} this payday. The plan expected ${fmt(r.allocatedCents)}.`;
      } else if (Math.abs(differenceCents) <= toleranceCents) {
        status = 'MATCHED';
        explanation = `${fmt(observedCents)} went in against a plan of ${fmt(r.allocatedCents)}. That matches.`;
      } else if (differenceCents < 0) {
        status = 'UNDER';
        explanation = `${fmt(observedCents)} went in, ${fmt(Math.abs(differenceCents))} short of the plan.`;
      } else {
        status = 'OVER';
        explanation = `${fmt(observedCents)} went in, ${fmt(differenceCents)} more than the plan.`;
      }

      return {
        role: r.role,
        label,
        basisPoints: r.basisPoints,
        isOffTheTop: r.isOffTheTop,
        expectedCents: r.allocatedCents,
        observedCents,
        differenceCents,
        status,
        explanation,
      };
    });

  return {
    rows,
    matchedCount: rows.filter((r) => r.status === 'MATCHED').length,
    totalExpectedCents: rows.reduce((a, r) => a + r.expectedCents, 0),
    totalObservedCents: rows.reduce((a, r) => a + r.observedCents, 0),
    untrackedRoles,
  };
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The two phases of the plan.
 *
 * Phase 1 runs until Emergency reaches its target. It routes 20% of post-rent
 * income into Emergency, at the cost of Investing and Future Options.
 *
 * Phase 2 begins once Emergency is funded. Emergency drops to 0%, and that
 * 20% is redirected: Investing 8% -> 17%, Future Options 3% -> 12%, Travel
 * 10% -> 12%. Everything else is unchanged.
 *
 * The percentages below are DEFAULTS. They are written into the database on
 * first run and edited from Settings after that. Nothing here is read at
 * calculation time — the calculation always reads the database.
 */

import type { AccountRole, Phase } from '@prisma/client';
import { BASIS_POINTS_TOTAL, pctToBasisPoints } from '@/lib/money';

export interface PhasePercent {
  role: AccountRole;
  pct: number;
}

export const PHASE_1_DEFAULTS: readonly PhasePercent[] = [
  { role: 'BILLS', pct: 12 },
  { role: 'HEALTH_THERAPY', pct: 11 },
  { role: 'GROCERIES', pct: 11 },
  { role: 'DINING_SOCIAL', pct: 8 },
  { role: 'FUN', pct: 5 },
  { role: 'TRANSPORT', pct: 4 },
  { role: 'TRAVEL', pct: 10 },
  { role: 'GEAR_OBJECTS', pct: 5 },
  { role: 'EMERGENCY', pct: 20 },
  { role: 'INVESTING', pct: 8 },
  { role: 'FUTURE_OPTIONS', pct: 3 },
  { role: 'BUFFER', pct: 3 },
];

export const PHASE_2_DEFAULTS: readonly PhasePercent[] = [
  { role: 'BILLS', pct: 12 },
  { role: 'HEALTH_THERAPY', pct: 11 },
  { role: 'GROCERIES', pct: 11 },
  { role: 'DINING_SOCIAL', pct: 8 },
  { role: 'FUN', pct: 5 },
  { role: 'TRANSPORT', pct: 4 },
  { role: 'TRAVEL', pct: 12 },
  { role: 'GEAR_OBJECTS', pct: 5 },
  { role: 'EMERGENCY', pct: 0 },
  { role: 'INVESTING', pct: 17 },
  { role: 'FUTURE_OPTIONS', pct: 12 },
  { role: 'BUFFER', pct: 3 },
];

export function defaultsForPhase(phase: Phase): readonly PhasePercent[] {
  return phase === 'PHASE_1' ? PHASE_1_DEFAULTS : PHASE_2_DEFAULTS;
}

export function toBasisPointRows(
  percents: readonly PhasePercent[],
): Array<{ role: AccountRole; basisPoints: number }> {
  return percents.map((p) => ({ role: p.role, basisPoints: pctToBasisPoints(p.pct) }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface AllocationValidation {
  ok: boolean;
  totalBasisPoints: number;
  /** How far from 100%, in basis points. Negative means under. */
  deltaBasisPoints: number;
  message: string;
}

/**
 * A phase must add to exactly 100%. Because the percentages are stored as
 * integer basis points this is an exact check, not a float tolerance.
 */
export function validateAllocation(
  rows: ReadonlyArray<{ basisPoints: number }>,
): AllocationValidation {
  const total = rows.reduce((acc, r) => acc + r.basisPoints, 0);
  const delta = total - BASIS_POINTS_TOTAL;
  if (delta === 0) {
    return { ok: true, totalBasisPoints: total, deltaBasisPoints: 0, message: 'Adds to 100%.' };
  }
  const pct = Math.abs(delta) / 100;
  return {
    ok: false,
    totalBasisPoints: total,
    deltaBasisPoints: delta,
    message:
      delta > 0
        ? `Over by ${pct}%. The percentages must add to exactly 100%.`
        : `Under by ${pct}%. The percentages must add to exactly 100%.`,
  };
}

// ---------------------------------------------------------------------------
// Phase determination
// ---------------------------------------------------------------------------

export interface PhaseDecision {
  phase: Phase;
  /** True on the transition itself, so the caller can raise the milestone. */
  changed: boolean;
  reason: string;
}

/**
 * Which phase applies, given the Emergency balance.
 *
 * Once Emergency reaches the target the plan moves to Phase 2 and stays there.
 * The target is a hard floor, not a trigger that flips back and forth: if the
 * balance later dips below $12,000 we do not silently revert to Phase 1 and
 * quietly stop investing. We stay in Phase 2 and raise a review item instead,
 * because a dip below the floor is a thing to look at, not a thing to
 * accommodate.
 */
export function determinePhase(input: {
  emergencyBalanceCents: number;
  emergencyTargetCents: number;
  currentPhase: Phase;
  hasEverReachedTarget: boolean;
}): PhaseDecision {
  const { emergencyBalanceCents, emergencyTargetCents, currentPhase, hasEverReachedTarget } = input;

  if (currentPhase === 'PHASE_2' || hasEverReachedTarget) {
    return {
      phase: 'PHASE_2',
      changed: false,
      reason: 'Emergency has reached its target, so the plan stays in Phase 2.',
    };
  }

  if (emergencyBalanceCents >= emergencyTargetCents) {
    return {
      phase: 'PHASE_2',
      changed: true,
      reason: 'Emergency has reached its target. The plan moves to Phase 2.',
    };
  }

  return {
    phase: 'PHASE_1',
    changed: false,
    reason: 'Emergency is still building toward its target, so the plan stays in Phase 1.',
  };
}

/** The rows that changed between phases, for the milestone screen. */
export function phaseDiff(
  from: ReadonlyArray<{ role: AccountRole; basisPoints: number }>,
  to: ReadonlyArray<{ role: AccountRole; basisPoints: number }>,
): Array<{ role: AccountRole; fromBasisPoints: number; toBasisPoints: number }> {
  const fromMap = new Map(from.map((r) => [r.role, r.basisPoints]));
  const toMap = new Map(to.map((r) => [r.role, r.basisPoints]));
  const roles = new Set<AccountRole>([...fromMap.keys(), ...toMap.keys()]);

  const changes: Array<{ role: AccountRole; fromBasisPoints: number; toBasisPoints: number }> = [];
  for (const role of roles) {
    const a = fromMap.get(role) ?? 0;
    const b = toMap.get(role) ?? 0;
    if (a !== b) changes.push({ role, fromBasisPoints: a, toBasisPoints: b });
  }
  return changes.sort((x, y) => y.toBasisPoints - y.fromBasisPoints - (x.toBasisPoints - x.fromBasisPoints));
}

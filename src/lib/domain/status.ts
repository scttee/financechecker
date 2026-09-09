/**
 * Category status.
 *
 * The question a status answers is "is this bucket moving at the right pace
 * for how far through the fortnight we are?" — not "have you been good".
 *
 * Language is deliberately flat. Nothing here says overspent, blown, or over
 * budget. Groceries running ahead is information; it is not a failing.
 */

import type { AccountRole } from '@prisma/client';
import { percentOf, type Cents } from '@/lib/money';
import { isEssential, isReserved, roleDefinition } from './roles';

export type CategoryStatus = 'ON_TRACK' | 'RUNNING_HOT' | 'NEAR_LIMIT' | 'SPENT' | 'PROTECTED' | 'RESERVED';

export const STATUS_LABEL: Record<CategoryStatus, string> = {
  ON_TRACK: 'On track',
  RUNNING_HOT: 'Running hot',
  NEAR_LIMIT: 'Near limit',
  SPENT: 'Spent',
  PROTECTED: 'Protected',
  RESERVED: 'Reserved',
};

export interface StatusThresholds {
  /** spend% ahead of elapsed% by more than this reads as running hot. */
  runningHotDeltaPct: number;
  /** Remaining below this share of the allocation reads as near limit. */
  nearLimitRemainingPct: number;
  /** Extra tolerance given to essentials before they are called out. */
  essentialLeewayPct: number;
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  runningHotDeltaPct: 15,
  nearLimitRemainingPct: 15,
  essentialLeewayPct: 10,
};

export interface CategoryLine {
  role: AccountRole;
  label: string;
  allocatedCents: Cents;
  spentCents: Cents;
  /** Allocated minus spent. Can be negative — that is a real fact, not hidden. */
  remainingCents: Cents;
  spentPct: number;
  elapsedPct: number;
  status: CategoryStatus;
  /** Plain sentence explaining the status. Rendered behind "Why?". */
  explanation: string;
  isEssential: boolean;
  isProtected: boolean;
}

/**
 * Work out the status of one budget line.
 *
 * The order of checks matters. Protection and reservation are facts about what
 * a bucket is for and beat any pace calculation. After that it is: nothing
 * left, nearly nothing left, moving faster than the clock, or fine.
 */
export function categoryStatus(input: {
  role: AccountRole;
  allocatedCents: Cents;
  spentCents: Cents;
  elapsedPct: number;
  thresholds?: StatusThresholds;
}): CategoryLine {
  const { role, allocatedCents, spentCents, elapsedPct } = input;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const def = roleDefinition(role);
  const label = def.label;
  const remainingCents = allocatedCents - spentCents;
  const spentPct = percentOf(spentCents, allocatedCents);
  const essential = isEssential(role);

  const base = {
    role,
    label,
    allocatedCents,
    spentCents,
    remainingCents,
    spentPct,
    elapsedPct,
    isEssential: essential,
    isProtected: def.protected,
  };

  if (def.protected) {
    return {
      ...base,
      status: 'PROTECTED',
      explanation: `${label} is protected. It is not counted as money available to spend, and it is not meant to be drawn on.`,
    };
  }

  if (isReserved(role)) {
    return {
      ...base,
      status: 'RESERVED',
      explanation: `${label} is money already spoken for. It sits aside for known commitments rather than being available.`,
    };
  }

  if (allocatedCents <= 0) {
    return {
      ...base,
      status: spentCents > 0 ? 'SPENT' : 'ON_TRACK',
      explanation:
        spentCents > 0
          ? `${label} has no allocation this cycle, and ${fmt(spentCents)} has gone through it.`
          : `${label} has no allocation this cycle.`,
    };
  }

  if (remainingCents <= 0) {
    const over = Math.abs(remainingCents);
    return {
      ...base,
      status: 'SPENT',
      explanation:
        over === 0
          ? `${label} is exactly used up: ${fmt(spentCents)} of ${fmt(allocatedCents)}, with ${100 - elapsedPct}% of the cycle still to run.`
          : `${label} is used up. ${fmt(spentCents)} against ${fmt(allocatedCents)}, which is ${fmt(over)} beyond the allocation.`,
    };
  }

  const remainingPct = percentOf(remainingCents, allocatedCents);
  if (remainingPct < thresholds.nearLimitRemainingPct) {
    return {
      ...base,
      status: 'NEAR_LIMIT',
      explanation: `${fmt(remainingCents)} left in ${label}, which is ${remainingPct}% of the allocation, with ${100 - elapsedPct}% of the cycle to go.`,
    };
  }

  // Essentials get extra headroom. Groceries running 20 points ahead in week
  // one is a big shop, not a problem, and saying otherwise trains me to ignore
  // the app.
  const leeway = essential ? thresholds.essentialLeewayPct : 0;
  const delta = spentPct - elapsedPct;

  if (delta > thresholds.runningHotDeltaPct + leeway) {
    return {
      ...base,
      status: 'RUNNING_HOT',
      explanation: `${label} is ${delta} points ahead of the clock: ${spentPct}% of the allocation used, ${elapsedPct}% of the cycle elapsed.${
        essential ? ' It is an essential, so this is worth noticing rather than acting on.' : ''
      }`,
    };
  }

  return {
    ...base,
    status: 'ON_TRACK',
    explanation: `${spentPct}% of ${label} used against ${elapsedPct}% of the cycle elapsed. That is tracking.`,
  };
}

/**
 * How much attention a status deserves, for ordering and for deciding whether
 * to raise a review item. Essentials are capped below NEEDS_ATTENTION on
 * purpose.
 */
export type Attention = 'NONE' | 'WORTH_NOTICING' | 'NEEDS_ATTENTION';

export function attentionFor(line: CategoryLine): Attention {
  if (line.status === 'PROTECTED' || line.status === 'RESERVED' || line.status === 'ON_TRACK') {
    return 'NONE';
  }
  if (line.isEssential) return 'WORTH_NOTICING';
  if (line.status === 'SPENT' && line.remainingCents < 0) return 'NEEDS_ATTENTION';
  if (line.status === 'RUNNING_HOT' && line.spentPct - line.elapsedPct > 30) {
    return 'NEEDS_ATTENTION';
  }
  return 'WORTH_NOTICING';
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

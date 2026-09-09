/**
 * The Buy It decision engine.
 *
 * Deterministic and inspectable. No model, no score, no judgement call made
 * somewhere I cannot see. The same inputs always produce the same verdict, and
 * every check that fed it is returned alongside so I can read the reasoning
 * and disagree with it if it is wrong.
 *
 * The four answers are BUY, WAIT, NOT FUNDED and NEEDS INFORMATION. There is
 * deliberately no "treat yourself" and no "you deserve it".
 */

import type { AccountRole, Priority, Verdict } from '@prisma/client';
import { addHoursUtc } from '@/lib/time';
import type { Cents } from '@/lib/money';
import { NEVER_RAID_ROLES, roleLabel } from './roles';

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Lower is more urgent. */
export const PRIORITY_ORDER: Record<Priority, number> = {
  SAFETY_REPLACEMENT: 0,
  REPLACEMENT: 1,
  NEED: 2,
  USEFUL_UPGRADE: 3,
  WANT: 4,
  FUTURE_DECISION: 5,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  SAFETY_REPLACEMENT: 'Safety replacement',
  REPLACEMENT: 'Replacement',
  NEED: 'Need',
  USEFUL_UPGRADE: 'Useful upgrade',
  WANT: 'Want',
  FUTURE_DECISION: 'Future decision',
};

export function isHigherPriority(a: Priority, b: Priority): boolean {
  return PRIORITY_ORDER[a] < PRIORITY_ORDER[b];
}

// ---------------------------------------------------------------------------
// Waiting periods
// ---------------------------------------------------------------------------

export interface WaitTiers {
  tier1MaxCents: Cents; // under this: no wait
  tier2MaxCents: Cents;
  tier3MaxCents: Cents;
  tier1Hours: number;
  tier2Hours: number;
  tier3Hours: number;
  tier4Hours: number;
}

export const DEFAULT_WAIT_TIERS: WaitTiers = {
  tier1MaxCents: 5_000, // $50
  tier2MaxCents: 20_000, // $200
  tier3MaxCents: 50_000, // $500
  tier1Hours: 0,
  tier2Hours: 72, // 3 days
  tier3Hours: 336, // 14 days
  tier4Hours: 720, // 30 days
};

export interface WaitRequirement {
  hours: number;
  tierLabel: string;
}

/**
 * How long an item of this price must sit before it can be bought.
 *
 * The tiers are inclusive at the top: exactly $200 sits in the $50-$200 band.
 */
export function requiredWaitHours(priceCents: Cents, tiers: WaitTiers = DEFAULT_WAIT_TIERS): WaitRequirement {
  if (priceCents < tiers.tier1MaxCents) {
    return { hours: tiers.tier1Hours, tierLabel: `under ${money(tiers.tier1MaxCents)}` };
  }
  if (priceCents <= tiers.tier2MaxCents) {
    return {
      hours: tiers.tier2Hours,
      tierLabel: `${money(tiers.tier1MaxCents)} to ${money(tiers.tier2MaxCents)}`,
    };
  }
  if (priceCents <= tiers.tier3MaxCents) {
    return {
      hours: tiers.tier3Hours,
      tierLabel: `${money(tiers.tier2MaxCents)} to ${money(tiers.tier3MaxCents)}`,
    };
  }
  return { hours: tiers.tier4Hours, tierLabel: `over ${money(tiers.tier3MaxCents)}` };
}

export function describeWait(hours: number): string {
  if (hours <= 0) return 'no waiting period';
  if (hours < 48) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface CandidateItem {
  id: string;
  name: string;
  priceCents: Cents | null;
  priority: Priority;
  role: AccountRole;
  addedAt: Date;
}

export interface OutstandingItem {
  id: string;
  name: string;
  priceCents: Cents | null;
  priority: Priority;
  role: AccountRole;
}

export type CheckOutcome = 'PASS' | 'FAIL' | 'UNKNOWN' | 'INFO';

export interface DecisionCheck {
  key: string;
  question: string;
  answer: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface BuyItDecision {
  verdict: Verdict;
  headline: string;
  /** One paragraph, plain language, no scolding. */
  summary: string;
  checks: DecisionCheck[];
  item: CandidateItem;
  saverRole: AccountRole;
  saverBalanceCents: Cents;
  shortfallCents: Cents;
  balanceAfterCents: Cents;
  waitRequiredHours: number;
  waitElapsedHours: number;
  waitClearsAt: Date | null;
  blockingItem: OutstandingItem | null;
}

export interface BuyItInput {
  item: CandidateItem;
  /** Balance of the Saver that must fund this item. */
  saverBalanceCents: Cents;
  /** Everything else still under consideration, for the priority rule. */
  outstanding: readonly OutstandingItem[];
  now: Date;
  tiers?: WaitTiers;
}

/**
 * Decide.
 *
 * The order of the verdicts is fixed:
 *
 *   NEEDS INFORMATION  we do not know the price, so there is nothing to decide
 *   NOT FUNDED         the correct Saver cannot cover the whole cost
 *   WAIT               fundable, but the waiting period has not passed, or a
 *                      higher-priority item would stop being affordable
 *   BUY                everything clears
 *
 * A shortfall is never made up from another bucket. Emergency, Travel, Future
 * Options and Investing are not options, and the engine will not offer them.
 */
export function decideBuyIt(input: BuyItInput): BuyItDecision {
  const { item, saverBalanceCents, outstanding, now } = input;
  const tiers = input.tiers ?? DEFAULT_WAIT_TIERS;
  const checks: DecisionCheck[] = [];
  const saverLabel = roleLabel(item.role);

  // --- Do we know what it costs? ------------------------------------------
  if (item.priceCents === null || item.priceCents <= 0) {
    checks.push({
      key: 'price',
      question: 'Do we know the price?',
      answer: 'No',
      outcome: 'UNKNOWN',
      detail:
        'No price is recorded for this item. Add one here or in Notion and the decision can be made.',
    });
    return {
      verdict: 'NEEDS_INFORMATION',
      headline: 'Needs information',
      summary: `There is no price on ${item.name} yet, so there is nothing to decide. Add the price and ask again.`,
      checks,
      item,
      saverRole: item.role,
      saverBalanceCents,
      shortfallCents: 0,
      balanceAfterCents: saverBalanceCents,
      waitRequiredHours: 0,
      waitElapsedHours: 0,
      waitClearsAt: null,
      blockingItem: null,
    };
  }

  const priceCents = item.priceCents;
  checks.push({
    key: 'price',
    question: 'Do we know the price?',
    answer: money(priceCents),
    outcome: 'PASS',
    detail: `${item.name} is recorded at ${money(priceCents)}.`,
  });

  // --- Can the correct Saver cover the whole thing? -----------------------
  const fundsFully = saverBalanceCents >= priceCents;
  const shortfallCents = Math.max(0, priceCents - saverBalanceCents);
  const balanceAfterCents = saverBalanceCents - priceCents;

  checks.push({
    key: 'funded',
    question: `Can ${saverLabel} fund 100% of this?`,
    answer: fundsFully ? 'Yes' : 'No',
    outcome: fundsFully ? 'PASS' : 'FAIL',
    detail: fundsFully
      ? `${saverLabel} holds ${money(saverBalanceCents)}, which covers ${money(priceCents)} and leaves ${money(balanceAfterCents)}.`
      : `${saverLabel} holds ${money(saverBalanceCents)}, which is ${money(shortfallCents)} short. The rule is that the correct Saver covers the whole cost, so the answer is not yet.`,
  });

  checks.push({
    key: 'protected',
    question: 'Would this need protected money?',
    answer: fundsFully ? 'No' : 'Yes, and that is not an option',
    outcome: fundsFully ? 'PASS' : 'FAIL',
    detail: fundsFully
      ? `${saverLabel} covers it on its own. Nothing needs to come from ${NEVER_RAID_ROLES.map(roleLabel).join(', ')}.`
      : `Covering the ${money(shortfallCents)} gap would mean drawing on ${NEVER_RAID_ROLES.map(roleLabel).join(', ')}. None of those are available for this, so the gap has to be closed by ${saverLabel} filling up.`,
  });

  // --- Has it sat long enough? --------------------------------------------
  const { hours: waitRequiredHours, tierLabel } = requiredWaitHours(priceCents, tiers);
  const waitElapsedHours = Math.floor((now.getTime() - item.addedAt.getTime()) / 3_600_000);
  const waitPassed = waitElapsedHours >= waitRequiredHours;
  const waitClearsAt = waitRequiredHours > 0 ? addHoursUtc(item.addedAt, waitRequiredHours) : null;

  checks.push({
    key: 'wait',
    question: 'Has the waiting period passed?',
    answer: waitPassed ? 'Yes' : 'No',
    outcome: waitPassed ? 'PASS' : 'FAIL',
    detail:
      waitRequiredHours === 0
        ? `At ${money(priceCents)} this sits in the ${tierLabel} band, which carries no waiting period.`
        : waitPassed
          ? `The ${tierLabel} band carries a ${describeWait(waitRequiredHours)} wait. It has been ${describeWait(waitElapsedHours)} since this went on the list.`
          : `The ${tierLabel} band carries a ${describeWait(waitRequiredHours)} wait. It has been ${describeWait(waitElapsedHours)}. A sale does not shorten this.`,
  });

  // --- Would something more important stop being affordable? --------------
  //
  // Only items that are affordable NOW and would stop being affordable count.
  // An item that is already out of reach is not made out of reach by this
  // purchase, and treating it as a blocker would freeze the whole list behind
  // one expensive thing.
  const sameSaver = outstanding.filter(
    (o) => o.id !== item.id && o.role === item.role && o.priceCents !== null && o.priceCents > 0,
  );
  const higherPriority = sameSaver
    .filter((o) => isHigherPriority(o.priority, item.priority))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.priceCents ?? 0) - (a.priceCents ?? 0));

  const blockingItem =
    higherPriority.find(
      (o) => (o.priceCents ?? 0) <= saverBalanceCents && (o.priceCents ?? 0) > balanceAfterCents,
    ) ?? null;

  const alreadyOutOfReach = higherPriority.filter((o) => (o.priceCents ?? 0) > saverBalanceCents);

  if (higherPriority.length === 0) {
    checks.push({
      key: 'priority',
      question: 'Is anything more important outstanding?',
      answer: 'No',
      outcome: 'PASS',
      detail: `Nothing on the list funded by ${saverLabel} ranks above ${PRIORITY_LABEL[item.priority].toLowerCase()}.`,
    });
  } else if (blockingItem) {
    checks.push({
      key: 'priority',
      question: 'Is anything more important outstanding?',
      answer: `Yes — ${blockingItem.name}`,
      outcome: 'FAIL',
      detail: `${blockingItem.name} is a ${PRIORITY_LABEL[blockingItem.priority].toLowerCase()} at ${money(blockingItem.priceCents ?? 0)}. ${saverLabel} can cover it today, but buying ${item.name} would leave ${money(balanceAfterCents)} and put it out of reach.`,
    });
  } else {
    checks.push({
      key: 'priority',
      question: 'Is anything more important outstanding?',
      answer: `Yes, but none are affected`,
      outcome: 'INFO',
      detail:
        alreadyOutOfReach.length > 0
          ? `${alreadyOutOfReach.map((o) => o.name).join(', ')} rank higher but ${saverLabel} cannot cover ${alreadyOutOfReach.length === 1 ? 'it' : 'them'} today either way, so this purchase does not change their position.`
          : `Higher-priority items exist, and ${money(balanceAfterCents)} still covers them after this purchase.`,
    });
  }

  // --- Verdict ------------------------------------------------------------
  let verdict: Verdict;
  let headline: string;
  let summary: string;

  if (!fundsFully) {
    verdict = 'NOT_FUNDED';
    headline = 'Not funded';
    summary = `${saverLabel} holds ${money(saverBalanceCents)} against a ${money(priceCents)} price, so it is ${money(shortfallCents)} short. The answer is not yet rather than no. ${saverLabel} fills up again on payday.`;
  } else if (!waitPassed) {
    verdict = 'WAIT';
    headline = 'Wait';
    const remainingHours = waitRequiredHours - waitElapsedHours;
    summary = `You can afford this. The ${describeWait(waitRequiredHours)} waiting period for something in the ${tierLabel} band has ${describeWait(remainingHours)} left to run${waitClearsAt ? `, clearing on ${formatDay(waitClearsAt)}` : ''}. If it is still worth it then, it is worth it.`;
  } else if (blockingItem) {
    verdict = 'WAIT';
    headline = 'Wait';
    summary = `You can afford this, but buying it would leave ${money(balanceAfterCents)} in ${saverLabel} while ${blockingItem.name}, a higher-priority ${PRIORITY_LABEL[blockingItem.priority].toLowerCase()} at ${money(blockingItem.priceCents ?? 0)}, is still outstanding.`;
  } else {
    verdict = 'BUY';
    headline = 'Buy';
    summary = `${saverLabel} covers it in full, the waiting period has passed, and nothing more important is waiting on the same money. ${money(balanceAfterCents)} would be left in ${saverLabel}.`;
  }

  return {
    verdict,
    headline,
    summary,
    checks,
    item,
    saverRole: item.role,
    saverBalanceCents,
    shortfallCents,
    balanceAfterCents,
    waitRequiredHours,
    waitElapsedHours,
    waitClearsAt,
    blockingItem,
  };
}

function money(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Australia/Sydney',
  }).format(date);
}

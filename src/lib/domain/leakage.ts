/**
 * Saver leakage detection.
 *
 * The app cannot stop me moving money around inside Up, and it should not try.
 * What it can do is notice a pattern I would rather not repeat: money leaving a
 * Saver that exists for one purpose, followed shortly by spending on something
 * else.
 *
 *   11:04  $300 moved Travel -> Spending
 *   11:16  $285 at a bike shop
 *
 * That is the shape this looks for. It is correlation, not proof, and the
 * wording reflects that. Nothing here says I did something wrong.
 *
 * Up gives us what we need: an internal transfer carries a `transferAccount`
 * relationship naming the other side, and the sign of the amount tells us the
 * direction.
 */

import type { AccountRole } from '@prisma/client';
import { minutesBetween } from '@/lib/time';
import type { Cents } from '@/lib/money';
import { ALWAYS_REVIEW_TRANSFER_OUT, roleLabel } from './roles';

export interface TransferCandidate {
  id: string;
  at: Date;
  /** Positive magnitude of the money that left the source account. */
  amountCents: Cents;
  sourceRole: AccountRole;
  destRole: AccountRole | null;
  description: string;
}

export interface SpendCandidate {
  id: string;
  at: Date;
  /** Positive magnitude of the purchase. */
  amountCents: Cents;
  description: string;
  /** The budget bucket the purchase was resolved to, if any. */
  role: AccountRole | null;
  tags?: readonly string[];
}

export interface LeakageSettings {
  windowMinutes: number;
  /** A spend within this percentage of the transfer counts as correlated. */
  tolerancePct: number;
  /** Transfers below this are ignored entirely. */
  minCents: Cents;
}

export const DEFAULT_LEAKAGE_SETTINGS: LeakageSettings = {
  windowMinutes: 180,
  tolerancePct: 30,
  minCents: 5000,
};

export interface LeakageExplanationStep {
  label: string;
  detail: string;
}

export interface LeakageFinding {
  transferTransactionId: string;
  transferAt: Date;
  transferCents: Cents;
  sourceRole: AccountRole;
  destRole: AccountRole | null;
  spendTransactionIds: string[];
  spendCents: Cents;
  spendRole: AccountRole | null;
  minutesBetween: number;
  /** 0-100. How strongly the transfer and the spending line up. */
  confidence: number;
  headline: string;
  explanation: LeakageExplanationStep[];
}

/**
 * Spending that a Travel transfer is allowed to be followed by without being
 * flagged. Moving money out of Travel and then spending it on travel is the
 * system working.
 */
const TRAVEL_COMPATIBLE_ROLES: readonly AccountRole[] = ['TRAVEL', 'TRANSPORT'];
const TRAVEL_COMPATIBLE_TAGS = ['travel', 'london 2026', 'flights', 'accommodation'];

/**
 * Spending that a Gear transfer is allowed to be followed by. Money out of
 * Gear buying gear is exactly what Gear is for.
 */
const GEAR_COMPATIBLE_ROLES: readonly AccountRole[] = ['GEAR_OBJECTS'];
const GEAR_COMPATIBLE_TAGS = ['gear', 'bikepacking', 'planned purchase'];

function hasTag(spend: SpendCandidate, tags: readonly string[]): boolean {
  const lower = (spend.tags ?? []).map((t) => t.toLowerCase());
  return tags.some((t) => lower.includes(t));
}

/**
 * Is this spending consistent with the purpose of the Saver the money came
 * from? Purpose-matched spending is never leakage.
 */
export function isSpendCompatible(sourceRole: AccountRole, spend: SpendCandidate): boolean {
  switch (sourceRole) {
    case 'TRAVEL':
      return (
        (spend.role !== null && TRAVEL_COMPATIBLE_ROLES.includes(spend.role)) ||
        hasTag(spend, TRAVEL_COMPATIBLE_TAGS)
      );
    case 'GEAR_OBJECTS':
      return (
        (spend.role !== null && GEAR_COMPATIBLE_ROLES.includes(spend.role)) ||
        hasTag(spend, GEAR_COMPATIBLE_TAGS)
      );
    case 'EMERGENCY':
    case 'FUTURE_OPTIONS':
      // These are defensive. There is no ordinary purchase that is "consistent"
      // with drawing on them, so a transfer out is always worth a look.
      return false;
    default:
      return true;
  }
}

/**
 * Should a transfer out of this role be examined at all?
 *
 * Emergency and Future Options are always examined, even with no correlated
 * spending, because the movement itself is the thing worth seeing. Travel and
 * Gear are examined only when spending follows. Everything else is ordinary
 * budgeting and is left alone.
 */
export function isWatchedSource(role: AccountRole): boolean {
  return (
    ALWAYS_REVIEW_TRANSFER_OUT.includes(role) ||
    role === 'TRAVEL' ||
    role === 'GEAR_OBJECTS' ||
    role === 'INVESTING'
  );
}

function amountCloseness(transferCents: Cents, spendCents: Cents, tolerancePct: number): number {
  if (transferCents <= 0) return 0;
  const diff = Math.abs(transferCents - spendCents);
  const pctDiff = (diff / transferCents) * 100;
  if (pctDiff > tolerancePct) return 0;
  // 100 when identical, tapering to 0 at the tolerance edge.
  return Math.round(100 - (pctDiff / tolerancePct) * 100);
}

/**
 * Find the spending that best explains a transfer.
 *
 * Two shapes count. A single purchase close to the transfer amount is the
 * strong case. A run of purchases inside the window that together come close
 * to the transfer amount is the weaker one, and scores lower.
 */
function correlate(
  transfer: TransferCandidate,
  spends: readonly SpendCandidate[],
  settings: LeakageSettings,
): { matched: SpendCandidate[]; closeness: number; kind: 'SINGLE' | 'GROUPED' | 'NONE' } {
  const inWindow = spends
    .filter((s) => {
      const mins = minutesBetween(transfer.at, s.at);
      return mins >= 0 && mins <= settings.windowMinutes;
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (inWindow.length === 0) return { matched: [], closeness: 0, kind: 'NONE' };

  let best: { spend: SpendCandidate; closeness: number } | null = null;
  for (const spend of inWindow) {
    const closeness = amountCloseness(transfer.amountCents, spend.amountCents, settings.tolerancePct);
    if (closeness > 0 && (!best || closeness > best.closeness)) {
      best = { spend, closeness };
    }
  }
  if (best) return { matched: [best.spend], closeness: best.closeness, kind: 'SINGLE' };

  // Grouped: accumulate in time order until we are within tolerance.
  let total = 0;
  const group: SpendCandidate[] = [];
  for (const spend of inWindow) {
    total += spend.amountCents;
    group.push(spend);
    const closeness = amountCloseness(transfer.amountCents, total, settings.tolerancePct);
    if (closeness > 0) {
      // Grouped evidence is genuinely weaker. Scale it down rather than
      // presenting a pile of unrelated coffees as a confident finding.
      return { matched: group, closeness: Math.round(closeness * 0.6), kind: 'GROUPED' };
    }
    if (total > transfer.amountCents * (1 + settings.tolerancePct / 100)) break;
  }

  return { matched: [], closeness: 0, kind: 'NONE' };
}

/**
 * Run the detector over a set of transfers and spends.
 *
 * Both lists should already be restricted to the period of interest and to
 * transactions on accounts that are mapped to roles.
 */
export function detectLeakage(
  transfers: readonly TransferCandidate[],
  spends: readonly SpendCandidate[],
  settings: LeakageSettings = DEFAULT_LEAKAGE_SETTINGS,
): LeakageFinding[] {
  const findings: LeakageFinding[] = [];

  for (const transfer of transfers) {
    if (transfer.amountCents < settings.minCents) continue;
    if (!isWatchedSource(transfer.sourceRole)) continue;

    const { matched, closeness, kind } = correlate(transfer, spends, settings);
    const compatible = matched.length > 0 && matched.every((s) => isSpendCompatible(transfer.sourceRole, s));
    const alwaysReview = ALWAYS_REVIEW_TRANSFER_OUT.includes(transfer.sourceRole);

    // Purpose-matched spending is the system working. Say nothing.
    if (compatible && !alwaysReview) continue;

    // Travel and Gear only raise something when spending actually followed.
    if (matched.length === 0 && !alwaysReview) continue;

    const spendCents = matched.reduce((acc, s) => acc + s.amountCents, 0);
    const firstSpend = matched[0];
    const mins = firstSpend ? minutesBetween(transfer.at, firstSpend.at) : 0;

    const explanation: LeakageExplanationStep[] = [
      {
        label: 'The transfer',
        detail: `${fmt(transfer.amountCents)} left ${roleLabel(transfer.sourceRole)}${
          transfer.destRole ? ` and went to ${roleLabel(transfer.destRole)}` : ''
        } at ${timeOf(transfer.at)}.`,
      },
    ];

    let confidence: number;
    let headline: string;

    if (matched.length === 0) {
      confidence = 55;
      headline = `${fmt(transfer.amountCents)} moved out of ${roleLabel(transfer.sourceRole)}`;
      explanation.push({
        label: 'Why this is here',
        detail: `${roleLabel(transfer.sourceRole)} is protected, so any money leaving it is surfaced. No related spending was found within ${settings.windowMinutes} minutes, so this may simply be a transfer you meant to make.`,
      });
    } else if (kind === 'SINGLE') {
      const spend = matched[0]!;
      confidence = Math.min(95, Math.round(closeness * 0.7 + timeScore(mins, settings.windowMinutes) * 0.3));
      headline = `${fmt(transfer.amountCents)} was moved from ${roleLabel(transfer.sourceRole)} shortly before a ${fmt(spend.amountCents)} ${spendNoun(spend)}`;
      explanation.push({
        label: 'The spending',
        detail: `${fmt(spend.amountCents)} at ${spend.description} at ${timeOf(spend.at)}, ${mins} ${mins === 1 ? 'minute' : 'minutes'} later.`,
      });
      explanation.push({
        label: 'Why they were linked',
        detail: `The amounts are within ${settings.tolerancePct}% of each other and the spending fell inside the ${settings.windowMinutes} minute window after the transfer.`,
      });
    } else {
      confidence = Math.min(80, Math.round(closeness * 0.7 + timeScore(mins, settings.windowMinutes) * 0.3));
      headline = `${fmt(transfer.amountCents)} was moved from ${roleLabel(transfer.sourceRole)} shortly before ${matched.length} purchases totalling ${fmt(spendCents)}`;
      explanation.push({
        label: 'The spending',
        detail: matched
          .map((s) => `${fmt(s.amountCents)} at ${s.description} (${timeOf(s.at)})`)
          .join(', '),
      });
      explanation.push({
        label: 'Why they were linked',
        detail: `Together these come within ${settings.tolerancePct}% of the transfer, inside the ${settings.windowMinutes} minute window. Grouped matches are weaker evidence than a single one, so the confidence is lower.`,
      });
    }

    if (alwaysReview && matched.length > 0) {
      explanation.push({
        label: 'Why it matters here',
        detail: `${roleLabel(transfer.sourceRole)} exists for one purpose. Drawing on it for ordinary spending is the pattern this app was built to make visible.`,
      });
      confidence = Math.min(98, confidence + 10);
    }

    if (transfer.sourceRole === 'TRAVEL' && matched.length > 0) {
      explanation.push({
        label: 'Why it matters here',
        detail:
          'Travel money is for travel. This spending did not look like travel, so the Travel balance is now lower without a trip getting closer.',
      });
    }

    explanation.push({
      label: 'What this is not',
      detail:
        'This is a correlation in timing and amount, not proof. If the two are unrelated, mark it as such and it will not be raised again.',
    });

    findings.push({
      transferTransactionId: transfer.id,
      transferAt: transfer.at,
      transferCents: transfer.amountCents,
      sourceRole: transfer.sourceRole,
      destRole: transfer.destRole,
      spendTransactionIds: matched.map((s) => s.id),
      spendCents,
      spendRole: matched[0]?.role ?? null,
      minutesBetween: mins,
      confidence,
      headline,
      explanation,
    });
  }

  return findings.sort((a, b) => b.transferAt.getTime() - a.transferAt.getTime());
}

/** Total leakage over a period, for the "Leakage this month" figure. */
export function leakageTotal(
  findings: ReadonlyArray<{ spendCents: Cents; verdict?: string }>,
): Cents {
  return findings
    .filter((f) => f.verdict === undefined || f.verdict === 'UNREVIEWED' || f.verdict === 'CONFIRMED')
    .reduce((acc, f) => acc + f.spendCents, 0);
}

function timeScore(minutes: number, window: number): number {
  if (window <= 0) return 0;
  return Math.max(0, Math.round(100 - (minutes / window) * 100));
}

function spendNoun(spend: SpendCandidate): string {
  if (spend.role === 'GEAR_OBJECTS') return 'Gear purchase';
  if (spend.role === 'DINING_SOCIAL') return 'dining purchase';
  if (spend.role === 'FUN') return 'Fun purchase';
  return 'purchase';
}

function timeOf(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Australia/Sydney',
  }).format(date);
}

function fmt(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

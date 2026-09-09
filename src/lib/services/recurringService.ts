/**
 * Recurring spend, wired to the database.
 *
 * The detector runs over the whole stored history each sync, because a new
 * charge can change the reading of an old one: two charges are a coincidence
 * until the third arrives and makes them a subscription.
 *
 * A merchant I have ruled on keeps its ruling. Marking something "not
 * recurring" has to stick, or the app argues with me every fortnight.
 */

import 'server-only';

import type { RecurringStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { detectRecurring, type RecurringCandidate } from '@/lib/domain/recurring';
import { getSettings, recurringSettingsFrom } from './settings';
import { raiseReviewItem } from './reviewItems';

export async function detectAndStoreRecurring(now: Date = new Date()): Promise<number> {
  const settings = await getSettings();

  const transactions = await prisma.transaction.findMany({
    where: { deletedAt: null, isInternalTransfer: false },
    select: {
      id: true,
      description: true,
      rawText: true,
      amountCents: true,
      createdAt: true,
      isInternalTransfer: true,
      deletedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const candidates = detectRecurring(transactions, recurringSettingsFrom(settings), now);

  let stored = 0;
  for (const candidate of candidates) {
    const existing = await prisma.recurringMerchant.findUnique({
      where: { merchantKey: candidate.merchantKey },
    });

    if (existing) {
      await prisma.recurringMerchant.update({
        where: { id: existing.id },
        data: {
          displayName: candidate.displayName,
          frequency: candidate.frequency,
          intervalDays: candidate.intervalDays,
          typicalAmountCents: candidate.typicalAmountCents,
          monthlyEquivalentCents: candidate.monthlyEquivalentCents,
          occurrences: candidate.occurrences,
          firstSeenAt: candidate.firstSeenAt,
          lastSeenAt: candidate.lastSeenAt,
          nextExpectedAt: candidate.nextExpectedAt,
          confidence: candidate.confidence,
        },
      });
      continue;
    }

    await prisma.recurringMerchant.create({
      data: {
        merchantKey: candidate.merchantKey,
        displayName: candidate.displayName,
        frequency: candidate.frequency,
        intervalDays: candidate.intervalDays,
        typicalAmountCents: candidate.typicalAmountCents,
        monthlyEquivalentCents: candidate.monthlyEquivalentCents,
        occurrences: candidate.occurrences,
        firstSeenAt: candidate.firstSeenAt,
        lastSeenAt: candidate.lastSeenAt,
        nextExpectedAt: candidate.nextExpectedAt,
        confidence: candidate.confidence,
        status: 'NEW',
      },
    });
    stored += 1;

    await raiseForCandidate(candidate);
  }

  return stored;
}

/**
 * Only genuinely new commitments get a notice, and only ones that started
 * recently. Discovering a three-year-old phone bill on first import is not
 * news, it is the import working.
 */
async function raiseForCandidate(candidate: RecurringCandidate): Promise<void> {
  const startedRecently = candidate.firstSeenAt.getTime() > Date.now() - 120 * 86_400_000;
  if (!startedRecently) return;

  await raiseReviewItem({
    kind: 'NEW_RECURRING_COST',
    severity: 'WORTH_NOTICING',
    title: 'Possible new recurring cost',
    body: `${candidate.displayName} looks ${candidate.frequency.toLowerCase()} at about ${money(candidate.typicalAmountCents)}, which is ${money(candidate.monthlyEquivalentCents)} a month.`,
    dedupeKey: `recurring:${candidate.merchantKey}`,
    data: {
      merchantKey: candidate.merchantKey,
      confidence: candidate.confidence,
      monthlyEquivalentCents: candidate.monthlyEquivalentCents,
    },
  });
}

export async function listRecurring(options: { includeDismissed?: boolean } = {}) {
  return prisma.recurringMerchant.findMany({
    where: options.includeDismissed
      ? undefined
      : { status: { notIn: ['CANCELLED', 'NOT_RECURRING'] } },
    orderBy: { monthlyEquivalentCents: 'desc' },
  });
}

export async function setRecurringStatus(id: string, status: RecurringStatus): Promise<void> {
  const row = await prisma.recurringMerchant.update({
    where: { id },
    data: { status, acknowledgedAt: new Date() },
  });

  if (status !== 'NEW') {
    await prisma.reviewItem.updateMany({
      where: { dedupeKey: `recurring:${row.merchantKey}`, dismissedAt: null },
      data: { dismissedAt: new Date(), resolvedAt: new Date() },
    });
  }
}

/** Total monthly commitment across everything not cancelled or dismissed. */
export async function monthlyCommitmentTotal(): Promise<number> {
  const rows = await listRecurring();
  return rows.reduce((acc, r) => acc + r.monthlyEquivalentCents, 0);
}

export const RECURRING_STATUS_LABEL: Record<RecurringStatus, string> = {
  NEW: 'New',
  EXPECTED: 'Expected',
  CANCELLED: 'Cancelled',
  NOT_RECURRING: 'Not recurring',
  REVIEW: 'Review',
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Leakage detection, wired to the database.
 *
 * The pure engine lives in `domain/leakage.ts`. This assembles its inputs from
 * stored transactions, persists findings, and raises a review item for the
 * ones that warrant it.
 *
 * A finding I have already ruled on is never re-raised. Marking something as
 * unrelated is a decision the app has to respect, or it becomes something I
 * learn to ignore.
 */

import 'server-only';

import type { AccountRole, LeakageVerdict, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  detectLeakage,
  type LeakageFinding,
  type SpendCandidate,
  type TransferCandidate,
} from '@/lib/domain/leakage';
import { ALWAYS_REVIEW_TRANSFER_OUT, roleLabel } from '@/lib/domain/roles';
import { getSettings, leakageSettingsFrom } from './settings';
import { raiseReviewItem } from './reviewItems';

/** How far back to look on each run. Older findings are already stored. */
const LOOKBACK_DAYS = 120;

export async function detectAndStoreLeakage(now: Date = new Date()): Promise<number> {
  const settings = await getSettings();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const mappings = await prisma.accountRoleMapping.findMany();
  if (mappings.length === 0) return 0;
  const roleByAccount = new Map<string, AccountRole>(mappings.map((m) => [m.accountId, m.role]));

  const transactions = await prisma.transaction.findMany({
    where: { createdAt: { gte: since }, deletedAt: null },
    include: { tags: true },
    orderBy: { createdAt: 'asc' },
  });

  // Outbound legs of internal transfers, from accounts with a known purpose.
  const transfers: TransferCandidate[] = transactions
    .filter((t) => t.isInternalTransfer && t.amountCents < 0 && roleByAccount.has(t.accountId))
    .map((t) => ({
      id: t.id,
      at: t.createdAt,
      amountCents: Math.abs(t.amountCents),
      sourceRole: roleByAccount.get(t.accountId)!,
      destRole: t.transferAccountId ? (roleByAccount.get(t.transferAccountId) ?? null) : null,
      description: t.description,
    }));

  const spends: SpendCandidate[] = transactions
    .filter((t) => !t.isInternalTransfer && t.amountCents < 0)
    .map((t) => ({
      id: t.id,
      at: t.createdAt,
      amountCents: Math.abs(t.amountCents),
      description: t.description,
      role: t.role,
      tags: t.tags.map((tag) => tag.tag),
    }));

  const findings = detectLeakage(transfers, spends, leakageSettingsFrom(settings));

  let stored = 0;
  for (const finding of findings) {
    const existing = await prisma.leakageEvent.findUnique({
      where: { transferTransactionId: finding.transferTransactionId },
    });

    if (existing) {
      // Refresh the evidence but never overturn a verdict I have given.
      if (existing.verdict === 'UNREVIEWED') {
        await prisma.leakageEvent.update({
          where: { id: existing.id },
          data: {
            spendTransactionIds: finding.spendTransactionIds,
            spendCents: finding.spendCents,
            spendRole: finding.spendRole,
            minutesBetween: finding.minutesBetween,
            confidence: finding.confidence,
            explanation: toJson(finding),
          },
        });
      }
      continue;
    }

    await prisma.leakageEvent.create({
      data: {
        transferTransactionId: finding.transferTransactionId,
        transferAt: finding.transferAt,
        transferCents: finding.transferCents,
        sourceRole: finding.sourceRole,
        destRole: finding.destRole,
        spendTransactionIds: finding.spendTransactionIds,
        spendCents: finding.spendCents,
        spendRole: finding.spendRole,
        minutesBetween: finding.minutesBetween,
        confidence: finding.confidence,
        explanation: toJson(finding),
      },
    });
    stored += 1;

    await raiseForFinding(finding);
  }

  return stored;
}

function toJson(finding: LeakageFinding): Prisma.InputJsonValue {
  return {
    headline: finding.headline,
    steps: finding.explanation.map((step) => ({ label: step.label, detail: step.detail })),
  };
}

/** The shape `explanation` is written in, for reading it back out safely. */
export interface StoredLeakageExplanation {
  headline: string;
  steps: Array<{ label: string; detail: string }>;
}

export function readExplanation(value: unknown): StoredLeakageExplanation {
  if (
    value &&
    typeof value === 'object' &&
    'headline' in value &&
    'steps' in value &&
    Array.isArray((value as StoredLeakageExplanation).steps)
  ) {
    return value as StoredLeakageExplanation;
  }
  return { headline: '', steps: [] };
}

async function raiseForFinding(finding: LeakageFinding): Promise<void> {
  const isProtectedSource = ALWAYS_REVIEW_TRANSFER_OUT.includes(finding.sourceRole);

  const kind =
    finding.sourceRole === 'EMERGENCY'
      ? 'EMERGENCY_TRANSFER_OUT'
      : finding.sourceRole === 'FUTURE_OPTIONS'
        ? 'FUTURE_OPTIONS_TRANSFER_OUT'
        : 'POSSIBLE_LEAKAGE';

  await raiseReviewItem({
    kind,
    // Never NEEDS_ATTENTION. This is a pattern to see, not an emergency.
    severity: isProtectedSource ? 'WORTH_NOTICING' : 'WORTH_NOTICING',
    title: isProtectedSource
      ? `Money left ${roleLabel(finding.sourceRole)}`
      : 'Possible Saver leakage',
    body: finding.headline,
    dedupeKey: `leakage:${finding.transferTransactionId}`,
    data: { confidence: finding.confidence, transferCents: finding.transferCents },
  });
}

// ---------------------------------------------------------------------------
// Reading and reviewing
// ---------------------------------------------------------------------------

export async function listLeakageEvents(options: { limit?: number; since?: Date } = {}) {
  return prisma.leakageEvent.findMany({
    where: options.since ? { transferAt: { gte: options.since } } : undefined,
    orderBy: { transferAt: 'desc' },
    take: options.limit ?? 50,
  });
}

export async function setLeakageVerdict(id: string, verdict: LeakageVerdict): Promise<void> {
  await prisma.leakageEvent.update({
    where: { id },
    data: { verdict, reviewedAt: new Date() },
  });

  const event = await prisma.leakageEvent.findUnique({ where: { id } });
  if (!event) return;

  // Ruling on a finding closes its notification. Anything else is nagging.
  if (verdict !== 'UNREVIEWED') {
    await prisma.reviewItem.updateMany({
      where: { dedupeKey: `leakage:${event.transferTransactionId}`, dismissedAt: null },
      data: { dismissedAt: new Date(), resolvedAt: new Date() },
    });
  }
}

/**
 * The "leakage this month" figure.
 *
 * Only counts findings that are unreviewed or confirmed. Anything I marked as
 * expected, a legitimate exception, or unrelated is excluded, which is what
 * makes the number mean something over time.
 */
export async function leakageInPeriod(from: Date, to: Date): Promise<{ cents: number; count: number }> {
  const events = await prisma.leakageEvent.findMany({
    where: {
      transferAt: { gte: from, lt: to },
      verdict: { in: ['UNREVIEWED', 'CONFIRMED'] },
    },
  });
  return {
    cents: events.reduce((acc, e) => acc + e.spendCents, 0),
    count: events.length,
  };
}

export const VERDICT_LABEL: Record<LeakageVerdict, string> = {
  UNREVIEWED: 'Not reviewed',
  EXPECTED: 'Expected',
  LEGITIMATE_EXCEPTION: 'Legitimate exception',
  NOT_RELATED: 'Not related',
  CONFIRMED: 'Yes, this was leakage',
};

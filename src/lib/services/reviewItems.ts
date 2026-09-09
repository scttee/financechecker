/**
 * Review items.
 *
 * The notification system, such as it is. The design constraint is that this
 * app must never become a thing that buzzes. There is no notification for a
 * transaction, no notification for a purchase, and no notification for
 * ordinary spending.
 *
 * Every item carries a dedupe key. The same situation raises one item, not one
 * per sync, which is the difference between a system worth reading and one
 * worth muting.
 */

import 'server-only';

import type { Prisma, ReviewItemKind, ReviewItemSeverity } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface RaiseInput {
  kind: ReviewItemKind;
  severity?: ReviewItemSeverity;
  title: string;
  body?: string;
  dedupeKey: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Raise an item, or do nothing if it already exists.
 *
 * An item that was dismissed stays dismissed. Re-raising something I have
 * already read and decided about would make the whole thing noise.
 */
export async function raiseReviewItem(input: RaiseInput): Promise<void> {
  await prisma.reviewItem.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      kind: input.kind,
      severity: input.severity ?? 'WORTH_NOTICING',
      title: input.title,
      body: input.body,
      data: input.data,
      dedupeKey: input.dedupeKey,
    },
    update: {},
  });
}

export async function listOpenReviewItems(limit = 20) {
  return prisma.reviewItem.findMany({
    where: { dismissedAt: null },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}

export async function countOpenReviewItems(): Promise<number> {
  return prisma.reviewItem.count({ where: { dismissedAt: null } });
}

export async function dismissReviewItem(id: string): Promise<void> {
  await prisma.reviewItem.update({
    where: { id },
    data: { dismissedAt: new Date() },
  });
}

export async function dismissAllReviewItems(): Promise<number> {
  const result = await prisma.reviewItem.updateMany({
    where: { dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
  return result.count;
}

export const SEVERITY_LABEL: Record<ReviewItemSeverity, string> = {
  INFO: 'Worth knowing',
  WORTH_NOTICING: 'Worth noticing',
  NEEDS_ATTENTION: 'Needs attention',
};

export const KIND_LABEL: Record<ReviewItemKind, string> = {
  EMERGENCY_TRANSFER_OUT: 'Emergency',
  FUTURE_OPTIONS_TRANSFER_OUT: 'Future Options',
  POSSIBLE_LEAKAGE: 'Saver leakage',
  NEW_RECURRING_COST: 'Recurring cost',
  CATEGORY_RUNNING_HOT: 'Pace',
  EMERGENCY_TARGET_REACHED: 'Milestone',
  PHASE_CHANGED: 'Plan',
  WISHLIST_ITEM_FUNDED: 'Shopping',
  SYNC_PROBLEM: 'Sync',
  SETUP_INCOMPLETE: 'Setup',
};

/**
 * Protection, wired to the database.
 *
 * One row per kind, upserted by hand. A kind with no row reads as "not
 * recorded" everywhere — the health score, and the full-detail view below —
 * which is the honest state of something never entered, not a bug.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { PROTECTION_LABEL, type ProtectionKind } from '@/lib/domain/health';

const REVIEW_WINDOW_DAYS = 365;
export const PROTECTION_KINDS: ProtectionKind[] = ['DEATH', 'TPD', 'INCOME_PROTECTION', 'HEALTH', 'BENEFICIARY'];

export async function getProtectionInputs(
  now: Date = new Date(),
): Promise<Array<{ kind: ProtectionKind; recorded: boolean; reviewedRecently: boolean }>> {
  const rows = await prisma.protectionItem.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const cutoff = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000);

  return PROTECTION_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const recorded =
      row !== undefined &&
      (row.provider !== null || row.coverCents !== null || row.notes !== null || row.lastReviewed !== null);
    const reviewedRecently = row?.lastReviewed != null && row.lastReviewed >= cutoff;

    return { kind, recorded, reviewedRecently };
  });
}

export interface ProtectionItemView {
  kind: ProtectionKind;
  label: string;
  provider: string | null;
  coverCents: number | null;
  premiumCents: number | null;
  waitingPeriod: string | null;
  benefitPeriod: string | null;
  lastReviewed: Date | null;
  nextReview: Date | null;
  notes: string | null;
}

/** Every kind, always — a kind with no row yet comes back all-null, not omitted. */
export async function getProtectionItems(): Promise<ProtectionItemView[]> {
  const rows = await prisma.protectionItem.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  return PROTECTION_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      label: PROTECTION_LABEL[kind],
      provider: row?.provider ?? null,
      coverCents: row?.coverCents ?? null,
      premiumCents: row?.premiumCents ?? null,
      waitingPeriod: row?.waitingPeriod ?? null,
      benefitPeriod: row?.benefitPeriod ?? null,
      lastReviewed: row?.lastReviewed ?? null,
      nextReview: row?.nextReview ?? null,
      notes: row?.notes ?? null,
    };
  });
}

export async function saveProtectionItem(input: {
  kind: ProtectionKind;
  provider: string | null;
  coverCents: number | null;
  premiumCents: number | null;
  waitingPeriod: string | null;
  benefitPeriod: string | null;
  lastReviewed: Date | null;
  nextReview: Date | null;
  notes: string | null;
}): Promise<void> {
  const { kind, ...data } = input;
  await prisma.protectionItem.upsert({
    where: { kind },
    create: { kind, ...data },
    update: data,
  });
}

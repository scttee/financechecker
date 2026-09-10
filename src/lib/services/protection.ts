/**
 * Protection, wired to the database.
 *
 * Reads only, for now — feeding the health score's Protection dimension.
 * Manual entry (Group B) will let these rows actually be filled in; until
 * then every kind reads as "not recorded", which is the honest state of an
 * empty table, not a bug.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import type { ProtectionKind } from '@/lib/domain/health';

const REVIEW_WINDOW_DAYS = 365;

export async function getProtectionInputs(
  now: Date = new Date(),
): Promise<Array<{ kind: ProtectionKind; recorded: boolean; reviewedRecently: boolean }>> {
  const rows = await prisma.protectionItem.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const cutoff = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000);

  const kinds: ProtectionKind[] = ['DEATH', 'TPD', 'INCOME_PROTECTION', 'HEALTH', 'BENEFICIARY'];

  return kinds.map((kind) => {
    const row = byKind.get(kind);
    const recorded =
      row !== undefined &&
      (row.provider !== null || row.coverCents !== null || row.notes !== null || row.lastReviewed !== null);
    const reviewedRecently = row?.lastReviewed != null && row.lastReviewed >= cutoff;

    return { kind, recorded, reviewedRecently };
  });
}

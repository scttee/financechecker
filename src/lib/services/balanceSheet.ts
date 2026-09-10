/**
 * Balance sheet, wired to the database.
 *
 * Cash is every Up account balance, not just the discretionary subset used
 * for safe-to-spend — Emergency and Future Options are still cash sitting
 * in a bank account for net-worth purposes, just earmarked. Everything else
 * comes from ExternalAsset's manual snapshots.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { calculateBalanceSheet, type AssetLine, type BalanceSheet } from '@/lib/domain/balanceSheet';

/** Total across every Up account, regardless of role. */
export async function getTotalCashCents(): Promise<number> {
  const result = await prisma.account.aggregate({ _sum: { balanceCents: true } });
  return result._sum.balanceCents ?? 0;
}

/** The latest snapshot balance for each external asset, as of now. */
export async function getLatestAssetLines(): Promise<AssetLine[]> {
  const assets = await prisma.externalAsset.findMany({
    include: { snapshots: { orderBy: { takenAt: 'desc' }, take: 1 } },
  });

  return assets
    .filter((a) => a.snapshots.length > 0)
    .map((a) => ({ kind: a.kind, balanceCents: a.snapshots[0]!.balanceCents }));
}

export async function getBalanceSheet(): Promise<BalanceSheet> {
  const [cashCents, assets] = await Promise.all([getTotalCashCents(), getLatestAssetLines()]);
  return calculateBalanceSheet({ cashCents, assets });
}

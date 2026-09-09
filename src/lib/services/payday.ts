/**
 * Payday autopilot.
 *
 * When a salary lands, the app works out what the system says should happen
 * and compares it with what actually did. It does not, and will not, move any
 * money. Up's own Pay Splitting does that. This audits and explains.
 *
 * That separation is deliberate. An app that both decides and executes is one
 * bug away from moving money somewhere I did not intend, and no amount of
 * convenience is worth that.
 */

import 'server-only';

import type { AccountRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auditPayday, calculatePaydayAllocation, type PaydayAllocation, type PaydayAudit } from '@/lib/domain/allocation';
import { getAllocationPercents, getSettings } from './settings';

/** How long after a payday a transfer still counts as part of the split. */
const SPLIT_WINDOW_HOURS = 48;

export interface PaydayView {
  cycleId: string;
  startAt: Date;
  phase: 'PHASE_1' | 'PHASE_2';
  allocation: PaydayAllocation;
  audit: PaydayAudit;
  salaryDescription: string | null;
}

export async function getPaydayView(cycleId: string): Promise<PaydayView | null> {
  const settings = await getSettings();
  const cycle = await prisma.payCycle.findUnique({
    where: { id: cycleId },
    include: { allocations: true },
  });
  if (!cycle) return null;

  const percentages = await getAllocationPercents(cycle.phase);

  const allocation = calculatePaydayAllocation({
    incomeCents: cycle.incomeCents,
    rentCents: cycle.rentCents,
    phase: cycle.phase,
    percentages,
  });

  const observed = await observedTransfers(cycle.startAt);
  const trackedRoles = await mappedRoles();

  const audit = auditPayday({ allocation, observed, trackedRoles });

  const salary = cycle.salaryTransactionId
    ? await prisma.transaction.findUnique({ where: { id: cycle.salaryTransactionId } })
    : null;

  return {
    cycleId: cycle.id,
    startAt: cycle.startAt,
    phase: cycle.phase,
    allocation,
    audit,
    salaryDescription: salary?.description ?? null,
  };
}

/**
 * Net money that landed in each role's account in the window after payday.
 *
 * Only internal transfers count. A grocery refund arriving the same afternoon
 * is not part of the pay split and should not make the audit look better than
 * it is.
 *
 * Investing is the exception: it leaves Up entirely, so it is measured as
 * outbound spending tagged to the Investing role rather than as a transfer in.
 */
async function observedTransfers(
  paydayAt: Date,
): Promise<Array<{ role: AccountRole; observedCents: number }>> {
  const until = new Date(paydayAt.getTime() + SPLIT_WINDOW_HOURS * 3_600_000);

  const mappings = await prisma.accountRoleMapping.findMany();
  const roleByAccount = new Map(mappings.map((m) => [m.accountId, m.role]));

  const transfers = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: paydayAt, lte: until },
      isInternalTransfer: true,
      amountCents: { gt: 0 },
      deletedAt: null,
    },
  });

  const totals = new Map<AccountRole, number>();
  for (const tx of transfers) {
    const role = roleByAccount.get(tx.accountId);
    if (!role) continue;
    totals.set(role, (totals.get(role) ?? 0) + tx.amountCents);
  }

  const investing = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: paydayAt, lte: until },
      isInternalTransfer: false,
      role: 'INVESTING',
      amountCents: { lt: 0 },
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });

  const investedCents = Math.abs(investing._sum.amountCents ?? 0);
  if (investedCents > 0) {
    totals.set('INVESTING', (totals.get('INVESTING') ?? 0) + investedCents);
  }

  return [...totals.entries()].map(([role, observedCents]) => ({ role, observedCents }));
}

async function mappedRoles(): Promise<Set<AccountRole>> {
  const mappings = await prisma.accountRoleMapping.findMany({ select: { role: true } });
  const roles = new Set(mappings.map((m) => m.role));
  // Investing is verifiable through a merchant rule even with no Saver mapped
  // to it, because the money leaves Up as an ordinary payment.
  const hasInvestingRule = await prisma.merchantRule.count({
    where: { role: 'INVESTING', enabled: true },
  });
  if (hasInvestingRule > 0) roles.add('INVESTING');
  return roles;
}

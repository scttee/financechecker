/**
 * Financial admin, wired to the database.
 *
 * One row per kind, upserted by hand. Deliberately not a task manager: last
 * completed, next due, nothing else.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { ADMIN_LABEL, type AdminKind } from '@/lib/domain/health';

export const ADMIN_KINDS: AdminKind[] = [
  'TAX_RETURN',
  'SUPER_REVIEW',
  'INSURANCE_REVIEW',
  'BENEFICIARY_REVIEW',
  'RECURRING_COST_REVIEW',
  'ANNUAL_REVIEW',
];

export async function getAdminInputs(
  now: Date = new Date(),
): Promise<{ upToDateCount: number; totalCount: number }> {
  const rows = await prisma.adminItem.findMany();

  const upToDateCount = rows.filter(
    (r) => r.lastCompleted !== null && (r.nextDue === null || r.nextDue >= now),
  ).length;

  return { upToDateCount, totalCount: ADMIN_KINDS.length };
}

export interface AdminItemView {
  kind: AdminKind;
  label: string;
  lastCompleted: Date | null;
  nextDue: Date | null;
  notes: string | null;
  overdue: boolean;
}

export async function getAdminItems(now: Date = new Date()): Promise<AdminItemView[]> {
  const rows = await prisma.adminItem.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  return ADMIN_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const overdue = row?.nextDue != null && row.nextDue < now;
    return {
      kind,
      label: ADMIN_LABEL[kind],
      lastCompleted: row?.lastCompleted ?? null,
      nextDue: row?.nextDue ?? null,
      notes: row?.notes ?? null,
      overdue,
    };
  });
}

export async function saveAdminItem(input: {
  kind: AdminKind;
  lastCompleted: Date | null;
  nextDue: Date | null;
  notes: string | null;
}): Promise<void> {
  const { kind, ...data } = input;
  await prisma.adminItem.upsert({
    where: { kind },
    create: { kind, ...data },
    update: data,
  });
}

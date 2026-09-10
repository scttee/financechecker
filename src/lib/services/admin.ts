/**
 * Financial admin, wired to the database.
 *
 * Reads only, for now — feeding the health score's Admin dimension. Manual
 * entry (Group B) will let these rows actually be filled in.
 */

import 'server-only';

import { prisma } from '@/lib/db';

const TOTAL_ADMIN_KINDS = 6;

export async function getAdminInputs(
  now: Date = new Date(),
): Promise<{ upToDateCount: number; totalCount: number }> {
  const rows = await prisma.adminItem.findMany();

  const upToDateCount = rows.filter(
    (r) => r.lastCompleted !== null && (r.nextDue === null || r.nextDue >= now),
  ).length;

  return { upToDateCount, totalCount: TOTAL_ADMIN_KINDS };
}

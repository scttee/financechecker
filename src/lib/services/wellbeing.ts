/**
 * How money feels, wired to the database.
 *
 * A checkin whenever one is submitted — no reminder system, no forced
 * cadence, "quarterly" is a suggestion in the UI copy, not something
 * enforced here.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { compositeWellbeingScore, type WellbeingRatings } from '@/lib/domain/wellbeing';

export interface WellbeingCheckinView extends WellbeingRatings {
  id: string;
  takenAt: Date;
  notes: string | null;
  composite: number;
}

export async function getWellbeingHistory(take = 8): Promise<WellbeingCheckinView[]> {
  const rows = await prisma.wellbeingCheckin.findMany({ orderBy: { takenAt: 'desc' }, take });
  return rows.map((r) => ({
    id: r.id,
    takenAt: r.takenAt,
    notes: r.notes,
    control: r.control,
    security: r.security,
    freedom: r.freedom,
    confidence: r.confidence,
    shockAbsorption: r.shockAbsorption,
    enjoyment: r.enjoyment,
    composite: compositeWellbeingScore(r),
  }));
}

export async function getLatestWellbeing(): Promise<WellbeingCheckinView | null> {
  const [latest] = await getWellbeingHistory(1);
  return latest ?? null;
}

export async function saveWellbeingCheckin(
  input: WellbeingRatings & { notes: string | null },
): Promise<void> {
  await prisma.wellbeingCheckin.create({ data: input });
}

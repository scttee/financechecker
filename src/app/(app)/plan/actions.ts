'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/services/settings';
import { toDateInputValue } from '@/lib/time';
import { careerBreakSchema, shiftMonths } from '@/lib/domain/careerBreak';

export async function saveCareerBreakPlan(input: unknown): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  const parsed = careerBreakSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Check the date and amounts, then try again.' };
  const settings = await getSettings();
  const today = toDateInputValue(new Date(), settings.timezone);
  if (parsed.data.startDate < today || parsed.data.startDate > shiftMonths(today, 240)) {
    return { ok: false, message: 'Choose a start date within the next 20 years.' };
  }
  try {
    await prisma.careerBreakPlan.upsert({ where: { id: 'personal' }, create: { id: 'personal', ...parsed.data }, update: parsed.data });
    revalidatePath('/plan');
    return { ok: true, message: 'Plan saved. Your bank allocations are unchanged.' };
  } catch {
    return { ok: false, message: 'Your plan could not be saved. Keep this page open and try again.' };
  }
}

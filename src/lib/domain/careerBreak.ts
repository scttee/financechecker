import { z } from 'zod';

const money = z.number().int().min(0).max(100_000_000);
export const careerBreakSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Choose a valid start date.'),
  durationMonths: z.number().int().min(1).max(60),
  monthlyCostCents: money.refine((n) => n > 0, 'Enter your expected monthly costs.'),
  perCycleCents: money,
  upfrontCents: money,
  bufferMonths: z.number().int().min(0).max(24),
});
export type CareerBreakInputs = z.infer<typeof careerBreakSchema>;
export type Cadence = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
export interface CareerBreakContext {
  today: string;
  nextPayday: string;
  cadence: Cadence;
  balanceCents: number;
}
const DAY = 86_400_000;
function date(s: string) { return new Date(`${s}T00:00:00Z`); }
function iso(d: Date) { return d.toISOString().slice(0, 10); }
export function shiftMonths(s: string, months: number): string {
  const d = date(s);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0));
  return iso(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(d.getUTCDate(), end.getUTCDate()))));
}
export function paydayAt(first: string, cadence: Cadence, index: number): string {
  return cadence === 'MONTHLY' ? shiftMonths(first, index) : iso(new Date(date(first).getTime() + index * (cadence === 'WEEKLY' ? 7 : 14) * DAY));
}

/** Contributions stop before the break begins. Only Future Options funds this scenario. */
export function projectCareerBreak(input: CareerBreakInputs, context: CareerBreakContext) {
  careerBreakSchema.parse(input);
  if (input.startDate < context.today || input.startDate > shiftMonths(context.today, 240)) throw new Error('Choose a start date within the next 20 years.');
  const targetCents = input.monthlyCostCents * (input.durationMonths + input.bufferMonths) + input.upfrontCents;
  const balanceCents = Math.max(0, context.balanceCents);
  let cycles = 0;
  // Calendar cadence is anchored to the same payday; January 31 remains March 31.
  for (let i = 0; i < 20000; i++) {
    const payday = paydayAt(context.nextPayday, context.cadence, i);
    if (payday >= input.startDate) break;
    if (payday >= context.today) cycles++;
  }
  let earliestStartDate: string | null = balanceCents >= targetCents ? context.today : null;
  if (!earliestStartDate && input.perCycleCents > 0) {
    const cyclesNeeded = Math.ceil((targetCents - balanceCents) / input.perCycleCents);
    let received = 0;
    for (let i = 0; i < 20000; i++) {
      const payday = paydayAt(context.nextPayday, context.cadence, i);
      if (payday > shiftMonths(context.today, 240)) break;
      if (payday < context.today) continue;
      received++;
      if (received === cyclesNeeded) {
        earliestStartDate = iso(new Date(date(payday).getTime() + DAY));
        break;
      }
    }
  }
  const projectedCents = balanceCents + cycles * input.perCycleCents;
  const gapCents = Math.max(0, targetCents - projectedCents);
  const requiredPerCycleCents = cycles > 0 ? Math.ceil(Math.max(0, targetCents - balanceCents) / cycles) : null;
  const spendableCents = Math.max(0, projectedCents - input.upfrontCents - input.bufferMonths * input.monthlyCostCents);
  const fundedMonths = Math.floor(spendableCents / input.monthlyCostCents);
  const points = Array.from({ length: input.durationMonths + 1 }, (_, month) => ({
    month,
    date: shiftMonths(input.startDate, month),
    balanceCents: projectedCents - input.upfrontCents - month * input.monthlyCostCents,
  }));
  return { earliestStartDate, targetCents, projectedCents, gapCents, cycles, requiredPerCycleCents, fundedMonths, points,
    endBalanceCents: points[points.length - 1]!.balanceCents,
    bufferCents: input.bufferMonths * input.monthlyCostCents,
    extraPerCycleCents: requiredPerCycleCents === null ? null : Math.max(0, requiredPerCycleCents - input.perCycleCents),
  };
}

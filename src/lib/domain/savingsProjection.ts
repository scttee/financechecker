import { paydayAt, shiftMonths, type CareerBreakContext } from './careerBreak';

/** Contributions-only scenario. No compounding, debt repayment or everyday cash is implied. */
export function projectSavings(input: CareerBreakContext & { perCycleCents: number; extraPerCycleCents: number; months: number }) {
  if (![input.balanceCents, input.perCycleCents, input.extraPerCycleCents].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000)) throw new Error('Invalid projection amount');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 60) throw new Error('Choose a horizon of 1–60 months');
  const finalDate = shiftMonths(input.today, input.months);
  const paydays: string[] = [];
  for (let i = 0; i < 20000; i++) {
    const day = paydayAt(input.nextPayday, input.cadence, i);
    if (day > finalDate) break;
    if (day > input.today) paydays.push(day);
  }
  const points = Array.from({ length: input.months + 1 }, (_, month) => {
    const date = shiftMonths(input.today, month);
    const cycles = paydays.filter((day) => day <= date).length;
    return { month, date, cycles, baselineCents: input.balanceCents + cycles * input.perCycleCents,
      scenarioCents: input.balanceCents + cycles * (input.perCycleCents + input.extraPerCycleCents) };
  });
  const end = points[points.length - 1]!;
  return { points, ...end, extraSavedCents: end.scenarioCents - end.baselineCents, addedCents: end.scenarioCents - input.balanceCents };
}

import { describe, expect, it } from 'vitest';
import { careerBreakSchema, projectCareerBreak, shiftMonths, type CareerBreakInputs, type CareerBreakContext } from '../src/lib/domain/careerBreak';

const input: CareerBreakInputs = { startDate: '2027-01-01', durationMonths: 6, monthlyCostCents: 300_000, perCycleCents: 50_000, upfrontCents: 100_000, bufferMonths: 2 };
const context: CareerBreakContext = { today: '2026-09-11', nextPayday: '2026-09-18', cadence: 'FORTNIGHTLY', balanceCents: 1_000_000 };

describe('career break planning', () => {
  it('funds living costs, upfront costs and a separate return buffer', () => {
    const result = projectCareerBreak(input, context);
    expect(result.targetCents).toBe(2_500_000);
    expect(result.cycles).toBe(8);
    expect(result.projectedCents).toBe(1_400_000);
    expect(result.gapCents).toBe(1_100_000);
    expect(result.requiredPerCycleCents).toBe(187_500);
    expect(result.extraPerCycleCents).toBe(137_500);
    expect(result.fundedMonths).toBe(2);
    expect(result.endBalanceCents).toBe(-500_000);
  });
  it('finds the first funded start after the required payday', () => {
    const result = projectCareerBreak({ ...input, perCycleCents: 750_000 }, context);
    expect(result.earliestStartDate).toBe('2026-10-03');
    expect(projectCareerBreak({ ...input, perCycleCents: 0 }, context).earliestStartDate).toBeNull();
    expect(projectCareerBreak(input, { ...context, balanceCents: 3_000_000 }).earliestStartDate).toBe(context.today);
  });
  it('excludes salary on or after the start date', () => {
    expect(projectCareerBreak({ ...input, startDate: '2026-09-18' }, context).cycles).toBe(0);
    expect(projectCareerBreak({ ...input, startDate: '2026-09-19' }, context).cycles).toBe(1);
  });
  it('counts calendar monthly paydays and preserves month-end anchors', () => {
    expect(shiftMonths('2028-01-31', 1)).toBe('2028-02-29');
    const result = projectCareerBreak({ ...input, startDate: '2027-03-31' }, { ...context, nextPayday: '2027-01-31', cadence: 'MONTHLY' });
    expect(result.cycles).toBe(2);
  });
  it('does not count old paydays when the last cycle is stale', () => {
    const result = projectCareerBreak({ ...input, startDate: '2026-09-26' }, { ...context, nextPayday: '2026-08-28', cadence: 'WEEKLY' });
    expect(result.cycles).toBe(3);
  });
  it('handles zero contributions and no remaining paydays without infinity', () => {
    const result = projectCareerBreak({ ...input, startDate: context.today, perCycleCents: 0 }, context);
    expect(result.requiredPerCycleCents).toBeNull();
    expect(result.projectedCents).toBe(context.balanceCents);
    expect(result.extraPerCycleCents).toBeNull();
  });
  it('a funded break retains the exact chosen buffer', () => {
    const result = projectCareerBreak({ ...input, perCycleCents: 0 }, { ...context, balanceCents: 2_500_000 });
    expect(result.gapCents).toBe(0);
    expect(result.fundedMonths).toBe(6);
    expect(result.endBalanceCents).toBe(result.bufferCents);
  });
  it('treats a negative starting balance as no available funding', () => {
    expect(projectCareerBreak({ ...input, perCycleCents: 0 }, { ...context, balanceCents: -100 }).projectedCents).toBe(0);
  });
  it('rejects invalid dates, missing costs, fractions, negative and non-finite amounts', () => {
    for (const bad of [{ startDate: '2027-02-30' }, { monthlyCostCents: 0 }, { durationMonths: 1.5 }, { upfrontCents: -1 }, { perCycleCents: Infinity }]) {
      expect(careerBreakSchema.safeParse({ ...input, ...bad }).success).toBe(false);
    }
    expect(() => projectCareerBreak({ ...input, startDate: '2026-01-01' }, context)).toThrow();
    expect(() => projectCareerBreak({ ...input, startDate: '2099-01-01' }, context)).toThrow();
  });
  it('never adds contributions during the break and debits each month exactly once', () => {
    const result = projectCareerBreak(input, context);
    expect(result.points).toHaveLength(7);
    expect(result.points[0]!.balanceCents).toBe(result.projectedCents - input.upfrontCents);
    for (let i = 1; i < result.points.length; i++) expect(result.points[i - 1]!.balanceCents - result.points[i]!.balanceCents).toBe(input.monthlyCostCents);
  });
});

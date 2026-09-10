import { describe, expect, it } from 'vitest';
import { calculateRunway } from '@/lib/domain/runway';

describe('runway', () => {
  it('divides the funding balance by the monthly cost', () => {
    const result = calculateRunway({ fundingBalanceCents: 1_200_000, monthlyCostCents: 375_000 });
    expect(result.months).toBe(3.2);
  });

  it('is null, not infinite or NaN, when there is no cost history yet', () => {
    const result = calculateRunway({ fundingBalanceCents: 500_000, monthlyCostCents: 0 });
    expect(result.months).toBeNull();
  });

  it('floors at zero months for a zero or negative balance, never a negative runway', () => {
    const result = calculateRunway({ fundingBalanceCents: -10_000, monthlyCostCents: 200_000 });
    expect(result.months).toBe(0);
  });

  it('rounds to one decimal place', () => {
    const result = calculateRunway({ fundingBalanceCents: 100_000, monthlyCostCents: 30_000 });
    expect(result.months).toBe(3.3);
  });

  it('the same function produces different runways for different funding sources and cost bases', () => {
    const survival = calculateRunway({ fundingBalanceCents: 1_027_403, monthlyCostCents: 320_000 });
    const careerBreak = calculateRunway({ fundingBalanceCents: 500_000, monthlyCostCents: 320_000 });
    expect(survival.months).not.toBe(careerBreak.months);
    expect(survival.months! > careerBreak.months!).toBe(true);
  });
});

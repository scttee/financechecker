import { describe, expect, it } from 'vitest';
import { calculateFreedomRate } from '@/lib/domain/freedomRate';

describe('freedom rate', () => {
  it('is the share of net income going to future choice', () => {
    const result = calculateFreedomRate({ futureChoiceCents: 100_760, netIncomeCents: 438_031 });
    expect(result.pct).toBe(23);
  });

  it('is zero rather than dividing by zero when there is no income', () => {
    const result = calculateFreedomRate({ futureChoiceCents: 50_000, netIncomeCents: 0 });
    expect(result.pct).toBe(0);
  });

  it('rounds to one decimal place', () => {
    const result = calculateFreedomRate({ futureChoiceCents: 33_333, netIncomeCents: 100_000 });
    expect(result.pct).toBe(33.3);
  });

  it('can exceed 100% without breaking — a bonus pay redirected almost entirely to goals is real', () => {
    const result = calculateFreedomRate({ futureChoiceCents: 120_000, netIncomeCents: 100_000 });
    expect(result.pct).toBe(120);
  });
});

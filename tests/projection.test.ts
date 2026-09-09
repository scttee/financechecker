import { describe, expect, it } from 'vitest';
import { projectGoal } from '@/lib/domain/projection';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('goal projection', () => {
  it('is already reached when the balance already meets the target', () => {
    const result = projectGoal({
      currentCents: 1_200_000,
      targetCents: 1_200_000,
      perCycleCents: 50_000,
      now: NOW,
      cycleLengthDays: 14,
    });
    expect(result.remainingCents).toBe(0);
    expect(result.cyclesRemaining).toBe(0);
    expect(result.projectedDate).toEqual(NOW);
  });

  it('is already reached when the balance is past the target', () => {
    const result = projectGoal({
      currentCents: 1_300_000,
      targetCents: 1_200_000,
      perCycleCents: 50_000,
      now: NOW,
      cycleLengthDays: 14,
    });
    expect(result.remainingCents).toBe(0);
    expect(result.cyclesRemaining).toBe(0);
  });

  it('projects forward by whole cycles, rounding up so the target is never missed by a day', () => {
    // 100,000 remaining at 30,000/cycle needs 4 cycles (90,000 is short).
    const result = projectGoal({
      currentCents: 0,
      targetCents: 100_000,
      perCycleCents: 30_000,
      now: NOW,
      cycleLengthDays: 14,
    });
    expect(result.cyclesRemaining).toBe(4);
    expect(result.projectedDate).toEqual(new Date(NOW.getTime() + 4 * 14 * 86_400_000));
  });

  it('has no projected date when the current phase sends nothing to this role', () => {
    const result = projectGoal({
      currentCents: 500_000,
      targetCents: 1_200_000,
      perCycleCents: 0,
      now: NOW,
      cycleLengthDays: 14,
    });
    expect(result.cyclesRemaining).toBeNull();
    expect(result.projectedDate).toBeNull();
    // The shortfall is still a real, reportable number even with no ETA.
    expect(result.remainingCents).toBe(700_000);
  });

  it('respects the actual cycle length rather than assuming a fortnight', () => {
    const result = projectGoal({
      currentCents: 0,
      targetCents: 100_000,
      perCycleCents: 100_000,
      now: NOW,
      cycleLengthDays: 30,
    });
    expect(result.cyclesRemaining).toBe(1);
    expect(result.projectedDate).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
  });
});

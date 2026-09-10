import { describe, expect, it } from 'vitest';
import { computeFinancialHealth } from '@/lib/domain/health';
import { calculateSafeToSpend } from '@/lib/domain/safeToSpend';
import { categoryStatus, type CategoryLine } from '@/lib/domain/status';
import type { AccountRole } from '@prisma/client';

function line(
  role: AccountRole,
  allocatedCents: number,
  spentCents: number,
  elapsedPct = 50,
): CategoryLine {
  return categoryStatus({ role, allocatedCents, spentCents, elapsedPct });
}

function onTrackCategories(elapsedPct = 50): CategoryLine[] {
  return [
    line('BILLS', 36_484, 18_000, elapsedPct),
    line('GROCERIES', 33_443, 16_000, elapsedPct),
    line('DINING_SOCIAL', 24_322, 11_000, elapsedPct),
    line('FUN', 15_202, 7_000, elapsedPct),
    line('TRAVEL', 30_403, 0, elapsedPct),
    line('GEAR_OBJECTS', 15_202, 4_000, elapsedPct),
    line('EMERGENCY', 60_806, 0, elapsedPct),
    line('FUTURE_OPTIONS', 9_121, 0, elapsedPct),
  ];
}

describe('financial health', () => {
  it('scores full marks when every factor is clean', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    expect(health.status).toBe('READY');
    expect(health.score).toBe(100);
    expect(health.tier).toBe('THRIVING');
  });

  it('drops the pace factor when categories are running hot or spent, not the others', () => {
    const clean = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories: clean, daysRemaining: 7 });
    const baseline = computeFinancialHealth({
      categories: clean,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    const strained = clean.map((c) =>
      c.role === 'DINING_SOCIAL' ? line('DINING_SOCIAL', 24_322, 24_322, 50) : c,
    );
    const strainedSafeToSpend = calculateSafeToSpend({ categories: strained, daysRemaining: 7 });
    const withSpentCategory = computeFinancialHealth({
      categories: strained,
      safeToSpend: strainedSafeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    expect(withSpentCategory.score).toBeLessThan(baseline.score);
    const paceFactor = withSpentCategory.factors.find((f) => f.key === 'PACE')!;
    expect(paceFactor.score).toBeLessThan(100);
  });

  it('never counts protected or reserved categories against pace', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });
    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    const pace = health.factors.find((f) => f.key === 'PACE')!;
    // Emergency and Future Options are protected, Bills is reserved; the
    // remaining 5 discretionary-facing lines are what pace actually tracks.
    expect(pace.detail).toContain('5 of 5');
  });

  it('scores zero headroom when safe-to-spend would have gone negative', () => {
    const categories = onTrackCategories().map((c) =>
      c.role === 'DINING_SOCIAL' ? line('DINING_SOCIAL', 1_000, 50_000, 50) : c,
    );
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });
    expect(safeToSpend.flooredAtZero).toBe(true);

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    const headroom = health.factors.find((f) => f.key === 'HEADROOM')!;
    expect(headroom.score).toBe(0);
  });

  it('reflects Emergency coverage directly in its factor score', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const half = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 50,
      futureOptionsProgressPct: 100,
    });

    expect(half.factors.find((f) => f.key === 'EMERGENCY')!.score).toBe(50);
  });

  it('reflects Future Options coverage directly in its factor score, independent of Emergency', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 20,
    });

    const futureOptions = health.factors.find((f) => f.key === 'FUTURE_OPTIONS')!;
    expect(futureOptions.score).toBe(20);
    // A fully-funded Emergency does not mask a barely-started Future Options.
    expect(health.score).toBeLessThan(100);
  });

  it('weighs both goals, so the score reflects two goals rather than just one', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const onlyEmergency = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 0,
    });
    const both = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    expect(both.score).toBeGreaterThan(onlyEmergency.score);
  });

  it('answers "should I spend right now" from the same safe-to-spend figure, not a rival number', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    expect(health.spendingGuidance).toContain(
      `$${Math.round(safeToSpend.safeToSpendCents / 100)}`,
    );
  });

  it('tells you to hold off, calmly, when nothing discretionary is spare', () => {
    const spent = onTrackCategories(50).map((c) =>
      ['DINING_SOCIAL', 'FUN', 'GEAR_OBJECTS'].includes(c.role)
        ? line(c.role, c.allocatedCents, c.allocatedCents, 50)
        : c,
    );
    const safeToSpend = calculateSafeToSpend({ categories: spent, daysRemaining: 7 });
    expect(safeToSpend.safeToSpendCents).toBe(0);

    const health = computeFinancialHealth({
      categories: spent,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    expect(health.spendingGuidance.toLowerCase()).toContain('hold off');
    expect(health.spendingGuidance.toLowerCase()).not.toMatch(/bad|fail|overspent|warning/);
  });

  it('never produces a score outside 0-100', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 250, // over target is possible; the factor must still clamp
      futureOptionsProgressPct: -10, // defensive: never expect a negative progress figure either
    });

    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    for (const factor of health.factors) {
      expect(factor.score).toBeGreaterThanOrEqual(0);
      expect(factor.score).toBeLessThanOrEqual(100);
    }
  });

  it('weights sum to exactly 100%, so the score is never silently capped below 100', () => {
    const categories = onTrackCategories();
    const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });

    const health = computeFinancialHealth({
      categories,
      safeToSpend,
      emergencyProgressPct: 100,
      futureOptionsProgressPct: 100,
    });

    const totalWeight = health.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 5);
  });
});

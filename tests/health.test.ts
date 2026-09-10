import { describe, expect, it } from 'vitest';
import { computeFinancialHealth, type ProtectionKind } from '@/lib/domain/health';
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

const ALL_PROTECTION_KINDS: ProtectionKind[] = ['DEATH', 'TPD', 'INCOME_PROTECTION', 'HEALTH', 'BENEFICIARY'];

function perfectInput() {
  const categories = onTrackCategories();
  const safeToSpend = calculateSafeToSpend({ categories, daysRemaining: 7 });
  return {
    categories,
    safeToSpend,
    emergencyProgressPct: 100,
    futureOptionsProgressPct: 100,
    survivalRunwayMonths: 6,
    debtCents: 0,
    investedThisCycleCents: 50_000,
    plannedInvestingCents: 50_000,
    recentCyclesWithContribution: 3,
    freedomRatePct: 30,
    freedomRateTargetPct: 25,
    protectionItems: ALL_PROTECTION_KINDS.map((kind) => ({ kind, recorded: true, reviewedRecently: true })),
    adminUpToDateCount: 6,
    adminTotalCount: 6,
  };
}

describe('financial health v2', () => {
  it('scores a full 100 when every dimension is maxed', () => {
    const health = computeFinancialHealth(perfectInput());
    expect(health.status).toBe('READY');
    expect(health.scoreVersion).toBe(2);
    expect(health.score).toBe(100);
    expect(health.tier).toBe('THRIVING');
  });

  it('has exactly six dimensions whose max points sum to 100', () => {
    const health = computeFinancialHealth(perfectInput());
    expect(health.dimensions).toHaveLength(6);
    const totalMax = health.dimensions.reduce((sum, d) => sum + d.maxPoints, 0);
    expect(totalMax).toBe(100);
  });

  it('matches the suggested weighting: Cashflow/Resilience/Wealth Building 20 each, Optionality/Protection 15 each, Admin 10', () => {
    const health = computeFinancialHealth(perfectInput());
    const maxByKey = Object.fromEntries(health.dimensions.map((d) => [d.key, d.maxPoints]));
    expect(maxByKey).toEqual({
      CASHFLOW: 20,
      RESILIENCE: 20,
      WEALTH_BUILDING: 20,
      OPTIONALITY: 15,
      PROTECTION: 15,
      ADMIN: 10,
    });
  });

  it('every dimension is the sum of its own sub-factors', () => {
    const health = computeFinancialHealth(perfectInput());
    for (const d of health.dimensions) {
      const subTotal = Math.round(d.subFactors.reduce((sum, f) => sum + f.points, 0) * 10) / 10;
      expect(d.points).toBe(subTotal);
    }
  });

  it('Resilience: no tracked debt is worth +4, debt drops it to 0, all-or-nothing like the spec example', () => {
    const clean = computeFinancialHealth(perfectInput());
    const withDebt = computeFinancialHealth({ ...perfectInput(), debtCents: 50_000 });

    const cleanDebt = clean.dimensions.find((d) => d.key === 'RESILIENCE')!.subFactors.find((f) => f.key === 'NO_DEBT')!;
    const debtFactor = withDebt.dimensions.find((d) => d.key === 'RESILIENCE')!.subFactors.find((f) => f.key === 'NO_DEBT')!;

    expect(cleanDebt.points).toBe(4);
    expect(debtFactor.points).toBe(0);
    expect(withDebt.score).toBeLessThan(clean.score);
  });

  it('Resilience: survival runway scales toward the 3-month reference point and caps there', () => {
    const short = computeFinancialHealth({ ...perfectInput(), survivalRunwayMonths: 1.5 });
    const atTarget = computeFinancialHealth({ ...perfectInput(), survivalRunwayMonths: 3 });
    const wellPast = computeFinancialHealth({ ...perfectInput(), survivalRunwayMonths: 12 });

    const runwayPoints = (h: ReturnType<typeof computeFinancialHealth>) =>
      h.dimensions.find((d) => d.key === 'RESILIENCE')!.subFactors.find((f) => f.key === 'SURVIVAL_RUNWAY')!.points;

    expect(runwayPoints(short)).toBeLessThan(runwayPoints(atTarget));
    expect(runwayPoints(atTarget)).toBe(6);
    expect(runwayPoints(wellPast)).toBe(6); // capped, not unbounded
  });

  it('Resilience: with no spending history yet, survival runway is neutral rather than zero', () => {
    const health = computeFinancialHealth({ ...perfectInput(), survivalRunwayMonths: null });
    const runway = health.dimensions.find((d) => d.key === 'RESILIENCE')!.subFactors.find((f) => f.key === 'SURVIVAL_RUNWAY')!;
    expect(runway.points).toBeGreaterThan(0);
    expect(runway.points).toBeLessThan(6);
  });

  it('Wealth Building: reflects the actual investing rate, not just whether Future Options is funded', () => {
    const noInvesting = computeFinancialHealth({
      ...perfectInput(),
      investedThisCycleCents: 0,
      recentCyclesWithContribution: 0,
    });
    const full = computeFinancialHealth(perfectInput());

    expect(noInvesting.dimensions.find((d) => d.key === 'WEALTH_BUILDING')!.points).toBe(0);
    expect(full.dimensions.find((d) => d.key === 'WEALTH_BUILDING')!.points).toBe(20);
    expect(noInvesting.score).toBeLessThan(full.score);
  });

  it('Optionality: Future Options and Freedom Rate are independent sub-factors', () => {
    const health = computeFinancialHealth({
      ...perfectInput(),
      futureOptionsProgressPct: 100,
      freedomRatePct: 0,
    });
    const dim = health.dimensions.find((d) => d.key === 'OPTIONALITY')!;
    expect(dim.subFactors.find((f) => f.key === 'FUTURE_OPTIONS_FUNDED')!.points).toBe(10);
    expect(dim.subFactors.find((f) => f.key === 'FREEDOM_RATE')!.points).toBe(0);
  });

  it('Protection: each item is worth up to 3 — 2 for recorded, 1 more for reviewed within a year', () => {
    const health = computeFinancialHealth({
      ...perfectInput(),
      protectionItems: [
        { kind: 'DEATH', recorded: true, reviewedRecently: true },
        { kind: 'TPD', recorded: true, reviewedRecently: false },
        { kind: 'INCOME_PROTECTION', recorded: false, reviewedRecently: false },
      ],
    });
    const dim = health.dimensions.find((d) => d.key === 'PROTECTION')!;
    expect(dim.subFactors.find((f) => f.key === 'DEATH')!.points).toBe(3);
    expect(dim.subFactors.find((f) => f.key === 'TPD')!.points).toBe(2);
    expect(dim.subFactors.find((f) => f.key === 'INCOME_PROTECTION')!.points).toBe(0);
    // Untracked kinds (HEALTH, BENEFICIARY) still appear, scored zero — nothing silently disappears.
    expect(dim.subFactors).toHaveLength(5);
    expect(dim.subFactors.find((f) => f.key === 'HEALTH')!.points).toBe(0);
  });

  it('Protection never judges adequacy — a recorded-but-unreviewed item scores the same regardless of cover amount', () => {
    // The domain function is never given a cover amount to judge in the first
    // place; this just documents that recorded+unreviewed is worth 2 no
    // matter what, since there is no threshold to compare against.
    const health = computeFinancialHealth({
      ...perfectInput(),
      protectionItems: [{ kind: 'DEATH', recorded: true, reviewedRecently: false }],
    });
    const death = health.dimensions.find((d) => d.key === 'PROTECTION')!.subFactors.find((f) => f.key === 'DEATH')!;
    expect(death.points).toBe(2);
  });

  it('Admin is one line, not six — the ratio of items up to date', () => {
    const health = computeFinancialHealth({ ...perfectInput(), adminUpToDateCount: 3, adminTotalCount: 6 });
    const admin = health.dimensions.find((d) => d.key === 'ADMIN')!;
    expect(admin.subFactors).toHaveLength(1);
    expect(admin.points).toBe(5);
  });

  it('answers "should I spend right now" from the same safe-to-spend figure, not a rival number', () => {
    const input = perfectInput();
    const health = computeFinancialHealth(input);
    expect(health.spendingGuidance).toContain(
      `$${Math.round(input.safeToSpend.safeToSpendCents / 100)}`,
    );
  });

  it('never produces a score or a sub-factor outside its own bounds', () => {
    const health = computeFinancialHealth({
      ...perfectInput(),
      emergencyProgressPct: 250,
      futureOptionsProgressPct: -10,
      freedomRatePct: 500,
      recentCyclesWithContribution: 99,
      adminUpToDateCount: 99,
      adminTotalCount: 6,
    });

    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    for (const d of health.dimensions) {
      expect(d.points).toBeGreaterThanOrEqual(0);
      expect(d.points).toBeLessThanOrEqual(d.maxPoints);
      for (const f of d.subFactors) {
        expect(f.points).toBeGreaterThanOrEqual(0);
        expect(f.points).toBeLessThanOrEqual(f.maxPoints);
      }
    }
  });

  it('a market-style swing in isolation (freedom rate only) does not collapse the whole score', () => {
    // Resilience, Wealth Building and the rest stay put even if this one
    // behavioural input has a bad quarter — nothing here lets one number
    // dominate the read the way a raw balance delta could.
    const health = computeFinancialHealth({ ...perfectInput(), freedomRatePct: 0 });
    expect(health.score).toBeGreaterThanOrEqual(95); // loses only the 5-point Freedom Rate sub-factor
  });
});

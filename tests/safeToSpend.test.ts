import { describe, expect, it } from 'vitest';
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

/** A believable mid-cycle position from the Phase 1 split. */
function standardCategories(): CategoryLine[] {
  return [
    line('BILLS', 36_484, 20_000),
    line('HEALTH_THERAPY', 33_443, 22_000),
    line('GROCERIES', 33_443, 16_000),
    line('DINING_SOCIAL', 24_322, 18_400),
    line('FUN', 15_202, 6_000),
    line('TRANSPORT', 12_161, 5_000),
    line('TRAVEL', 30_403, 0),
    line('GEAR_OBJECTS', 15_202, 4_000),
    line('EMERGENCY', 60_806, 0),
    line('FUTURE_OPTIONS', 9_121, 0),
    line('BUFFER', 9_121, 0),
    line('INVESTING', 24_322, 24_322),
  ];
}

describe('safe to spend', () => {
  it('starts from the discretionary buckets only', () => {
    const result = calculateSafeToSpend({
      categories: standardCategories(),
      daysRemaining: 7,
    });

    // Dining 5,922 + Fun 9,202 + Gear 11,202 + Buffer 9,121
    expect(result.safeToSpendCents).toBe(5_922 + 9_202 + 11_202 + 9_121);
  });

  it('never counts protected money', () => {
    const withHugeEmergency = standardCategories().map((c) =>
      c.role === 'EMERGENCY' ? line('EMERGENCY', 5_000_000, 0) : c,
    );

    const before = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    const after = calculateSafeToSpend({ categories: withHugeEmergency, daysRemaining: 7 });

    expect(after.safeToSpendCents).toBe(before.safeToSpendCents);
    expect(after.exclusions.some((e) => e.role === 'EMERGENCY')).toBe(true);
    expect(after.exclusions.some((e) => e.role === 'FUTURE_OPTIONS')).toBe(true);
  });

  it('excludes Travel with a reason that says Travel is for travel', () => {
    const result = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    const travel = result.exclusions.find((e) => e.role === 'TRAVEL');
    expect(travel).toBeDefined();
    expect(travel?.reason).toContain('Travel is for travel');
  });

  it('treats rent and bills money as already spoken for', () => {
    const result = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    expect(result.discretionaryRoles).not.toContain('BILLS');
    expect(result.exclusions.some((e) => e.role === 'BILLS')).toBe(true);
  });

  it('subtracts an essential that has gone past its allocation', () => {
    const overspentGroceries = standardCategories().map((c) =>
      c.role === 'GROCERIES' ? line('GROCERIES', 33_443, 40_000) : c,
    );

    const before = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    const after = calculateSafeToSpend({ categories: overspentGroceries, daysRemaining: 7 });

    expect(after.safeToSpendCents).toBe(before.safeToSpendCents - (40_000 - 33_443));
    expect(after.breakdown.some((b) => b.label === 'Essential shortfalls')).toBe(true);
  });

  it('carries a discretionary overspend through rather than hiding it', () => {
    const overspentDining = standardCategories().map((c) =>
      c.role === 'DINING_SOCIAL' ? line('DINING_SOCIAL', 24_322, 30_000) : c,
    );
    const result = calculateSafeToSpend({ categories: overspentDining, daysRemaining: 7 });

    // Fun 9,202 + Gear 11,202 + Buffer 9,121 minus the 5,678 Dining overshoot.
    expect(result.safeToSpendCents).toBe(9_202 + 11_202 + 9_121 - 5_678);
  });

  it('holds back commitments landing before payday that their bucket cannot cover', () => {
    const result = calculateSafeToSpend({
      categories: standardCategories(),
      daysRemaining: 7,
      upcomingCommitments: [
        {
          id: 'c1',
          label: 'Aussie Broadband',
          amountCents: 9_500,
          dueAt: new Date(),
          role: 'BILLS',
        },
      ],
    });

    // Bills still holds 16,484, so the broadband bill costs discretionary
    // spending nothing.
    const baseline = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    expect(result.safeToSpendCents).toBe(baseline.safeToSpendCents);
  });

  it('holds back the part of a commitment its bucket cannot cover', () => {
    const drainedBills = standardCategories().map((c) =>
      c.role === 'BILLS' ? line('BILLS', 36_484, 34_484) : c,
    );

    const result = calculateSafeToSpend({
      categories: drainedBills,
      daysRemaining: 7,
      upcomingCommitments: [
        { id: 'c1', label: 'Aussie Broadband', amountCents: 9_500, dueAt: new Date(), role: 'BILLS' },
      ],
    });

    const baseline = calculateSafeToSpend({ categories: drainedBills, daysRemaining: 7 });
    // Bills covers 2,000 of the 9,500, so 7,500 comes off.
    expect(baseline.safeToSpendCents - result.safeToSpendCents).toBe(7_500);
  });

  it('never returns a negative amount', () => {
    const allSpent = standardCategories().map((c) =>
      line(c.role, c.allocatedCents, c.allocatedCents * 3),
    );
    const result = calculateSafeToSpend({ categories: allSpent, daysRemaining: 5 });

    expect(result.safeToSpendCents).toBe(0);
    expect(result.flooredAtZero).toBe(true);
    expect(result.perDayCents).toBe(0);
  });

  it('caps at money that actually exists', () => {
    const result = calculateSafeToSpend({
      categories: standardCategories(),
      daysRemaining: 7,
      liquidBalanceCents: 5_000,
    });

    expect(result.safeToSpendCents).toBe(5_000);
    expect(result.cappedByBalance).toBe(true);
    expect(result.breakdown.some((b) => b.kind === 'CAP')).toBe(true);
  });

  it('gives a per-day pace that is a floor, not a rounded-up allowance', () => {
    const result = calculateSafeToSpend({
      categories: [line('BUFFER', 10_000, 0)],
      daysRemaining: 6,
      discretionaryRoles: ['BUFFER'],
    });
    // 10,000 / 6 = 1666.67, floored to 1666.
    expect(result.perDayCents).toBe(1_666);
  });

  it('shows its working, ending with the result', () => {
    const result = calculateSafeToSpend({ categories: standardCategories(), daysRemaining: 7 });
    const last = result.breakdown[result.breakdown.length - 1]!;

    expect(last.kind).toBe('RESULT');
    expect(last.runningCents).toBe(result.safeToSpendCents);
    expect(result.breakdown.every((b) => b.detail.length > 0)).toBe(true);
  });

  it('says so plainly when nothing has been mapped yet', () => {
    const result = calculateSafeToSpend({ categories: [], daysRemaining: 7 });
    expect(result.safeToSpendCents).toBe(0);
    expect(result.breakdown[0]!.detail).toContain('Map your Up accounts');
  });
});

describe('category status', () => {
  it('is on track when spending roughly tracks the clock', () => {
    expect(line('DINING_SOCIAL', 24_300, 12_000, 50).status).toBe('ON_TRACK');
  });

  it('is running hot when spending is materially ahead of the clock', () => {
    // The example from the brief: 76% used, 35% elapsed.
    const dining = line('DINING_SOCIAL', 24_300, 18_400, 35);
    expect(dining.status).toBe('RUNNING_HOT');
    expect(dining.spentPct).toBe(76);
    expect(dining.remainingCents).toBe(5_900);
  });

  it('gives essentials extra room before saying anything', () => {
    // Same shape as the dining case, but groceries. A big shop early in the
    // fortnight is a big shop, not a problem.
    const groceries = categoryStatus({
      role: 'GROCERIES',
      allocatedCents: 33_443,
      spentCents: 20_000,
      elapsedPct: 40,
    });
    expect(groceries.status).toBe('ON_TRACK');

    const dining = categoryStatus({
      role: 'DINING_SOCIAL',
      allocatedCents: 33_443,
      spentCents: 20_000,
      elapsedPct: 40,
    });
    expect(dining.status).toBe('RUNNING_HOT');
  });

  it('is near limit when little is left', () => {
    expect(line('FUN', 15_202, 14_000, 50).status).toBe('NEAR_LIMIT');
  });

  it('is spent when nothing is left', () => {
    expect(line('GEAR_OBJECTS', 15_202, 15_202, 50).status).toBe('SPENT');
    expect(line('GEAR_OBJECTS', 15_202, 20_000, 50).status).toBe('SPENT');
  });

  it('marks protected buckets as protected rather than judging their pace', () => {
    expect(line('EMERGENCY', 60_806, 0, 90).status).toBe('PROTECTED');
    expect(line('FUTURE_OPTIONS', 9_121, 0, 90).status).toBe('PROTECTED');
  });

  it('marks reserved buckets as reserved', () => {
    expect(line('RENT', 134_000, 134_000, 50).status).toBe('RESERVED');
    expect(line('BILLS', 36_484, 36_484, 50).status).toBe('RESERVED');
  });

  it('explains itself in plain language, without calling anything bad', () => {
    const hot = line('DINING_SOCIAL', 24_300, 18_400, 35);
    expect(hot.explanation).toContain('ahead of the clock');
    expect(hot.explanation.toLowerCase()).not.toContain('overspent');
    expect(hot.explanation.toLowerCase()).not.toContain('bad');
    expect(hot.explanation.toLowerCase()).not.toContain('warning');
  });
});

import { describe, expect, it } from 'vitest';
import { calculateBalanceSheet, type AssetLine } from '@/lib/domain/balanceSheet';

function assets(): AssetLine[] {
  return [
    { kind: 'SUPER', balanceCents: 4_500_000 },
    { kind: 'INVESTMENT', balanceCents: 1_200_000 },
    { kind: 'DEBT', balanceCents: 300_000 },
  ];
}

describe('balance sheet', () => {
  it('sums cash plus every asset kind, minus debt, for net financial assets', () => {
    const result = calculateBalanceSheet({ cashCents: 1_000_000, assets: assets() });
    // 1,000,000 cash + 4,500,000 super + 1,200,000 investments - 300,000 debt
    expect(result.netFinancialAssetsCents).toBe(1_000_000 + 4_500_000 + 1_200_000 - 300_000);
  });

  it('excludes super from accessible financial assets', () => {
    const result = calculateBalanceSheet({ cashCents: 1_000_000, assets: assets() });
    expect(result.accessibleFinancialAssetsCents).toBe(1_000_000 + 1_200_000 - 300_000);
    expect(result.accessibleFinancialAssetsCents).toBeLessThan(result.netFinancialAssetsCents);
  });

  it('stores debt positive and subtracts it, never adds a negative balance', () => {
    const result = calculateBalanceSheet({
      cashCents: 500_000,
      assets: [{ kind: 'DEBT', balanceCents: 200_000 }],
    });
    expect(result.debtCents).toBe(200_000);
    expect(result.netFinancialAssetsCents).toBe(300_000);
  });

  it('with no external assets at all, net and accessible both equal cash', () => {
    const result = calculateBalanceSheet({ cashCents: 750_000, assets: [] });
    expect(result.netFinancialAssetsCents).toBe(750_000);
    expect(result.accessibleFinancialAssetsCents).toBe(750_000);
  });

  it('OTHER assets count toward both net and accessible', () => {
    const result = calculateBalanceSheet({
      cashCents: 0,
      assets: [{ kind: 'OTHER', balanceCents: 100_000 }],
    });
    expect(result.netFinancialAssetsCents).toBe(100_000);
    expect(result.accessibleFinancialAssetsCents).toBe(100_000);
  });
});

import { describe, expect, it } from 'vitest';
import {
  allocateByBasisPoints,
  applyBasisPoints,
  assertCents,
  formatCents,
  MoneyError,
  parseDecimalToCents,
  percentOf,
} from '@/lib/money';

describe('parseDecimalToCents', () => {
  it('parses the values Up sends', () => {
    expect(parseDecimalToCents('10.56')).toBe(1056);
    expect(parseDecimalToCents('-1340.00')).toBe(-134000);
    expect(parseDecimalToCents('4380.31')).toBe(438031);
    expect(parseDecimalToCents('0.00')).toBe(0);
  });

  it('handles the shapes a pasted price arrives in', () => {
    expect(parseDecimalToCents('$1,340.00')).toBe(134000);
    expect(parseDecimalToCents(' 129 ')).toBe(12900);
    expect(parseDecimalToCents('.5')).toBe(50);
  });

  it('rounds half away from zero rather than trusting float maths', () => {
    // The float route gives 100.49999999999999 for this, and rounds down.
    expect(parseDecimalToCents('1.005')).toBe(101);
    expect(parseDecimalToCents('-1.005')).toBe(-101);
    expect(parseDecimalToCents('2.674')).toBe(267);
    expect(parseDecimalToCents('2.675')).toBe(268);
  });

  it('refuses rubbish rather than guessing', () => {
    expect(() => parseDecimalToCents('')).toThrow(MoneyError);
    expect(() => parseDecimalToCents('abc')).toThrow(MoneyError);
    expect(() => parseDecimalToCents('1.2.3')).toThrow(MoneyError);
  });
});

describe('assertCents', () => {
  it('rejects anything that is not a whole number of cents', () => {
    expect(() => assertCents(10.5)).toThrow(MoneyError);
    expect(() => assertCents(Number.NaN)).toThrow(MoneyError);
    expect(assertCents(-134000)).toBe(-134000);
  });
});

describe('allocateByBasisPoints', () => {
  it('distributes without inventing or losing a cent', () => {
    const result = allocateByBasisPoints(304031, [
      { key: 'a', basisPoints: 1200 },
      { key: 'b', basisPoints: 1100 },
      { key: 'c', basisPoints: 1100 },
      { key: 'd', basisPoints: 800 },
      { key: 'e', basisPoints: 500 },
      { key: 'f', basisPoints: 400 },
      { key: 'g', basisPoints: 1000 },
      { key: 'h', basisPoints: 500 },
      { key: 'i', basisPoints: 2000 },
      { key: 'j', basisPoints: 800 },
      { key: 'k', basisPoints: 300 },
      { key: 'l', basisPoints: 300 },
    ]);

    const total = result.reduce((acc, r) => acc + r.cents, 0);
    expect(total).toBe(304031);
    expect(result.every((r) => Number.isInteger(r.cents))).toBe(true);
  });

  it('is deterministic across runs', () => {
    const weights = [
      { key: 'x', basisPoints: 3333 },
      { key: 'y', basisPoints: 3333 },
      { key: 'z', basisPoints: 3334 },
    ];
    const a = allocateByBasisPoints(100, weights);
    const b = allocateByBasisPoints(100, weights);
    expect(a).toEqual(b);
    expect(a.reduce((acc, r) => acc + r.cents, 0)).toBe(100);
  });

  it('handles a total of one cent across three buckets', () => {
    const result = allocateByBasisPoints(1, [
      { key: 'a', basisPoints: 3333 },
      { key: 'b', basisPoints: 3333 },
      { key: 'c', basisPoints: 3334 },
    ]);
    expect(result.reduce((acc, r) => acc + r.cents, 0)).toBe(1);
  });

  it('gives everything to nobody when all weights are zero', () => {
    const result = allocateByBasisPoints(5000, [{ key: 'a', basisPoints: 0 }]);
    expect(result[0]!.cents).toBe(0);
  });
});

describe('applyBasisPoints', () => {
  it('takes a percentage of post-rent income', () => {
    // 12% of $3,040.31
    expect(applyBasisPoints(304031, 1200)).toBe(36484);
    // 17% of $3,040.31
    expect(applyBasisPoints(304031, 1700)).toBe(51685);
  });
});

describe('formatCents', () => {
  it('formats Australian dollars', () => {
    expect(formatCents(438031)).toBe('$4,380.31');
    expect(formatCents(1200000, { showCents: false })).toBe('$12,000');
    expect(formatCents(-2850)).toBe('-$28.50');
  });
});

describe('percentOf', () => {
  it('does not divide by zero', () => {
    expect(percentOf(100, 0)).toBe(0);
    expect(percentOf(18400, 24300)).toBe(76);
  });
});

import { describe, expect, it } from 'vitest';
import { projectSavings } from '../src/lib/domain/savingsProjection';
const base = { today:'2026-09-11', nextPayday:'2026-09-18', cadence:'FORTNIGHTLY' as const, balanceCents:1_000_000, perCycleCents:50_000, extraPerCycleCents:5_000, months:12 };
describe('savings outlook', () => {
  it('adds contributions once and compares only extra saving', () => {
    const r = projectSavings(base);
    expect(r.cycles).toBe(26);
    expect(r.baselineCents).toBe(2_300_000);
    expect(r.scenarioCents).toBe(2_430_000);
    expect(r.extraSavedCents).toBe(130_000);
    expect(r.points[0]!.baselineCents).toBe(base.balanceCents);
  });
  it('does not invent growth when no contributions are made', () => {
    const r = projectSavings({...base, perCycleCents:0, extraPerCycleCents:0, months:60});
    expect(r.scenarioCents).toBe(base.balanceCents);
  });
  it('zero extra saving exactly follows the baseline', () => {
    const r = projectSavings({...base, extraPerCycleCents:0});
    expect(r.points.every((p) => p.scenarioCents === p.baselineCents)).toBe(true);
  });
  it('handles monthly month-end cadence, and excludes already-held money today', () => {
    const r = projectSavings({...base, today:'2027-01-31',nextPayday:'2027-01-31',cadence:'MONTHLY',months:2});
    expect(r.cycles).toBe(2);
    expect(r.points[0]!.cycles).toBe(0);
    expect(r.points[1]!.cycles).toBe(1);
  });
  it('rejects unbounded horizons, negative or invalid money', () => {
    for (const values of [{months:0},{months:61},{months:1.5},{extraPerCycleCents:-1},{perCycleCents:NaN}]) expect(() => projectSavings({...base,...values})).toThrow();
  });
});

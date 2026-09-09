/**
 * Regression tests for defects found in code review.
 *
 * Each of these was a real bug in a shipped commit. They are here so the same
 * mistake cannot come back quietly.
 */

import { describe, expect, it } from 'vitest';
import { countsAsLiquid } from '@/lib/domain/roles';

describe('the safe-to-spend ceiling fails closed', () => {
  // The original filter used optional chaining: `!a.mapping?.isProtected`.
  // For an unmapped account that reads `!undefined`, which is true, so an
  // Emergency Saver that had not been mapped yet counted as spendable money
  // and raised the ceiling on the most prominent figure in the app.
  it('excludes an account with no mapping at all', () => {
    expect(countsAsLiquid(null)).toBe(false);
    expect(countsAsLiquid(undefined)).toBe(false);
  });

  it('excludes protected accounts', () => {
    expect(countsAsLiquid({ role: 'EMERGENCY', isProtected: true })).toBe(false);
    expect(countsAsLiquid({ role: 'FUTURE_OPTIONS', isProtected: true })).toBe(false);
  });

  it('excludes Travel even though it is not protected', () => {
    expect(countsAsLiquid({ role: 'TRAVEL', isProtected: false })).toBe(false);
  });

  it('includes everyday accounts', () => {
    expect(countsAsLiquid({ role: 'SPENDING', isProtected: false })).toBe(true);
    expect(countsAsLiquid({ role: 'DINING_SOCIAL', isProtected: false })).toBe(true);
    expect(countsAsLiquid({ role: 'GEAR_OBJECTS', isProtected: false })).toBe(true);
    expect(countsAsLiquid({ role: 'BUFFER', isProtected: false })).toBe(true);
  });

  it('respects an explicit protection override on any role', () => {
    // Protection is per account in Settings, not fixed by the role.
    expect(countsAsLiquid({ role: 'BUFFER', isProtected: true })).toBe(false);
  });

  it('never counts an unmapped account, whatever its role would have been', () => {
    // The whole point: without a mapping there is no role to reason about.
    const unmapped = [null, undefined] as const;
    for (const mapping of unmapped) {
      expect(countsAsLiquid(mapping)).toBe(false);
    }
  });
});

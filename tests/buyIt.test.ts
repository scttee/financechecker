import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAIT_TIERS,
  decideBuyIt,
  isHigherPriority,
  requiredWaitHours,
  type CandidateItem,
  type OutstandingItem,
} from '@/lib/domain/buyIt';

const NOW = new Date('2026-09-09T10:00:00+10:00');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function item(partial: Partial<CandidateItem> = {}): CandidateItem {
  return {
    id: 'item-1',
    name: 'Aeros Down Pillow',
    priceCents: 12_900,
    priority: 'WANT',
    role: 'GEAR_OBJECTS',
    addedAt: daysAgo(30),
    ...partial,
  };
}

describe('waiting periods', () => {
  it('applies no wait under $50', () => {
    expect(requiredWaitHours(4_999).hours).toBe(0);
  });

  it('applies 72 hours from $50 to $200', () => {
    expect(requiredWaitHours(5_000).hours).toBe(72);
    expect(requiredWaitHours(12_900).hours).toBe(72);
    expect(requiredWaitHours(20_000).hours).toBe(72);
  });

  it('applies 14 days from $200 to $500', () => {
    expect(requiredWaitHours(20_001).hours).toBe(336);
    expect(requiredWaitHours(50_000).hours).toBe(336);
  });

  it('applies 30 days over $500', () => {
    expect(requiredWaitHours(50_001).hours).toBe(720);
    expect(requiredWaitHours(250_000).hours).toBe(720);
  });

  it('reads the tiers from settings rather than from code', () => {
    const strict = { ...DEFAULT_WAIT_TIERS, tier2Hours: 168 };
    expect(requiredWaitHours(12_900, strict).hours).toBe(168);
  });
});

describe('the decision', () => {
  it('says BUY when the Saver covers it, the wait has passed and nothing outranks it', () => {
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 17_800,
      outstanding: [],
      now: NOW,
    });

    expect(decision.verdict).toBe('BUY');
    expect(decision.balanceAfterCents).toBe(4_900);
    expect(decision.checks.every((c) => c.outcome === 'PASS')).toBe(true);
  });

  it('says NOT FUNDED when the correct Saver cannot cover the whole cost', () => {
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 8_000,
      outstanding: [],
      now: NOW,
    });

    expect(decision.verdict).toBe('NOT_FUNDED');
    expect(decision.shortfallCents).toBe(4_900);
    expect(decision.summary).toContain('not yet');
  });

  it('refuses to suggest protected money to close the gap', () => {
    const decision = decideBuyIt({
      item: item({ priceCents: 50_000 }),
      saverBalanceCents: 10_000,
      outstanding: [],
      now: NOW,
    });

    const protectedCheck = decision.checks.find((c) => c.key === 'protected')!;
    expect(protectedCheck.outcome).toBe('FAIL');
    expect(protectedCheck.detail).toContain('Emergency');
    expect(protectedCheck.detail).toContain('Travel');
    expect(protectedCheck.detail).toContain('Future Options');
    // It names them as unavailable, and never as a way to fund the purchase.
    expect(protectedCheck.detail).toContain('None of those are available for this');
  });

  it('says WAIT when the waiting period has not passed, however affordable it is', () => {
    const decision = decideBuyIt({
      item: item({ addedAt: daysAgo(1) }),
      saverBalanceCents: 500_000,
      outstanding: [],
      now: NOW,
    });

    expect(decision.verdict).toBe('WAIT');
    expect(decision.waitRequiredHours).toBe(72);
    expect(decision.waitElapsedHours).toBe(24);
  });

  it('does not let a sale shorten the waiting period', () => {
    // There is no discount input to this engine at all, which is the point.
    // A cheaper price only ever moves the item into a shorter tier on merit.
    const full = decideBuyIt({
      item: item({ priceCents: 30_000, addedAt: daysAgo(3) }),
      saverBalanceCents: 100_000,
      outstanding: [],
      now: NOW,
    });
    expect(full.verdict).toBe('WAIT');
    expect(full.waitRequiredHours).toBe(336);
  });

  it('says NEEDS INFORMATION when there is no price', () => {
    const decision = decideBuyIt({
      item: item({ priceCents: null }),
      saverBalanceCents: 50_000,
      outstanding: [],
      now: NOW,
    });

    expect(decision.verdict).toBe('NEEDS_INFORMATION');
    expect(decision.checks[0]!.outcome).toBe('UNKNOWN');
  });

  it('puts NOT FUNDED ahead of WAIT when both apply', () => {
    const decision = decideBuyIt({
      item: item({ addedAt: daysAgo(1) }),
      saverBalanceCents: 1_000,
      outstanding: [],
      now: NOW,
    });
    expect(decision.verdict).toBe('NOT_FUNDED');
  });
});

describe('higher-priority purchases', () => {
  const cargoBibs: OutstandingItem = {
    id: 'bibs',
    name: 'Cargo bibs',
    priceCents: 15_000,
    priority: 'REPLACEMENT',
    role: 'GEAR_OBJECTS',
  };

  it('says WAIT when the purchase would put a higher-priority item out of reach', () => {
    // The worked example: pillow $129, Gear $178, cargo bibs outstanding.
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 17_800,
      outstanding: [cargoBibs],
      now: NOW,
    });

    expect(decision.verdict).toBe('WAIT');
    expect(decision.blockingItem?.name).toBe('Cargo bibs');
    expect(decision.summary).toContain('$49');
    expect(decision.summary).toContain('Cargo bibs');
  });

  it('says BUY when the higher-priority item is still affordable afterwards', () => {
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 40_000,
      outstanding: [cargoBibs],
      now: NOW,
    });

    expect(decision.verdict).toBe('BUY');
    expect(decision.blockingItem).toBeNull();
  });

  it('does not deadlock behind something that was never affordable', () => {
    // A $900 item outranks everything and cannot be funded either way.
    // Blocking on it would freeze the entire list indefinitely.
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 17_800,
      outstanding: [
        { id: 'tent', name: 'Durston tent', priceCents: 90_000, priority: 'NEED', role: 'GEAR_OBJECTS' },
      ],
      now: NOW,
    });

    expect(decision.verdict).toBe('BUY');
    const check = decision.checks.find((c) => c.key === 'priority')!;
    expect(check.outcome).toBe('INFO');
    expect(check.detail).toContain('does not change their position');
  });

  it('ignores lower-priority items entirely', () => {
    const decision = decideBuyIt({
      item: item({ priority: 'REPLACEMENT' }),
      saverBalanceCents: 17_800,
      outstanding: [
        { id: 'spork', name: 'Spork', priceCents: 15_000, priority: 'WANT', role: 'GEAR_OBJECTS' },
      ],
      now: NOW,
    });
    expect(decision.verdict).toBe('BUY');
  });

  it('ignores items funded from a different Saver', () => {
    const decision = decideBuyIt({
      item: item(),
      saverBalanceCents: 17_800,
      outstanding: [{ ...cargoBibs, role: 'TRAVEL' }],
      now: NOW,
    });
    expect(decision.verdict).toBe('BUY');
  });

  it('orders the priorities correctly', () => {
    expect(isHigherPriority('SAFETY_REPLACEMENT', 'REPLACEMENT')).toBe(true);
    expect(isHigherPriority('REPLACEMENT', 'NEED')).toBe(true);
    expect(isHigherPriority('NEED', 'USEFUL_UPGRADE')).toBe(true);
    expect(isHigherPriority('USEFUL_UPGRADE', 'WANT')).toBe(true);
    expect(isHigherPriority('WANT', 'FUTURE_DECISION')).toBe(true);
    expect(isHigherPriority('WANT', 'NEED')).toBe(false);
    expect(isHigherPriority('WANT', 'WANT')).toBe(false);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same inputs, every time', () => {
    const input = {
      item: item(),
      saverBalanceCents: 17_800,
      outstanding: [
        { id: 'bibs', name: 'Cargo bibs', priceCents: 15_000, priority: 'REPLACEMENT' as const, role: 'GEAR_OBJECTS' as const },
      ],
      now: NOW,
    };

    const a = decideBuyIt(input);
    const b = decideBuyIt(input);
    expect(a.verdict).toBe(b.verdict);
    expect(a.summary).toBe(b.summary);
    expect(a.checks).toEqual(b.checks);
  });

  it('returns a full set of checks whatever the verdict', () => {
    const verdicts = [
      decideBuyIt({ item: item(), saverBalanceCents: 17_800, outstanding: [], now: NOW }),
      decideBuyIt({ item: item(), saverBalanceCents: 100, outstanding: [], now: NOW }),
      decideBuyIt({ item: item({ addedAt: NOW }), saverBalanceCents: 17_800, outstanding: [], now: NOW }),
    ];
    for (const decision of verdicts) {
      expect(decision.checks.length).toBeGreaterThanOrEqual(4);
      expect(decision.checks.every((c) => c.detail.length > 0)).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECURRING_SETTINGS,
  detectRecurring,
  expectedBefore,
  normaliseMerchant,
  totalMonthlyCommitment,
  type RecurringInputTransaction,
} from '@/lib/domain/recurring';

const NOW = new Date('2026-09-09T10:00:00+10:00');

function charges(input: {
  description: string;
  cents: number;
  intervalDays: number;
  count: number;
  /** Days of wobble either side of the interval. */
  jitterDays?: number;
  amountJitterCents?: number;
  startDaysAgo?: number;
}): RecurringInputTransaction[] {
  const { description, cents, intervalDays, count, jitterDays = 0, amountJitterCents = 0 } = input;
  const start = input.startDaysAgo ?? intervalDays * count;
  const out: RecurringInputTransaction[] = [];
  for (let i = 0; i < count; i += 1) {
    const wobble = jitterDays === 0 ? 0 : ((i % 3) - 1) * jitterDays;
    const amountWobble = amountJitterCents === 0 ? 0 : ((i % 3) - 1) * amountJitterCents;
    out.push({
      id: `${description}-${i}`,
      description,
      amountCents: -(cents + amountWobble),
      createdAt: new Date(NOW.getTime() - (start - i * intervalDays + wobble) * 86_400_000),
    });
  }
  return out;
}

describe('merchant normalisation', () => {
  it('groups the same subscription despite changing reference numbers', () => {
    expect(normaliseMerchant('SPOTIFY P0A3F9X SYDNEY')).toBe(
      normaliseMerchant('SPOTIFY P1B4G2Z SYDNEY'),
    );
  });

  it('strips payment-processor prefixes', () => {
    expect(normaliseMerchant('SQ *SINGLE O')).toBe(normaliseMerchant('Single O'));
  });

  it('strips dates and store numbers', () => {
    expect(normaliseMerchant('WOOLWORTHS 1234 12/03')).toBe(normaliseMerchant('Woolworths'));
  });

  it('keeps genuinely different merchants apart', () => {
    expect(normaliseMerchant('Netflix')).not.toBe(normaliseMerchant('Spotify'));
    expect(normaliseMerchant('Coles Express')).not.toBe(normaliseMerchant('Woolworths Metro'));
  });
});

describe('recurring detection', () => {
  it('finds a monthly subscription', () => {
    const found = detectRecurring(
      charges({ description: 'Spotify AU', cents: 1_399, intervalDays: 30, count: 6 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    );

    expect(found).toHaveLength(1);
    const spotify = found[0]!;
    expect(spotify.frequency).toBe('MONTHLY');
    expect(spotify.typicalAmountCents).toBe(1_399);
    expect(spotify.monthlyEquivalentCents).toBe(1_399);
    expect(spotify.occurrences).toBe(6);
    expect(spotify.confidence).toBeGreaterThan(90);
  });

  it('finds weekly, fortnightly, quarterly and annual shapes', () => {
    const found = detectRecurring(
      [
        ...charges({ description: 'Weekly Thing', cents: 1_200, intervalDays: 7, count: 10 }),
        ...charges({ description: 'Fortnightly Gym', cents: 2_990, intervalDays: 14, count: 8 }),
        ...charges({ description: 'Quarterly Water', cents: 21_000, intervalDays: 91, count: 4 }),
        ...charges({ description: 'Annual Domain', cents: 2_200, intervalDays: 365, count: 3 }),
      ],
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    );

    const byName = new Map(found.map((f) => [f.displayName, f]));
    expect(byName.get('Weekly Thing')?.frequency).toBe('WEEKLY');
    expect(byName.get('Fortnightly Gym')?.frequency).toBe('FORTNIGHTLY');
    expect(byName.get('Quarterly Water')?.frequency).toBe('QUARTERLY');
    expect(byName.get('Annual Domain')?.frequency).toBe('ANNUAL');
  });

  it('needs three occurrences before calling anything recurring', () => {
    const two = detectRecurring(
      charges({ description: 'Twice Only', cents: 5_000, intervalDays: 30, count: 2 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    );
    expect(two).toHaveLength(0);

    const three = detectRecurring(
      charges({ description: 'Twice Only', cents: 5_000, intervalDays: 30, count: 3 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    );
    expect(three).toHaveLength(1);
  });

  it('does not call irregular spending recurring', () => {
    const irregular: RecurringInputTransaction[] = [3, 19, 22, 61, 63, 140].map((d, i) => ({
      id: `c-${i}`,
      description: 'Cornersmith',
      amountCents: -(2_000 + i * 900),
      createdAt: new Date(NOW.getTime() - d * 86_400_000),
    }));

    const found = detectRecurring(irregular, DEFAULT_RECURRING_SETTINGS, NOW);
    expect(found).toHaveLength(0);
  });

  it('tolerates the few days a monthly charge drifts around weekends', () => {
    const found = detectRecurring(
      charges({
        description: 'Aussie Broadband',
        cents: 9_500,
        intervalDays: 30,
        count: 6,
        jitterDays: 2,
      }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.frequency).toBe('MONTHLY');
  });

  it('scores a charge with a wandering amount lower than a fixed one', () => {
    const fixed = detectRecurring(
      charges({ description: 'Fixed Sub', cents: 5_000, intervalDays: 30, count: 6 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    )[0]!;
    const wandering = detectRecurring(
      charges({
        description: 'Variable Sub',
        cents: 5_000,
        intervalDays: 30,
        count: 6,
        amountJitterCents: 700,
      }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    )[0]!;

    expect(wandering.confidence).toBeLessThan(fixed.confidence);
  });

  it('ignores credits, so salary is never reported as a subscription', () => {
    const salary: RecurringInputTransaction[] = [0, 14, 28, 42].map((d, i) => ({
      id: `s-${i}`,
      description: 'Council of the City of Sydney',
      amountCents: 438_031,
      createdAt: new Date(NOW.getTime() - d * 86_400_000),
    }));
    expect(detectRecurring(salary, DEFAULT_RECURRING_SETTINGS, NOW)).toHaveLength(0);
  });

  it('ignores internal transfers, so the pay split is not a subscription', () => {
    const transfers: RecurringInputTransaction[] = [0, 14, 28, 42].map((d, i) => ({
      id: `t-${i}`,
      description: 'Pay split',
      amountCents: -30_403,
      createdAt: new Date(NOW.getTime() - d * 86_400_000),
      isInternalTransfer: true,
    }));
    expect(detectRecurring(transfers, DEFAULT_RECURRING_SETTINGS, NOW)).toHaveLength(0);
  });

  it('ignores deleted transactions', () => {
    const deleted = charges({ description: 'Ghost Sub', cents: 5_000, intervalDays: 30, count: 5 }).map(
      (t) => ({ ...t, deletedAt: NOW }),
    );
    expect(detectRecurring(deleted, DEFAULT_RECURRING_SETTINGS, NOW)).toHaveLength(0);
  });

  it('treats a same-day double charge as one event', () => {
    const base = charges({ description: 'Double Bill', cents: 5_000, intervalDays: 30, count: 4 });
    const withDuplicate = [
      ...base,
      { ...base[0]!, id: 'dupe', createdAt: new Date(base[0]!.createdAt.getTime() + 3_600_000) },
    ];

    const found = detectRecurring(withDuplicate, DEFAULT_RECURRING_SETTINGS, NOW)[0]!;
    expect(found.occurrences).toBe(4);
    expect(found.frequency).toBe('MONTHLY');
  });

  it('projects the next charge from the observed interval', () => {
    const found = detectRecurring(
      charges({ description: 'Netflix', cents: 1_899, intervalDays: 30, count: 5 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    )[0]!;

    const gap = Math.round((found.nextExpectedAt.getTime() - found.lastSeenAt.getTime()) / 86_400_000);
    expect(gap).toBe(30);
  });

  it('shows its working', () => {
    const found = detectRecurring(
      charges({ description: 'Spotify AU', cents: 1_399, intervalDays: 30, count: 6 }),
      DEFAULT_RECURRING_SETTINGS,
      NOW,
    )[0]!;

    expect(found.explanation.length).toBeGreaterThanOrEqual(3);
    expect(found.explanation.some((e) => e.includes('Confidence'))).toBe(true);
  });
});

describe('commitment totals', () => {
  it('adds up the monthly equivalents', () => {
    expect(
      totalMonthlyCommitment([
        { monthlyEquivalentCents: 1_399 },
        { monthlyEquivalentCents: 1_899 },
        { monthlyEquivalentCents: 9_500 },
      ]),
    ).toBe(12_798);
  });

  it('leaves out anything cancelled or dismissed', () => {
    expect(
      totalMonthlyCommitment([
        { monthlyEquivalentCents: 1_399, status: 'EXPECTED' },
        { monthlyEquivalentCents: 1_899, status: 'CANCELLED' },
        { monthlyEquivalentCents: 9_500, status: 'NOT_RECURRING' },
      ]),
    ).toBe(1_399);
  });

  it('finds the charges due before payday', () => {
    const rows = [
      { nextExpectedAt: new Date('2026-09-12T00:00:00+10:00') },
      { nextExpectedAt: new Date('2026-09-25T00:00:00+10:00') },
      { nextExpectedAt: null },
      { nextExpectedAt: new Date('2026-09-14T00:00:00+10:00'), status: 'CANCELLED' as const },
    ];
    const due = expectedBefore(rows, new Date('2026-09-20T00:00:00+10:00'), NOW);
    expect(due).toHaveLength(1);
  });
});

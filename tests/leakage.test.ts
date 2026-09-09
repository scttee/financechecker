import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAKAGE_SETTINGS,
  detectLeakage,
  isSpendCompatible,
  isWatchedSource,
  type SpendCandidate,
  type TransferCandidate,
} from '@/lib/domain/leakage';

const BASE = new Date('2026-09-01T01:04:00Z'); // 11:04 Sydney

function transfer(partial: Partial<TransferCandidate> = {}): TransferCandidate {
  return {
    id: 'transfer-1',
    at: BASE,
    amountCents: 30_000,
    sourceRole: 'TRAVEL',
    destRole: 'SPENDING',
    description: 'Transfer',
    ...partial,
  };
}

function spend(partial: Partial<SpendCandidate> = {}): SpendCandidate {
  return {
    id: 'spend-1',
    at: new Date(BASE.getTime() + 12 * 60_000),
    amountCents: 28_500,
    description: 'MAAP',
    role: 'GEAR_OBJECTS',
    tags: ['Gear'],
    ...partial,
  };
}

describe('leakage correlation', () => {
  it('links a Travel transfer to a Gear purchase minutes later', () => {
    const findings = detectLeakage([transfer()], [spend()]);

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.sourceRole).toBe('TRAVEL');
    expect(finding.spendTransactionIds).toEqual(['spend-1']);
    expect(finding.minutesBetween).toBe(12);
    expect(finding.confidence).toBeGreaterThan(60);
    expect(finding.headline).toContain('moved from Travel');
  });

  it('explains itself, including that it is correlation rather than proof', () => {
    const finding = detectLeakage([transfer()], [spend()])[0]!;
    const labels = finding.explanation.map((s) => s.label);

    expect(labels).toContain('The transfer');
    expect(labels).toContain('The spending');
    expect(labels).toContain('Why they were linked');
    expect(finding.explanation.some((s) => s.detail.includes('not proof'))).toBe(true);
  });

  it('does not flag Travel money spent on travel', () => {
    const findings = detectLeakage(
      [transfer({ amountCents: 42_000 })],
      [
        spend({
          id: 'flight',
          amountCents: 41_800,
          description: 'Qantas Airways',
          role: 'TRAVEL',
          tags: ['Travel'],
        }),
      ],
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag Travel money spent on transport, which is close enough to travel', () => {
    const findings = detectLeakage(
      [transfer({ amountCents: 12_000 })],
      [
        spend({
          id: 'train',
          amountCents: 11_800,
          description: 'Transport for NSW',
          role: 'TRANSPORT',
          tags: [],
        }),
      ],
    );
    expect(findings).toHaveLength(0);
  });

  it('does not flag Gear money spent on gear', () => {
    const findings = detectLeakage(
      [transfer({ sourceRole: 'GEAR_OBJECTS' })],
      [spend()],
    );
    expect(findings).toHaveLength(0);
  });

  it('flags any movement out of Emergency, even with no spending after it', () => {
    const findings = detectLeakage([transfer({ sourceRole: 'EMERGENCY' })], []);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.spendTransactionIds).toHaveLength(0);
    expect(findings[0]!.explanation.some((s) => s.detail.includes('protected'))).toBe(true);
  });

  it('flags any movement out of Future Options', () => {
    const findings = detectLeakage([transfer({ sourceRole: 'FUTURE_OPTIONS' })], []);
    expect(findings).toHaveLength(1);
  });

  it('says nothing about a Travel transfer with no spending after it', () => {
    const findings = detectLeakage([transfer({ sourceRole: 'TRAVEL' })], []);
    expect(findings).toHaveLength(0);
  });

  it('leaves ordinary budgeting alone', () => {
    const findings = detectLeakage(
      [transfer({ sourceRole: 'BUFFER', destRole: 'SPENDING' })],
      [spend()],
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores spending outside the time window', () => {
    const findings = detectLeakage(
      [transfer()],
      [spend({ at: new Date(BASE.getTime() + 5 * 3_600_000) })],
      { ...DEFAULT_LEAKAGE_SETTINGS, windowMinutes: 180 },
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores spending before the transfer', () => {
    const findings = detectLeakage(
      [transfer()],
      [spend({ at: new Date(BASE.getTime() - 30 * 60_000) })],
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores spending outside the amount tolerance', () => {
    const findings = detectLeakage([transfer({ amountCents: 30_000 })], [spend({ amountCents: 500 })]);
    expect(findings).toHaveLength(0);
  });

  it('ignores small transfers entirely', () => {
    const findings = detectLeakage(
      [transfer({ amountCents: 2_000 })],
      [spend({ amountCents: 1_900 })],
      { ...DEFAULT_LEAKAGE_SETTINGS, minCents: 5_000 },
    );
    expect(findings).toHaveLength(0);
  });

  it('groups several purchases that together match the transfer, with lower confidence', () => {
    const single = detectLeakage([transfer()], [spend()])[0]!;
    const grouped = detectLeakage(
      [transfer()],
      [
        spend({ id: 'a', amountCents: 12_000, description: 'Uniqlo', role: 'GEAR_OBJECTS', tags: [] }),
        spend({
          id: 'b',
          amountCents: 15_000,
          description: 'Rebel Sport',
          role: 'GEAR_OBJECTS',
          tags: [],
          at: new Date(BASE.getTime() + 40 * 60_000),
        }),
      ],
    )[0]!;

    expect(grouped.spendTransactionIds).toEqual(['a', 'b']);
    expect(grouped.confidence).toBeLessThan(single.confidence);
  });

  it('respects a widened time window from settings', () => {
    const findings = detectLeakage(
      [transfer()],
      [spend({ at: new Date(BASE.getTime() + 300 * 60_000) })],
      { ...DEFAULT_LEAKAGE_SETTINGS, windowMinutes: 360 },
    );
    expect(findings).toHaveLength(1);
  });

  it('respects a tightened amount tolerance from settings', () => {
    const loose = detectLeakage([transfer()], [spend({ amountCents: 24_000 })], {
      ...DEFAULT_LEAKAGE_SETTINGS,
      tolerancePct: 30,
    });
    const tight = detectLeakage([transfer()], [spend({ amountCents: 24_000 })], {
      ...DEFAULT_LEAKAGE_SETTINGS,
      tolerancePct: 5,
    });
    expect(loose).toHaveLength(1);
    expect(tight).toHaveLength(0);
  });

  it('uses wording that notices rather than scolds', () => {
    const finding = detectLeakage([transfer()], [spend()])[0]!;
    const text = [finding.headline, ...finding.explanation.map((s) => s.detail)]
      .join(' ')
      .toLowerCase();

    for (const word of ['bad', 'should not', 'shouldn', 'mistake', 'wrong', 'guilty', 'stop']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('watched sources', () => {
  it('watches purpose-built and protected Savers', () => {
    expect(isWatchedSource('EMERGENCY')).toBe(true);
    expect(isWatchedSource('FUTURE_OPTIONS')).toBe(true);
    expect(isWatchedSource('TRAVEL')).toBe(true);
    expect(isWatchedSource('GEAR_OBJECTS')).toBe(true);
  });

  it('leaves everyday buckets alone', () => {
    expect(isWatchedSource('GROCERIES')).toBe(false);
    expect(isWatchedSource('DINING_SOCIAL')).toBe(false);
    expect(isWatchedSource('BUFFER')).toBe(false);
  });
});

describe('purpose matching', () => {
  it('accepts travel spending from Travel', () => {
    expect(isSpendCompatible('TRAVEL', spend({ role: 'TRAVEL', tags: [] }))).toBe(true);
    expect(isSpendCompatible('TRAVEL', spend({ role: null, tags: ['London 2026'] }))).toBe(true);
  });

  it('rejects gear spending from Travel', () => {
    expect(isSpendCompatible('TRAVEL', spend({ role: 'GEAR_OBJECTS', tags: ['Gear'] }))).toBe(false);
  });

  it('accepts nothing as consistent with drawing on Emergency', () => {
    expect(isSpendCompatible('EMERGENCY', spend({ role: 'GROCERIES', tags: [] }))).toBe(false);
    expect(isSpendCompatible('EMERGENCY', spend({ role: 'TRAVEL', tags: ['Travel'] }))).toBe(false);
  });
});

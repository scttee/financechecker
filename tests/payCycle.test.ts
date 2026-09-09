import { describe, expect, it } from 'vitest';
import {
  cycleProgress,
  currentCycle,
  derivePayCycles,
  findSalaryTransactions,
  matchSalary,
  spendingDaysRemaining,
  type SalaryRuleInput,
  type TransactionLike,
} from '@/lib/domain/payCycle';

const RULES: SalaryRuleInput[] = [
  {
    id: 'rule-council',
    label: 'Council of the City of Sydney',
    pattern: 'City of Sydney',
    matchType: 'CONTAINS',
    minCents: 200_000,
    priority: 100,
    enabled: true,
  },
];

const MIN = 200_000;

function tx(partial: Partial<TransactionLike> & { id: string; amountCents: number; createdAt: Date }): TransactionLike {
  return {
    description: 'Council of the City of Sydney',
    accountId: 'acct-spending',
    ...partial,
  };
}

describe('salary detection', () => {
  it('matches a credit from the configured employer', () => {
    const match = matchSalary(
      tx({ id: 't1', amountCents: 438_031, createdAt: new Date('2026-08-06T09:12:00+10:00') }),
      RULES,
      MIN,
    );
    expect(match).not.toBeNull();
    expect(match?.amountCents).toBe(438_031);
  });

  it('ignores debits, however well they match', () => {
    const match = matchSalary(
      tx({
        id: 't2',
        amountCents: -438_031,
        createdAt: new Date('2026-08-06T09:12:00+10:00'),
        description: 'City of Sydney parking fine',
      }),
      RULES,
      MIN,
    );
    expect(match).toBeNull();
  });

  it('ignores internal transfers, so a big Saver move is never mistaken for pay', () => {
    const match = matchSalary(
      tx({
        id: 't3',
        amountCents: 438_031,
        createdAt: new Date('2026-08-06T09:12:00+10:00'),
        isInternalTransfer: true,
      }),
      RULES,
      MIN,
    );
    expect(match).toBeNull();
  });

  it('ignores small credits from the same employer, such as a reimbursement', () => {
    const match = matchSalary(
      tx({ id: 't4', amountCents: 4_200, createdAt: new Date('2026-08-06T09:12:00+10:00') }),
      RULES,
      MIN,
    );
    expect(match).toBeNull();
  });

  it('matches on rawText and message as well as description', () => {
    const onRaw = matchSalary(
      tx({
        id: 't5',
        amountCents: 438_031,
        createdAt: new Date('2026-08-06T09:12:00+10:00'),
        description: 'Direct credit',
        rawText: 'COUNCIL OF THE CITY OF SYDNEY PAYROLL',
      }),
      RULES,
      MIN,
    );
    expect(onRaw).not.toBeNull();
  });

  it('supports a regex rule without letting a broken one take the app down', () => {
    const good = matchSalary(
      tx({ id: 't6', amountCents: 438_031, createdAt: new Date() }),
      [{ ...RULES[0]!, pattern: '^Council of the City', matchType: 'REGEX' }],
      MIN,
    );
    expect(good).not.toBeNull();

    const broken = matchSalary(
      tx({ id: 't7', amountCents: 438_031, createdAt: new Date() }),
      [{ ...RULES[0]!, pattern: '([unclosed', matchType: 'REGEX' }],
      MIN,
    );
    expect(broken).toBeNull();
  });

  it('is not hard-coded to any employer: a different rule finds a different payer', () => {
    const match = matchSalary(
      tx({
        id: 't8',
        amountCents: 500_000,
        createdAt: new Date(),
        description: 'ACME PTY LTD PAYROLL',
      }),
      [
        {
          id: 'r',
          label: 'New job',
          pattern: 'ACME',
          matchType: 'CONTAINS',
          minCents: null,
          priority: 1,
          enabled: true,
        },
      ],
      MIN,
    );
    expect(match?.amountCents).toBe(500_000);
  });

  it('skips disabled rules', () => {
    const match = matchSalary(
      tx({ id: 't9', amountCents: 438_031, createdAt: new Date() }),
      [{ ...RULES[0]!, enabled: false }],
      MIN,
    );
    expect(match).toBeNull();
  });
});

describe('pay cycle boundaries', () => {
  const paydays = [
    '2026-06-11T09:12:00+10:00',
    '2026-06-25T09:12:00+10:00',
    '2026-07-09T09:12:00+10:00',
    '2026-07-23T09:12:00+10:00',
  ].map((iso, i) =>
    tx({ id: `pay-${i}`, amountCents: 438_031, createdAt: new Date(iso) }),
  );

  it('runs each cycle from one payday to the next', () => {
    const salaries = findSalaryTransactions(paydays, RULES, MIN);
    const cycles = derivePayCycles(salaries, { cadence: 'FORTNIGHTLY' });

    expect(cycles).toHaveLength(4);
    expect(cycles[0]!.startAt.toISOString()).toBe(new Date('2026-06-11T09:12:00+10:00').toISOString());
    expect(cycles[0]!.endAt.toISOString()).toBe(new Date('2026-06-25T09:12:00+10:00').toISOString());
    expect(cycles[0]!.endIsProjected).toBe(false);
  });

  it('projects the end of the open cycle from the cadence', () => {
    const salaries = findSalaryTransactions(paydays, RULES, MIN);
    const cycles = derivePayCycles(salaries, { cadence: 'FORTNIGHTLY' });
    const last = cycles[cycles.length - 1]!;

    expect(last.endIsProjected).toBe(true);
    expect(last.endAt.getTime() - last.startAt.getTime()).toBe(14 * 86_400_000);
  });

  it('treats a split deposit on one day as one payday, not two cycles', () => {
    const split = [
      tx({ id: 's1', amountCents: 200_000, createdAt: new Date('2026-07-09T09:12:00+10:00') }),
      tx({ id: 's2', amountCents: 238_031, createdAt: new Date('2026-07-09T09:40:00+10:00') }),
      tx({ id: 's3', amountCents: 438_031, createdAt: new Date('2026-07-23T09:12:00+10:00') }),
    ];
    const cycles = derivePayCycles(findSalaryTransactions(split, RULES, MIN), {
      cadence: 'FORTNIGHTLY',
    });

    expect(cycles).toHaveLength(2);
    expect(cycles[0]!.incomeCents).toBe(438_031);
    expect(cycles[0]!.salaryTransactionIds).toEqual(['s1', 's2']);
  });

  it('handles a payday that moved because of a public holiday', () => {
    const moved = [
      tx({ id: 'm1', amountCents: 438_031, createdAt: new Date('2026-07-09T09:12:00+10:00') }),
      // Two days early, still one cycle later.
      tx({ id: 'm2', amountCents: 438_031, createdAt: new Date('2026-07-21T09:12:00+10:00') }),
    ];
    const cycles = derivePayCycles(findSalaryTransactions(moved, RULES, MIN), {
      cadence: 'FORTNIGHTLY',
    });
    expect(cycles).toHaveLength(2);
    expect(cycles[0]!.endAt.toISOString()).toBe(new Date('2026-07-21T09:12:00+10:00').toISOString());
  });

  it('returns nothing when no salary has been found', () => {
    expect(derivePayCycles([], { cadence: 'FORTNIGHTLY' })).toEqual([]);
  });

  it('picks the cycle containing a given instant', () => {
    const cycles = derivePayCycles(findSalaryTransactions(paydays, RULES, MIN), {
      cadence: 'FORTNIGHTLY',
    });
    const found = currentCycle(cycles, new Date('2026-07-01T12:00:00+10:00'));
    expect(found?.startAt.toISOString()).toBe(new Date('2026-06-25T09:12:00+10:00').toISOString());
  });
});

describe('cycle progress', () => {
  const cycle = {
    startAt: new Date('2026-07-09T09:12:00+10:00'),
    endAt: new Date('2026-07-23T09:12:00+10:00'),
    endIsProjected: true,
    incomeCents: 438_031,
    salaryTransactionIds: ['x'],
    salaryTransactionId: 'x',
  };

  it('reports how far through the fortnight we are', () => {
    const progress = cycleProgress(cycle, new Date('2026-07-14T09:12:00+10:00'));
    expect(progress.elapsedPct).toBe(36);
    expect(progress.daysRemaining).toBe(9);
    expect(progress.daysTotal).toBe(14);
  });

  it('never reports more than 100% elapsed', () => {
    const progress = cycleProgress(cycle, new Date('2026-08-30T09:12:00+10:00'));
    expect(progress.elapsedPct).toBe(100);
    expect(progress.daysRemaining).toBe(0);
  });

  it('flags a projected payday that has come and gone', () => {
    const progress = cycleProgress(cycle, new Date('2026-07-25T09:12:00+10:00'));
    expect(progress.isOverdue).toBe(true);
  });

  it('does not call an observed cycle overdue', () => {
    const progress = cycleProgress(
      { ...cycle, endIsProjected: false },
      new Date('2026-07-25T09:12:00+10:00'),
    );
    expect(progress.isOverdue).toBe(false);
  });

  it('never gives zero spending days, so the per-day pace cannot divide by zero', () => {
    expect(spendingDaysRemaining(cycle, new Date('2026-07-23T20:00:00+10:00'))).toBe(1);
    expect(spendingDaysRemaining(cycle, new Date('2026-09-01T20:00:00+10:00'))).toBe(1);
  });

  it('counts days by Sydney calendar date, not by 24-hour blocks', () => {
    // 11pm Sydney to 1am Sydney the next day is one day, not zero.
    const late = cycleProgress(cycle, new Date('2026-07-22T23:00:00+10:00'));
    expect(late.daysRemaining).toBe(1);
  });
});

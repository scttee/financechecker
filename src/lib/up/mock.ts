/**
 * The mock bank.
 *
 * This project has to be developable and testable without a real banking
 * token ever existing on the machine. So the mock does not stub out the
 * client at a high level — it produces genuine Up-shaped resources that go
 * through exactly the same normalisation, pay-cycle and detection code as real
 * data. If it works here it works there.
 *
 * Everything is generated from a fixed seed, so the same day produces the same
 * history and screenshots do not shift underfoot.
 *
 * No real account identifiers, BSBs, card numbers or merchant references
 * appear anywhere in this file. The account ids are literal strings beginning
 * `mock-`, which is not a shape Up ever issues.
 */

import type {
  UpAccountResource,
  UpMoneyObject,
  UpTagResource,
  UpTransactionResource,
} from './types';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32. Small, fast, and identical across runs for a given seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Saver names deliberately do NOT all match the role names. "Rainy Day" is the
 * emergency fund and "Optionality" is Future Options, because that is what
 * real Savers look like and the setup flow has to cope with it rather than
 * pattern-matching on names.
 */
export const MOCK_ACCOUNTS = [
  { id: 'mock-acct-spending', name: 'Spending', type: 'TRANSACTIONAL', role: 'SPENDING' },
  { id: 'mock-acct-rent', name: 'Rent', type: 'SAVER', role: 'RENT' },
  { id: 'mock-acct-bills', name: 'Bills', type: 'SAVER', role: 'BILLS' },
  { id: 'mock-acct-health', name: 'Head & Body', type: 'SAVER', role: 'HEALTH_THERAPY' },
  { id: 'mock-acct-groceries', name: 'Food', type: 'SAVER', role: 'GROCERIES' },
  { id: 'mock-acct-dining', name: 'Eating Out', type: 'SAVER', role: 'DINING_SOCIAL' },
  { id: 'mock-acct-fun', name: 'Fun', type: 'SAVER', role: 'FUN' },
  { id: 'mock-acct-transport', name: 'Getting Around', type: 'SAVER', role: 'TRANSPORT' },
  { id: 'mock-acct-travel', name: 'Travel Fund', type: 'SAVER', role: 'TRAVEL' },
  { id: 'mock-acct-gear', name: 'Gear & Objects', type: 'SAVER', role: 'GEAR_OBJECTS' },
  { id: 'mock-acct-emergency', name: 'Rainy Day', type: 'SAVER', role: 'EMERGENCY' },
  { id: 'mock-acct-future', name: 'Optionality', type: 'SAVER', role: 'FUTURE_OPTIONS' },
  { id: 'mock-acct-buffer', name: 'Buffer', type: 'SAVER', role: 'BUFFER' },
] as const;

export type MockAccountId = (typeof MOCK_ACCOUNTS)[number]['id'];

/** Opening balances, chosen so Emergency finishes just short of $12,000. */
const OPENING_BALANCE_CENTS: Record<string, number> = {
  'mock-acct-spending': 84_000,
  'mock-acct-rent': 0,
  'mock-acct-bills': 41_000,
  'mock-acct-health': 22_000,
  'mock-acct-groceries': 8_000,
  'mock-acct-dining': 4_000,
  'mock-acct-fun': 6_000,
  'mock-acct-transport': 11_000,
  'mock-acct-travel': 121_000,
  'mock-acct-gear': 3_800,
  'mock-acct-emergency': 780_000,
  'mock-acct-future': 96_000,
  'mock-acct-buffer': 18_000,
};

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

interface MerchantSpec {
  name: string;
  minCents: number;
  maxCents: number;
  account: string;
  category: string | null;
  parentCategory: string | null;
  /** Roughly how many times per fortnight. */
  perCycle: number;
}

const MERCHANTS: readonly MerchantSpec[] = [
  { name: 'Woolworths Metro', minCents: 2_400, maxCents: 8_200, account: 'mock-acct-groceries', category: 'groceries', parentCategory: 'good-life', perCycle: 3 },
  { name: 'Coles Express', minCents: 1_200, maxCents: 5_400, account: 'mock-acct-groceries', category: 'groceries', parentCategory: 'good-life', perCycle: 2 },
  { name: 'Harris Farm Markets', minCents: 3_100, maxCents: 7_600, account: 'mock-acct-groceries', category: 'groceries', parentCategory: 'good-life', perCycle: 1 },
  { name: 'Single O Surry Hills', minCents: 480, maxCents: 1_150, account: 'mock-acct-dining', category: 'restaurants-and-cafes', parentCategory: 'good-life', perCycle: 5 },
  { name: 'Cornersmith', minCents: 1_800, maxCents: 4_200, account: 'mock-acct-dining', category: 'restaurants-and-cafes', parentCategory: 'good-life', perCycle: 2 },
  { name: 'Uber Eats', minCents: 2_600, maxCents: 5_800, account: 'mock-acct-dining', category: 'takeaway', parentCategory: 'good-life', perCycle: 2 },
  { name: 'The Unicorn Hotel', minCents: 2_200, maxCents: 7_400, account: 'mock-acct-dining', category: 'pubs-and-bars', parentCategory: 'good-life', perCycle: 1 },
  { name: 'Opal Travel', minCents: 620, maxCents: 1_480, account: 'mock-acct-transport', category: 'public-transport', parentCategory: 'transport', perCycle: 5 },
  { name: 'Ampol', minCents: 4_800, maxCents: 9_200, account: 'mock-acct-transport', category: 'fuel', parentCategory: 'transport', perCycle: 1 },
  { name: 'Golden Age Cinema', minCents: 2_100, maxCents: 3_800, account: 'mock-acct-fun', category: 'events-and-gigs', parentCategory: 'good-life', perCycle: 1 },
  { name: 'Better Read Than Dead', minCents: 2_400, maxCents: 6_200, account: 'mock-acct-fun', category: 'hobbies', parentCategory: 'personal', perCycle: 1 },
];

/** Recurring charges. These are what the subscription detector should find. */
interface SubscriptionSpec {
  name: string;
  cents: number;
  intervalDays: number;
  account: string;
  category: string;
  parentCategory: string;
  /** Day offset within the interval, so they do not all land together. */
  offset: number;
  /** Introduced this many days before now. Used for the "new cost" case. */
  startsDaysAgo?: number;
}

const SUBSCRIPTIONS: readonly SubscriptionSpec[] = [
  { name: 'Spotify AU', cents: 1_399, intervalDays: 30, account: 'mock-acct-fun', category: 'tv-and-music', parentCategory: 'good-life', offset: 3 },
  { name: 'Netflix.com', cents: 1_899, intervalDays: 30, account: 'mock-acct-fun', category: 'tv-and-music', parentCategory: 'good-life', offset: 11 },
  { name: 'Apple iCloud', cents: 449, intervalDays: 30, account: 'mock-acct-bills', category: 'technology', parentCategory: 'home', offset: 17 },
  { name: 'Amaysim Mobile', cents: 3_500, intervalDays: 30, account: 'mock-acct-bills', category: 'mobile-phone', parentCategory: 'home', offset: 22 },
  { name: 'Aussie Broadband', cents: 9_500, intervalDays: 30, account: 'mock-acct-bills', category: 'internet', parentCategory: 'home', offset: 8 },
  { name: 'Fitness First Surry Hills', cents: 2_990, intervalDays: 14, account: 'mock-acct-health', category: 'fitness-and-wellbeing', parentCategory: 'personal', offset: 5 },
  { name: 'Origin Energy', cents: 48_000, intervalDays: 91, account: 'mock-acct-bills', category: 'utilities', parentCategory: 'home', offset: 14 },
  { name: 'Sydney Water', cents: 27_000, intervalDays: 91, account: 'mock-acct-bills', category: 'utilities', parentCategory: 'home', offset: 46 },
  // Introduced recently, so it should surface as a possible new recurring cost.
  { name: 'Strava Subscription', cents: 1_499, intervalDays: 30, account: 'mock-acct-fun', category: 'fitness-and-wellbeing', parentCategory: 'personal', offset: 6, startsDaysAgo: 95 },
];

/** One-off annual bills, dated relative to now. */
const ANNUAL_BILLS: ReadonlyArray<{ name: string; cents: number; daysAgo: number; category: string; parentCategory: string }> = [
  { name: 'NRMA Home & Contents', cents: 64_000, daysAgo: 118, category: 'life-admin', parentCategory: 'home' },
];

/** Fortnightly therapy. Real, regular, and never something to flag. */
const THERAPY = { name: 'Sydney City Psychology', cents: 22_000, account: 'mock-acct-health' };

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

function money(cents: number): UpMoneyObject {
  return {
    currencyCode: 'AUD',
    value: (cents / 100).toFixed(2),
    valueInBaseUnits: cents,
  };
}

interface BuildContext {
  id: number;
  transactions: UpTransactionResource[];
  balances: Map<string, number>;
}

function pushTransaction(
  ctx: BuildContext,
  input: {
    accountId: string;
    amountCents: number;
    description: string;
    at: Date;
    category?: string | null;
    parentCategory?: string | null;
    transferAccountId?: string | null;
    message?: string | null;
    transactionType?: string | null;
    tags?: string[];
    status?: 'HELD' | 'SETTLED';
  },
): UpTransactionResource {
  ctx.id += 1;
  const id = `mock-tx-${String(ctx.id).padStart(5, '0')}`;
  const status = input.status ?? 'SETTLED';

  ctx.balances.set(input.accountId, (ctx.balances.get(input.accountId) ?? 0) + input.amountCents);

  const tx: UpTransactionResource = {
    type: 'transactions',
    id,
    attributes: {
      status,
      rawText: input.description.toUpperCase(),
      description: input.description,
      message: input.message ?? null,
      isCategorizable: input.transferAccountId ? false : true,
      holdInfo: null,
      roundUp: null,
      cashback: null,
      amount: money(input.amountCents),
      foreignAmount: null,
      cardPurchaseMethod: input.transferAccountId
        ? null
        : { method: 'CONTACTLESS', cardNumberSuffix: '4321' },
      settledAt: status === 'SETTLED' ? input.at.toISOString() : null,
      createdAt: input.at.toISOString(),
      transactionType: input.transactionType ?? (input.transferAccountId ? 'Transfer' : 'Purchase'),
      note: null,
      performingCustomer: null,
    },
    relationships: {
      account: { data: { type: 'accounts', id: input.accountId } },
      transferAccount: {
        data: input.transferAccountId ? { type: 'accounts', id: input.transferAccountId } : null,
      },
      category: { data: input.category ? { type: 'categories', id: input.category } : null },
      parentCategory: {
        data: input.parentCategory ? { type: 'categories', id: input.parentCategory } : null,
      },
      tags: { data: (input.tags ?? []).map((t) => ({ type: 'tags', id: t })) },
      attachment: { data: null },
    },
  };

  ctx.transactions.push(tx);
  return tx;
}

/** An internal transfer, which Up records as two linked transactions. */
function pushTransfer(
  ctx: BuildContext,
  input: { fromAccountId: string; toAccountId: string; amountCents: number; at: Date; label: string },
): void {
  pushTransaction(ctx, {
    accountId: input.fromAccountId,
    amountCents: -input.amountCents,
    description: input.label,
    at: input.at,
    transferAccountId: input.toAccountId,
    transactionType: 'Transfer',
  });
  pushTransaction(ctx, {
    accountId: input.toAccountId,
    amountCents: input.amountCents,
    description: input.label,
    at: new Date(input.at.getTime() + 1000),
    transferAccountId: input.fromAccountId,
    transactionType: 'Transfer',
  });
}

// ---------------------------------------------------------------------------
// Pay cycle scaffolding
// ---------------------------------------------------------------------------

const SALARY_BASE_CENTS = 438_031;
const RENT_CENTS = 134_000;

/** Phase 1 split, as basis points of post-rent income. */
const PHASE_1_SPLIT: ReadonlyArray<[string, number]> = [
  ['mock-acct-bills', 1200],
  ['mock-acct-health', 1100],
  ['mock-acct-groceries', 1100],
  ['mock-acct-dining', 800],
  ['mock-acct-fun', 500],
  ['mock-acct-transport', 400],
  ['mock-acct-travel', 1000],
  ['mock-acct-gear', 500],
  ['mock-acct-emergency', 2000],
  ['mock-acct-future', 300],
  ['mock-acct-buffer', 300],
];
/** Investing (8%) leaves Up entirely, so it is a payment rather than a transfer. */
const INVESTING_BASIS_POINTS = 800;

/**
 * The most recent payday on or before `reference`. Paydays fall every second
 * Thursday, anchored to a fixed epoch so the sequence never drifts.
 */
function mostRecentPayday(reference: Date): Date {
  // A Thursday. Everything counts in fortnights from here.
  const epoch = Date.UTC(2024, 0, 4, 22, 15, 0); // 09:15 Sydney on Fri 5 Jan is close enough
  const fortnight = 14 * DAY_MS;
  const elapsed = reference.getTime() - epoch;
  const cycles = Math.floor(elapsed / fortnight);
  return new Date(epoch + cycles * fortnight);
}

function atTime(day: Date, hour: number, minute: number, rng: () => number): Date {
  // Sydney is UTC+10/+11. Close enough for believable timestamps: the tests
  // that care about timezones use explicit instants.
  const d = new Date(day);
  d.setUTCHours(hour - 10, minute + Math.floor(rng() * 12), Math.floor(rng() * 60), 0);
  return d;
}

function randomCents(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface MockDataset {
  accounts: UpAccountResource[];
  transactions: UpTransactionResource[];
  tags: UpTagResource[];
}

export interface MockOptions {
  /** The instant to generate up to. Defaults to now. */
  now?: Date;
  months?: number;
  seed?: number;
}

/**
 * Build a believable six months.
 *
 * The dataset deliberately contains:
 *   - fortnightly salary from a council employer
 *   - a rent payment and a full pay split into Savers every payday
 *   - one payday where the Gear split was skipped, so the audit has something
 *     to say
 *   - recurring subscriptions at several intervals, one of them recent
 *   - a Travel to Spending transfer followed sixteen minutes later by a Gear
 *     purchase, which is the leakage case
 *   - a HELD transaction, so the settle path has something to settle
 *   - an Emergency balance that finishes just short of $12,000, so simulating
 *     one more payday crosses the milestone and moves the plan to Phase 2
 */
export function generateMockData(options: MockOptions = {}): MockDataset {
  const now = options.now ?? new Date();
  const months = options.months ?? 6;
  const rng = makeRng(options.seed ?? 20260101);

  const ctx: BuildContext = {
    id: 0,
    transactions: [],
    balances: new Map(Object.entries(OPENING_BALANCE_CENTS)),
  };

  const start = new Date(now.getTime() - months * 30.44 * DAY_MS);
  const latestPayday = mostRecentPayday(now);

  // Collect the paydays inside the window, oldest first.
  const paydays: Date[] = [];
  for (let d = new Date(latestPayday); d.getTime() >= start.getTime(); d = new Date(d.getTime() - 14 * DAY_MS)) {
    paydays.unshift(new Date(d));
  }

  const lastIndex = paydays.length - 1;

  paydays.forEach((payday, index) => {
    const isLatest = index === lastIndex;
    const salaryAt = atTime(payday, 9, 12, rng);

    // Salary varies a little, the way real pay does with penalties and leave.
    const salaryCents =
      index === lastIndex - 1
        ? SALARY_BASE_CENTS + 12_450 // one fortnight with extra hours
        : SALARY_BASE_CENTS + randomCents(rng, -2_200, 2_200);

    pushTransaction(ctx, {
      accountId: 'mock-acct-spending',
      amountCents: salaryCents,
      description: 'Council of the City of Sydney',
      message: 'SALARY',
      at: salaryAt,
      transactionType: 'Direct Credit',
    });

    // Rent off the top.
    const rentTransferAt = new Date(salaryAt.getTime() + 4 * 60_000);
    pushTransfer(ctx, {
      fromAccountId: 'mock-acct-spending',
      toAccountId: 'mock-acct-rent',
      amountCents: RENT_CENTS,
      at: rentTransferAt,
      label: 'Rent',
    });
    pushTransaction(ctx, {
      accountId: 'mock-acct-rent',
      amountCents: -RENT_CENTS,
      description: 'Ray White Property Management',
      at: new Date(salaryAt.getTime() + 26 * 3_600_000),
      category: 'rent-and-mortgage',
      parentCategory: 'home',
      transactionType: 'Direct Debit',
    });

    // The split, on post-rent income.
    const allocatable = salaryCents - RENT_CENTS;
    PHASE_1_SPLIT.forEach(([accountId, basisPoints], splitIndex) => {
      // One fortnight the Gear split was skipped. The payday audit should
      // notice, which is the point of having an audit.
      if (index === lastIndex - 2 && accountId === 'mock-acct-gear') return;

      const amount = Math.round((allocatable * basisPoints) / 10_000);
      pushTransfer(ctx, {
        fromAccountId: 'mock-acct-spending',
        toAccountId: accountId,
        amountCents: amount,
        at: new Date(salaryAt.getTime() + (6 + splitIndex) * 60_000),
        label: 'Pay split',
      });
    });

    // Investing leaves Up.
    pushTransaction(ctx, {
      accountId: 'mock-acct-spending',
      amountCents: -Math.round((allocatable * INVESTING_BASIS_POINTS) / 10_000),
      description: 'Betashares Capital',
      at: new Date(salaryAt.getTime() + 40 * 60_000),
      category: 'investments',
      parentCategory: 'personal',
      transactionType: 'Osko Payment',
      tags: ['Investing'],
    });

    // Therapy, fortnightly.
    pushTransaction(ctx, {
      accountId: THERAPY.account,
      amountCents: -THERAPY.cents,
      description: THERAPY.name,
      at: atTime(new Date(payday.getTime() + 5 * DAY_MS), 17, 30, rng),
      category: 'health-and-medical',
      parentCategory: 'personal',
      tags: ['Therapy'],
    });

    // Everyday spending across the fortnight.
    const cycleEnd = isLatest ? now : new Date(payday.getTime() + 14 * DAY_MS);
    for (const merchant of MERCHANTS) {
      const count = Math.max(0, Math.round(merchant.perCycle * (0.7 + rng() * 0.6)));
      for (let i = 0; i < count; i += 1) {
        const offsetDays = rng() * 14;
        const at = atTime(new Date(payday.getTime() + offsetDays * DAY_MS), 8 + Math.floor(rng() * 11), 0, rng);
        if (at.getTime() > cycleEnd.getTime()) continue;
        pushTransaction(ctx, {
          accountId: merchant.account,
          amountCents: -randomCents(rng, merchant.minCents, merchant.maxCents),
          description: merchant.name,
          at,
          category: merchant.category,
          parentCategory: merchant.parentCategory,
        });
      }
    }
  });

  // --- Subscriptions ------------------------------------------------------
  for (const sub of SUBSCRIPTIONS) {
    const firstAt = sub.startsDaysAgo
      ? new Date(now.getTime() - sub.startsDaysAgo * DAY_MS)
      : new Date(start.getTime() + sub.offset * DAY_MS);
    for (let at = new Date(firstAt); at.getTime() <= now.getTime(); at = new Date(at.getTime() + sub.intervalDays * DAY_MS)) {
      pushTransaction(ctx, {
        accountId: sub.account,
        amountCents: -sub.cents,
        description: sub.name,
        at: new Date(at.getTime() + 3 * 3_600_000),
        category: sub.category,
        parentCategory: sub.parentCategory,
        transactionType: 'Card Purchase',
        tags: ['Subscription'],
      });
    }
  }

  for (const bill of ANNUAL_BILLS) {
    pushTransaction(ctx, {
      accountId: 'mock-acct-bills',
      amountCents: -bill.cents,
      description: bill.name,
      at: atTime(new Date(now.getTime() - bill.daysAgo * DAY_MS), 9, 0, rng),
      category: bill.category,
      parentCategory: bill.parentCategory,
      transactionType: 'Direct Debit',
    });
  }

  // --- Occasional gear purchases, funded properly -------------------------
  const gearHistory: Array<[number, string, number]> = [
    [168, 'Macpac', 38_000],
    [151, 'Bogong Equipment', 26_000],
    [128, 'Paddy Pallin', 8_900],
    [119, 'Mountain Designs', 19_000],
    [96, 'MAAP', 14_500],
    [78, 'Anaconda', 9_500],
    [61, 'Wild Earth', 6_400],
    [44, 'Sea to Summit', 14_000],
    [27, 'Paddy Pallin', 22_000],
    [16, 'MAAP', 10_700],
  ];
  for (const [daysAgo, name, cents] of gearHistory) {
    pushTransaction(ctx, {
      accountId: 'mock-acct-gear',
      amountCents: -cents,
      description: name,
      at: atTime(new Date(now.getTime() - daysAgo * DAY_MS), 13, 20, rng),
      category: 'clothing-and-accessories',
      parentCategory: 'personal',
      tags: ['Gear'],
    });
  }

  // --- Genuine travel spending out of Travel ------------------------------
  //
  // This one exists to prove the detector does NOT flag Travel money spent on
  // travel. A transfer out of Travel followed by a flight is the system
  // working exactly as intended.
  const travelDay = new Date(now.getTime() - 74 * DAY_MS);
  const travelTransferAt = atTime(travelDay, 19, 40, rng);
  pushTransfer(ctx, {
    fromAccountId: 'mock-acct-travel',
    toAccountId: 'mock-acct-spending',
    amountCents: 42_000,
    at: travelTransferAt,
    label: 'Transfer',
  });
  pushTransaction(ctx, {
    accountId: 'mock-acct-spending',
    amountCents: -41_800,
    description: 'Qantas Airways',
    at: new Date(travelTransferAt.getTime() + 22 * 60_000),
    category: 'holidays-and-travel',
    parentCategory: 'good-life',
    tags: ['Travel'],
  });

  // --- The leakage case ---------------------------------------------------
  //
  // $300 out of Travel at 11:04, a $285 bike-apparel purchase at 11:16.
  const leakDay = new Date(now.getTime() - 9 * DAY_MS);
  const leakTransferAt = new Date(
    Date.UTC(
      leakDay.getUTCFullYear(),
      leakDay.getUTCMonth(),
      leakDay.getUTCDate(),
      1, // 11:04 Sydney
      4,
      0,
    ),
  );
  pushTransfer(ctx, {
    fromAccountId: 'mock-acct-travel',
    toAccountId: 'mock-acct-spending',
    amountCents: 30_000,
    at: leakTransferAt,
    label: 'Transfer',
  });
  pushTransaction(ctx, {
    accountId: 'mock-acct-spending',
    amountCents: -28_500,
    description: 'MAAP',
    at: new Date(leakTransferAt.getTime() + 12 * 60_000),
    category: 'clothing-and-accessories',
    parentCategory: 'personal',
    tags: ['Gear'],
  });

  // --- One HELD transaction, so settling has something to settle ----------
  pushTransaction(ctx, {
    accountId: 'mock-acct-dining',
    amountCents: -4_250,
    description: 'Continental Deli',
    at: new Date(now.getTime() - 3 * 3_600_000),
    category: 'restaurants-and-cafes',
    parentCategory: 'good-life',
    status: 'HELD',
  });

  // --- Balance the books --------------------------------------------------
  //
  // The Emergency balance is nudged so it finishes just short of $12,000.
  // Simulating one more payday then crosses the milestone, which is the whole
  // Phase 1 to Phase 2 transition, live.
  const emergencyNow = ctx.balances.get('mock-acct-emergency') ?? 0;
  const emergencyTarget = 1_145_500; // $11,455
  const adjustment = emergencyTarget - emergencyNow;
  if (adjustment !== 0) {
    pushTransaction(ctx, {
      accountId: 'mock-acct-emergency',
      amountCents: adjustment,
      description: adjustment > 0 ? 'Opening balance' : 'Balance adjustment',
      at: new Date(start.getTime() - DAY_MS),
      transactionType: 'Adjustment',
    });
  }

  const transactions = ctx.transactions.sort(
    (a, b) =>
      new Date(b.attributes.createdAt).getTime() - new Date(a.attributes.createdAt).getTime(),
  );

  const accounts: UpAccountResource[] = MOCK_ACCOUNTS.map((a) => ({
    type: 'accounts' as const,
    id: a.id,
    attributes: {
      displayName: a.name,
      accountType: a.type,
      ownershipType: 'INDIVIDUAL' as const,
      balance: money(Math.max(0, ctx.balances.get(a.id) ?? 0)),
      createdAt: new Date(now.getTime() - 700 * DAY_MS).toISOString(),
    },
    relationships: { transactions: {} },
  }));

  const tags: UpTagResource[] = [
    'Gear',
    'Bikepacking',
    'Therapy',
    'Subscription',
    'Planned Purchase',
    'Impulse',
    'Travel',
    'London 2026',
    'Work Expense',
    'Investing',
  ].map((id) => ({ type: 'tags' as const, id, relationships: { transactions: {} } }));

  return { accounts, transactions, tags };
}

// ---------------------------------------------------------------------------
// Simulating the next payday
// ---------------------------------------------------------------------------

/**
 * Produce the transactions for one more payday, dated now.
 *
 * Used by the "Simulate a payday" button. In Phase 1 this pushes Emergency
 * past $12,000 and the milestone fires, which is the most interesting thing
 * the app does and should be demonstrable without waiting a fortnight.
 */
export function generateSimulatedPayday(input: {
  now: Date;
  salaryCents?: number;
  rentCents?: number;
  splits: ReadonlyArray<{ accountId: string; basisPoints: number }>;
  investingBasisPoints?: number;
  startingIndex?: number;
}): UpTransactionResource[] {
  const {
    now,
    salaryCents = SALARY_BASE_CENTS,
    rentCents = RENT_CENTS,
    splits,
    investingBasisPoints = INVESTING_BASIS_POINTS,
    startingIndex = 900_000,
  } = input;

  const ctx: BuildContext = { id: startingIndex, transactions: [], balances: new Map() };

  pushTransaction(ctx, {
    accountId: 'mock-acct-spending',
    amountCents: salaryCents,
    description: 'Council of the City of Sydney',
    message: 'SALARY',
    at: now,
    transactionType: 'Direct Credit',
  });

  pushTransfer(ctx, {
    fromAccountId: 'mock-acct-spending',
    toAccountId: 'mock-acct-rent',
    amountCents: rentCents,
    at: new Date(now.getTime() + 60_000),
    label: 'Rent',
  });

  const allocatable = salaryCents - rentCents;
  splits.forEach((split, i) => {
    const amount = Math.round((allocatable * split.basisPoints) / 10_000);
    if (amount <= 0) return;
    pushTransfer(ctx, {
      fromAccountId: 'mock-acct-spending',
      toAccountId: split.accountId,
      amountCents: amount,
      at: new Date(now.getTime() + (5 + i) * 60_000),
      label: 'Pay split',
    });
  });

  if (investingBasisPoints > 0) {
    pushTransaction(ctx, {
      accountId: 'mock-acct-spending',
      amountCents: -Math.round((allocatable * investingBasisPoints) / 10_000),
      description: 'Betashares Capital',
      at: new Date(now.getTime() + 40 * 60_000),
      category: 'investments',
      parentCategory: 'personal',
      transactionType: 'Osko Payment',
      tags: ['Investing'],
    });
  }

  return ctx.transactions;
}

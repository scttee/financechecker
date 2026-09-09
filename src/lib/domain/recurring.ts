/**
 * Recurring spend detection.
 *
 * Subscriptions are the quiet kind of spending: each one is small enough to
 * ignore and they only make sense added up. This finds the repeating shapes in
 * the transaction history and reports them with a confidence figure, so a
 * coincidence never gets presented as a fact.
 *
 * The bar is deliberately high. Three occurrences minimum, a regular interval
 * and a stable amount. Two charges a month apart is a coincidence.
 *
 * Nothing here cancels anything. It reports, and I decide.
 */

import type { RecurringFrequency, RecurringStatus } from '@prisma/client';
import { addDaysUtc } from '@/lib/time';
import type { Cents } from '@/lib/money';

export interface RecurringInputTransaction {
  id: string;
  description: string;
  rawText?: string | null;
  amountCents: Cents; // negative for money out
  createdAt: Date;
  isInternalTransfer?: boolean;
  deletedAt?: Date | null;
}

export interface RecurringSettings {
  minOccurrences: number;
  minConfidence: number;
  /** Ignore charges below this. Removes noise from tap-and-go coffee. */
  minAmountCents: Cents;
}

export const DEFAULT_RECURRING_SETTINGS: RecurringSettings = {
  minOccurrences: 3,
  minConfidence: 60,
  minAmountCents: 200,
};

export interface RecurringCandidate {
  merchantKey: string;
  displayName: string;
  frequency: RecurringFrequency;
  intervalDays: number;
  typicalAmountCents: Cents;
  monthlyEquivalentCents: Cents;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  nextExpectedAt: Date;
  confidence: number;
  transactionIds: string[];
  /** Plain-language reasoning, shown behind "Why?". */
  explanation: string[];
}

// ---------------------------------------------------------------------------
// Merchant normalisation
// ---------------------------------------------------------------------------

/**
 * Reduce a transaction description to a stable grouping key.
 *
 * Bank descriptions carry reference numbers, store numbers, locations and
 * dates that differ every time. "SPOTIFY P0A3F9X SYDNEY" and "SPOTIFY
 * P1B4G2Z SYDNEY" are the same subscription and must land on the same key.
 */
export function normaliseMerchant(description: string): string {
  let s = description.toLowerCase();

  // Strip common payment-processor prefixes.
  s = s.replace(/^(sq|sp|sumup|paypal|pp|visa|eftpos|direct debit|dd|ib|osko)[\s*_-]+/i, '');

  // Strip anything that looks like a reference: long alphanumeric runs,
  // trailing digits, dates, card suffixes.
  s = s.replace(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g, ' ');
  s = s.replace(/\bx{2,}\d{2,}\b/g, ' ');
  s = s.replace(/\b[a-z]*\d[a-z\d]{4,}\b/g, ' ');
  s = s.replace(/\b\d{3,}\b/g, ' ');

  // Strip trailing location words that vary between stores.
  s = s.replace(/\b(pty|ltd|limited|inc|au|aus|australia|sydney|melbourne|nsw|vic|qld|wa|sa|tas|act|nt)\b/g, ' ');

  // Collapse punctuation and whitespace.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();

  // Keep the first few meaningful words. Long descriptions drift; the head of
  // the string is the part that identifies the merchant.
  const words = s.split(' ').filter((w) => w.length > 1);
  return words.slice(0, 3).join(' ') || description.toLowerCase().trim();
}

/** A readable name for the group: the most common original description. */
function pickDisplayName(descriptions: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const d of descriptions) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best = descriptions[0] ?? '';
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount || (c === bestCount && d.length < best.length)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Interval classification
// ---------------------------------------------------------------------------

interface FrequencyBand {
  frequency: RecurringFrequency;
  days: number;
  tolerance: number;
  perMonth: number;
}

/**
 * Tolerances widen with the interval. A monthly charge lands anywhere from the
 * 28th to the 3rd depending on weekends, which is 6 days of legitimate drift.
 */
const BANDS: readonly FrequencyBand[] = [
  { frequency: 'WEEKLY', days: 7, tolerance: 2, perMonth: 365 / 12 / 7 },
  { frequency: 'FORTNIGHTLY', days: 14, tolerance: 3, perMonth: 365 / 12 / 14 },
  { frequency: 'MONTHLY', days: 30.44, tolerance: 6, perMonth: 1 },
  { frequency: 'QUARTERLY', days: 91.3, tolerance: 12, perMonth: 1 / 3 },
  { frequency: 'ANNUAL', days: 365.25, tolerance: 30, perMonth: 1 / 12 },
];

function classifyInterval(medianDays: number): FrequencyBand | null {
  for (const band of BANDS) {
    if (Math.abs(medianDays - band.days) <= band.tolerance) return band;
  }
  return null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Find repeating charges.
 *
 * Confidence is built from three things, each worth a share:
 *   how regular the gaps are (50)
 *   how stable the amount is (30)
 *   how many times it has happened (20)
 *
 * A charge that lands on the same day every month for the same amount, six
 * times, scores near 100. Three charges at wobbly intervals for varying
 * amounts scores in the sixties and is reported as low confidence.
 */
export function detectRecurring(
  transactions: readonly RecurringInputTransaction[],
  settings: RecurringSettings = DEFAULT_RECURRING_SETTINGS,
  now: Date = new Date(),
): RecurringCandidate[] {
  const debits = transactions.filter(
    (t) =>
      !t.deletedAt &&
      !t.isInternalTransfer &&
      t.amountCents < 0 &&
      Math.abs(t.amountCents) >= settings.minAmountCents,
  );

  const groups = new Map<string, RecurringInputTransaction[]>();
  for (const tx of debits) {
    const key = normaliseMerchant(tx.description);
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [merchantKey, rawGroup] of groups) {
    if (rawGroup.length < settings.minOccurrences) continue;

    const group = [...rawGroup].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Two charges on the same day are one event billed twice, not an interval
    // of zero. Collapse them so the interval maths stays sane.
    const collapsed: RecurringInputTransaction[] = [];
    for (const tx of group) {
      const prev = collapsed[collapsed.length - 1];
      if (prev && Math.abs(tx.createdAt.getTime() - prev.createdAt.getTime()) < 12 * 3_600_000) {
        continue;
      }
      collapsed.push(tx);
    }
    if (collapsed.length < settings.minOccurrences) continue;

    const intervals: number[] = [];
    for (let i = 1; i < collapsed.length; i += 1) {
      const days =
        (collapsed[i]!.createdAt.getTime() - collapsed[i - 1]!.createdAt.getTime()) / 86_400_000;
      intervals.push(days);
    }

    const medianInterval = median(intervals);
    const band = classifyInterval(medianInterval);
    if (!band) continue;

    // --- Interval regularity ---
    const deviations = intervals.map((d) => Math.abs(d - medianInterval));
    const meanDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const intervalScore = Math.max(0, Math.round(50 * (1 - meanDeviation / band.tolerance)));

    // --- Amount stability ---
    const amounts = collapsed.map((t) => Math.abs(t.amountCents));
    const typicalAmountCents = Math.round(median(amounts));
    const amountDeviation =
      amounts.reduce((acc, a) => acc + Math.abs(a - typicalAmountCents), 0) / amounts.length;
    const amountDriftPct = typicalAmountCents > 0 ? (amountDeviation / typicalAmountCents) * 100 : 100;
    // 0% drift scores 30, 20% drift or more scores 0.
    const amountScore = Math.max(0, Math.round(30 * (1 - amountDriftPct / 20)));

    // --- Occurrence count ---
    const occurrenceScore = Math.min(20, (collapsed.length - settings.minOccurrences + 1) * 5);

    const confidence = Math.min(100, intervalScore + amountScore + occurrenceScore);
    if (confidence < settings.minConfidence) continue;

    const firstSeenAt = collapsed[0]!.createdAt;
    const lastSeenAt = collapsed[collapsed.length - 1]!.createdAt;
    const nextExpectedAt = addDaysUtc(lastSeenAt, Math.round(medianInterval));
    const monthlyEquivalentCents = Math.round(typicalAmountCents * band.perMonth);

    const explanation = [
      `Seen ${collapsed.length} times between ${shortDate(firstSeenAt)} and ${shortDate(lastSeenAt)}.`,
      `The gap between charges is typically ${Math.round(medianInterval)} days, which reads as ${band.frequency.toLowerCase()}.`,
      amountDriftPct < 1
        ? `The amount is the same every time: ${money(typicalAmountCents)}.`
        : `The amount is usually around ${money(typicalAmountCents)}, varying by about ${Math.round(amountDriftPct)}%.`,
      `Confidence ${confidence} out of 100: ${intervalScore}/50 for regularity, ${amountScore}/30 for a stable amount, ${occurrenceScore}/20 for how many times it has happened.`,
    ];

    candidates.push({
      merchantKey,
      displayName: pickDisplayName(collapsed.map((t) => t.description)),
      frequency: band.frequency,
      intervalDays: Math.round(medianInterval),
      typicalAmountCents,
      monthlyEquivalentCents,
      occurrences: collapsed.length,
      firstSeenAt,
      lastSeenAt,
      nextExpectedAt,
      confidence,
      transactionIds: collapsed.map((t) => t.id),
      explanation,
    });
  }

  return candidates.sort((a, b) => b.monthlyEquivalentCents - a.monthlyEquivalentCents);
}

/** Total monthly cost of everything not marked cancelled or dismissed. */
export function totalMonthlyCommitment(
  rows: ReadonlyArray<{ monthlyEquivalentCents: Cents; status?: RecurringStatus }>,
): Cents {
  return rows
    .filter((r) => r.status !== 'CANCELLED' && r.status !== 'NOT_RECURRING')
    .reduce((acc, r) => acc + r.monthlyEquivalentCents, 0);
}

/**
 * Charges expected to land before a given date. Feeds the "commitments before
 * payday" line of the safe-to-spend calculation.
 */
export function expectedBefore<T extends { nextExpectedAt: Date | null; status?: RecurringStatus }>(
  rows: readonly T[],
  before: Date,
  after: Date = new Date(0),
): T[] {
  return rows.filter(
    (r) =>
      r.status !== 'CANCELLED' &&
      r.status !== 'NOT_RECURRING' &&
      r.nextExpectedAt !== null &&
      r.nextExpectedAt.getTime() > after.getTime() &&
      r.nextExpectedAt.getTime() <= before.getTime(),
  );
}

export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Fortnightly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

function money(cents: Cents): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Australia/Sydney',
  }).format(date);
}

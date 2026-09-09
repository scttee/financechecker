/**
 * Money.
 *
 * Every amount in this application is an integer number of cents. There is no
 * floating point money anywhere. `0.1 + 0.2 !== 0.3` is not a rounding quirk
 * to work around, it is a reason to never represent money as a float in the
 * first place.
 *
 * A JavaScript number holds integers exactly up to 2^53 - 1, which is about
 * $90 trillion in cents. That is comfortably more headroom than this app needs.
 */

/** An integer number of cents. Negative means money out. */
export type Cents = number;

export class MoneyError extends Error {}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} is outside the safe integer range`);
  }
  return value;
}

/**
 * Parse a decimal string like "10.56" or "-1,340.00" into cents.
 *
 * Deliberately string-based rather than `Math.round(parseFloat(x) * 100)`,
 * which mis-rounds values such as "1.005".
 */
export function parseDecimalToCents(input: string | number): Cents {
  const raw = String(input).trim().replace(/[$,\s]/g, '');
  if (raw === '') throw new MoneyError('empty money string');

  const match = /^(-|\+)?(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new MoneyError(`cannot parse money value: ${JSON.stringify(input)}`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] || '0';
  const fracRaw = match[3] ?? '';

  // Round half away from zero on the third decimal, matching how a person
  // reads a price. Up never sends more than two decimals, but pasted prices do.
  const frac2 = fracRaw.slice(0, 2).padEnd(2, '0');
  const nextDigit = fracRaw.charCodeAt(2) - 48;
  let cents = Number(whole) * 100 + Number(frac2);
  if (nextDigit >= 5 && nextDigit <= 9) cents += 1;

  return assertCents(sign * cents);
}

/** Format cents as Australian dollars, e.g. 438031 -> "$4,380.31". */
export function formatCents(
  cents: Cents,
  options: { showCents?: boolean; showSign?: boolean; currency?: string } = {},
): string {
  const { showCents = true, showSign = false, currency = 'AUD' } = options;
  const formatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
    signDisplay: showSign ? 'exceptZero' : 'auto',
  });
  return formatter.format(cents / 100);
}

/** Compact form for large headline numbers: 1200000 -> "$12,000". */
export function formatCentsShort(cents: Cents): string {
  return formatCents(cents, { showCents: cents % 100 !== 0 });
}

/** Absolute value, for displaying the size of a debit. */
export function abs(cents: Cents): Cents {
  return Math.abs(cents);
}

/** Never let a displayed balance go below zero. */
export function floorAtZero(cents: Cents): Cents {
  return cents > 0 ? cents : 0;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return assertCents(total);
}

// ---------------------------------------------------------------------------
// Percentages
// ---------------------------------------------------------------------------

/**
 * Percentages are stored as BASIS POINTS (1% = 100 bp) so that "must add to
 * exactly 100%" is an exact integer comparison against 10000.
 */
export const BASIS_POINTS_TOTAL = 10_000;

export function pctToBasisPoints(pct: number): number {
  const bp = Math.round(pct * 100);
  return bp;
}

export function basisPointsToPct(bp: number): number {
  return bp / 100;
}

export function formatBasisPoints(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/**
 * Split `total` cents across weighted parts so that:
 *   1. every part is a whole number of cents, and
 *   2. the parts sum to exactly `total`, with no drift.
 *
 * Uses the largest remainder (Hare–Niemeyer) method: floor everything, then
 * hand the leftover cents out one at a time to the parts with the largest
 * fractional remainder. Ties break toward the larger weight, then by key, so
 * the result is deterministic and reproducible across runs.
 */
export function allocateByBasisPoints<K extends string>(
  total: Cents,
  weights: ReadonlyArray<{ key: K; basisPoints: number }>,
): Array<{ key: K; basisPoints: number; cents: Cents }> {
  assertCents(total, 'total');

  const weightSum = weights.reduce((acc, w) => acc + w.basisPoints, 0);
  if (weightSum <= 0) {
    return weights.map((w) => ({ key: w.key, basisPoints: w.basisPoints, cents: 0 }));
  }

  const rows = weights.map((w) => {
    const exact = total * w.basisPoints;
    const floored = Math.floor(exact / weightSum);
    return {
      key: w.key,
      basisPoints: w.basisPoints,
      cents: floored,
      remainder: exact - floored * weightSum,
    };
  });

  let distributed = rows.reduce((acc, r) => acc + r.cents, 0);
  let leftover = total - distributed;

  if (leftover !== 0) {
    const order = [...rows].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      if (b.basisPoints !== a.basisPoints) return b.basisPoints - a.basisPoints;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    const step = leftover > 0 ? 1 : -1;
    let i = 0;
    while (leftover !== 0 && order.length > 0) {
      const row = order[i % order.length]!;
      row.cents += step;
      leftover -= step;
      i += 1;
    }
    distributed = rows.reduce((acc, r) => acc + r.cents, 0);
  }

  return rows.map(({ key, basisPoints, cents }) => ({ key, basisPoints, cents }));
}

/**
 * A percentage of a total, rounded to the nearest cent. Use
 * `allocateByBasisPoints` when several percentages must sum back to the total.
 */
export function applyBasisPoints(total: Cents, basisPoints: number): Cents {
  assertCents(total, 'total');
  const sign = total < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(total) * basisPoints) / BASIS_POINTS_TOTAL);
}

/** Safe integer percentage, floored at 0. Returns 0 when the base is 0. */
export function percentOf(part: Cents, whole: Cents): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

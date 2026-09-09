/**
 * Parsing a wishlist out of Notion prose.
 *
 * Notion is the canonical list and it is written for a person, not for a
 * parser. Rows say "Durston tent, decision TBC" and "$129ish" and "already
 * ordered". So this is deliberately forgiving: it extracts what it can, keeps
 * the original text when it cannot, and never drops an item just because the
 * price was unreadable.
 *
 * Pure functions, so the parsing rules are testable without a Notion token.
 */

import type { Priority, WishlistStatus } from '@prisma/client';
import { parseDecimalToCents } from '@/lib/money';

export interface ParsedWishlistItem {
  externalId: string;
  name: string;
  priceCents: number | null;
  rawPrice: string | null;
  priority: Priority;
  status: WishlistStatus;
  notes: string | null;
  url: string | null;
}

/**
 * Pull a price out of free text.
 *
 * Handles "$129", "129", "$1,299.00", "about $450", "$129ish". Returns null
 * rather than guessing when there is no number, which downstream becomes a
 * NEEDS INFORMATION verdict rather than a wrong one.
 */
export function extractPrice(text: string): { cents: number | null; raw: string | null } {
  if (!text) return { cents: null, raw: null };

  const trimmed = text.trim();
  if (!trimmed || /^(tbc|tba|unknown|\?|-|n\/a)$/i.test(trimmed)) {
    return { cents: null, raw: trimmed || null };
  }

  // Prefer an explicit dollar amount, then any bare number.
  const dollar = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(trimmed);
  const bare = /(?:^|\s)([\d,]+(?:\.\d{1,2})?)(?:\s|$|ish|k\b)/i.exec(trimmed);
  const match = dollar ?? bare;
  if (!match?.[1]) return { cents: null, raw: trimmed };

  try {
    let cents = parseDecimalToCents(match[1]);
    // "$1.5k" and "1.5k" mean fifteen hundred dollars.
    if (/k\b/i.test(trimmed.slice(match.index))) cents *= 1000;
    return { cents, raw: trimmed };
  } catch {
    return { cents: null, raw: trimmed };
  }
}

const PRIORITY_PATTERNS: ReadonlyArray<[RegExp, Priority]> = [
  [/\b(safety|urgent|worn out|broken|unsafe|falling apart)\b/i, 'SAFETY_REPLACEMENT'],
  [/\b(replace|replacement|dying|worn)\b/i, 'REPLACEMENT'],
  [/\b(need|essential|required)\b/i, 'NEED'],
  [/\b(upgrade|better|improve)\b/i, 'USEFUL_UPGRADE'],
  [/\b(future|someday|one day|eventually|decision|tbc|tba|maybe)\b/i, 'FUTURE_DECISION'],
  [/\b(want|nice to have|wish)\b/i, 'WANT'],
];

/** Guess a priority from how the item is described. Always editable after. */
export function inferPriority(text: string): Priority {
  for (const [pattern, priority] of PRIORITY_PATTERNS) {
    if (pattern.test(text)) return priority;
  }
  return 'WANT';
}

const STATUS_PATTERNS: ReadonlyArray<[RegExp, WishlistStatus]> = [
  [/\b(ordered|on order|shipping|in transit|in progress|purchased|arriving)\b/i, 'ORDERED'],
  [/\b(bought|owned|arrived|delivered|done|have it)\b/i, 'BOUGHT'],
  [/\b(no longer|decided against|dropped|cancelled|declined|not buying)\b/i, 'DECLINED'],
  [/\b(parked|paused|on hold|later)\b/i, 'PARKED'],
];

export function inferStatus(text: string): WishlistStatus {
  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(text)) return status;
  }
  return 'CONSIDERING';
}

/** Strip a trailing price, status or note from a name. */
export function cleanName(text: string): string {
  return text
    .replace(/\s*[—–-]\s*\$[\d,.]+.*$/i, '')
    .replace(/\s*\(\s*\$[\d,.]+[^)]*\)\s*$/i, '')
    .replace(/\s*[—–-]\s*(ordered|bought|tbc|in progress|decision tbc)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn one row of loosely structured text into an item.
 *
 * `cells` is a table row, or a single-element array for a bullet point. The
 * first cell is treated as the name, and the rest are scanned for a price and
 * for status or priority words.
 */
export function parseRow(externalId: string, cells: readonly string[]): ParsedWishlistItem | null {
  const nonEmpty = cells.map((c) => c.trim()).filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return null;

  const nameCell = nonEmpty[0]!;
  const rest = nonEmpty.slice(1);
  const whole = nonEmpty.join(' · ');

  // Skip anything that reads like a header row.
  if (/^(item|thing|name|product)$/i.test(nameCell) && rest.some((c) => /^(price|cost|status|priority|notes?)$/i.test(c))) {
    return null;
  }

  // The price is whichever cell has one, falling back to the name itself.
  let price = { cents: null as number | null, raw: null as string | null };
  for (const cell of rest) {
    const found = extractPrice(cell);
    if (found.cents !== null) {
      price = found;
      break;
    }
  }
  if (price.cents === null) {
    const inName = extractPrice(nameCell);
    if (inName.cents !== null) price = inName;
  }

  const name = cleanName(nameCell) || nameCell;
  if (!name) return null;

  const url = /(https?:\/\/\S+)/.exec(whole)?.[1] ?? null;
  const notes = rest.length > 0 ? rest.join(' · ') : null;

  return {
    externalId,
    name,
    priceCents: price.cents,
    rawPrice: price.raw,
    priority: inferPriority(whole),
    status: inferStatus(whole),
    notes,
    url,
  };
}

/** Does this heading start the section we care about? */
export function isHorizonHeading(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('on the horizon') ||
    (t.includes('active') && t.includes('purchase')) ||
    t.includes('purchase consideration')
  );
}

export function isOpenReviewHeading(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes('open system review') || (t.includes('open') && t.includes('review'));
}

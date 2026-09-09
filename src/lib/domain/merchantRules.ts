/**
 * Merchant rules and tagging.
 *
 * Up's own categories are decent but they do not know that a bike shop is Gear
 * rather than general shopping, or that a particular psychology practice is
 * Health rather than services. Rules fill that gap.
 *
 * The seeds below are SUGGESTIONS written into the database on first run and
 * editable from Settings after that. No merchant name is hard-coded into a
 * calculation path.
 *
 * Tag changes default to dry run. The app shows what it would tag and changes
 * nothing in Up until that is explicitly turned on.
 */

import type { AccountRole, MatchType } from '@prisma/client';

export interface MerchantRuleLike {
  id: string;
  pattern: string;
  matchType: MatchType;
  role: AccountRole | null;
  tag: string | null;
  priority: number;
  enabled: boolean;
}

export interface RuleTarget {
  description: string;
  rawText?: string | null;
  message?: string | null;
}

export interface RuleMatch {
  ruleId: string;
  pattern: string;
  role: AccountRole | null;
  tag: string | null;
  /** Which field matched, for the explanation. */
  matchedOn: 'description' | 'rawText' | 'message';
}

export function ruleMatches(rule: MerchantRuleLike, target: RuleTarget): RuleMatch | null {
  if (!rule.enabled) return null;

  const fields: Array<['description' | 'rawText' | 'message', string]> = [
    ['description', target.description ?? ''],
    ['rawText', target.rawText ?? ''],
    ['message', target.message ?? ''],
  ];

  for (const [field, value] of fields) {
    if (!value) continue;
    if (matchText(value, rule.pattern, rule.matchType)) {
      return {
        ruleId: rule.id,
        pattern: rule.pattern,
        role: rule.role,
        tag: rule.tag,
        matchedOn: field,
      };
    }
  }
  return null;
}

function matchText(haystack: string, pattern: string, matchType: MatchType): boolean {
  const h = haystack.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (!p) return false;
  switch (matchType) {
    case 'EXACT':
      return h.trim() === p;
    case 'CONTAINS':
      return h.includes(p);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(haystack);
      } catch {
        return false;
      }
  }
}

/** The highest-priority matching rule, or null. Ties break on rule id. */
export function firstMatchingRule(
  rules: readonly MerchantRuleLike[],
  target: RuleTarget,
): RuleMatch | null {
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const match = ruleMatches(rule, target);
    if (match) return match;
  }
  return null;
}

/** Every matching rule, so several tags can apply to one transaction. */
export function allMatchingRules(
  rules: readonly MerchantRuleLike[],
  target: RuleTarget,
): RuleMatch[] {
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return ordered.map((r) => ruleMatches(r, target)).filter((m): m is RuleMatch => m !== null);
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

export type RoleResolution = {
  role: AccountRole | null;
  source: 'MERCHANT_RULE' | 'UP_CATEGORY' | 'ACCOUNT' | 'TAG' | 'UNRESOLVED';
  explanation: string;
};

/**
 * Up's parent categories, mapped to our roles. Only used as a fallback when no
 * merchant rule matched, so a rule always wins over Up's guess.
 *
 * These ids come from Up's own category tree (GET /categories).
 */
export const UP_PARENT_CATEGORY_TO_ROLE: Record<string, AccountRole> = {
  'good-life': 'FUN',
  personal: 'FUN',
  home: 'BILLS',
  transport: 'TRANSPORT',
};

export const UP_CATEGORY_TO_ROLE: Record<string, AccountRole> = {
  'restaurants-and-cafes': 'DINING_SOCIAL',
  takeaway: 'DINING_SOCIAL',
  'pubs-and-bars': 'DINING_SOCIAL',
  'booze': 'DINING_SOCIAL',
  'groceries': 'GROCERIES',
  'health-and-medical': 'HEALTH_THERAPY',
  'fitness-and-wellbeing': 'HEALTH_THERAPY',
  'life-admin': 'BILLS',
  'utilities': 'BILLS',
  'internet': 'BILLS',
  'mobile-phone': 'BILLS',
  'rent-and-mortgage': 'RENT',
  'public-transport': 'TRANSPORT',
  'fuel': 'TRANSPORT',
  'taxis-and-share-cars': 'TRANSPORT',
  'car-insurance-and-maintenance': 'TRANSPORT',
  'parking': 'TRANSPORT',
  'holidays-and-travel': 'TRAVEL',
  'hotels-and-accommodation': 'TRAVEL',
  'clothing-and-accessories': 'GEAR_OBJECTS',
  'homeware-and-appliances': 'GEAR_OBJECTS',
  'hobbies': 'GEAR_OBJECTS',
  'technology': 'GEAR_OBJECTS',
  'games-and-software': 'FUN',
  'events-and-gigs': 'FUN',
  'tv-and-music': 'FUN',
  'adult': 'FUN',
  'gifts-and-charity': 'FUN',
  'investments': 'INVESTING',
};

/**
 * Work out which budget bucket a transaction belongs to.
 *
 * Order of authority, highest first:
 *   1. a merchant rule I wrote
 *   2. a tag that names a bucket
 *   3. Up's own category
 *   4. the account the money came from, when that account has a purpose
 *
 * The source is returned with the answer, so the transaction list can say why
 * something landed where it did.
 */
export function resolveRole(input: {
  target: RuleTarget;
  rules: readonly MerchantRuleLike[];
  tags?: readonly string[];
  upCategoryId?: string | null;
  upParentCategoryId?: string | null;
  accountRole?: AccountRole | null;
}): RoleResolution {
  const { target, rules, tags = [], upCategoryId, upParentCategoryId, accountRole } = input;

  const ruleMatch = firstMatchingRule(rules, target);
  if (ruleMatch?.role) {
    return {
      role: ruleMatch.role,
      source: 'MERCHANT_RULE',
      explanation: `Matched the rule "${ruleMatch.pattern}" on the ${ruleMatch.matchedOn}.`,
    };
  }

  const tagRole = tags.map(tagToRole).find((r): r is AccountRole => r !== null);
  if (tagRole) {
    return {
      role: tagRole,
      source: 'TAG',
      explanation: `Tagged in Up in a way that names a bucket.`,
    };
  }

  if (upCategoryId && UP_CATEGORY_TO_ROLE[upCategoryId]) {
    return {
      role: UP_CATEGORY_TO_ROLE[upCategoryId]!,
      source: 'UP_CATEGORY',
      explanation: `Up categorised this as "${upCategoryId.replace(/-/g, ' ')}".`,
    };
  }

  if (upParentCategoryId && UP_PARENT_CATEGORY_TO_ROLE[upParentCategoryId]) {
    return {
      role: UP_PARENT_CATEGORY_TO_ROLE[upParentCategoryId]!,
      source: 'UP_CATEGORY',
      explanation: `Up placed this under "${upParentCategoryId.replace(/-/g, ' ')}".`,
    };
  }

  if (accountRole && accountRole !== 'SPENDING' && accountRole !== 'OTHER') {
    return {
      role: accountRole,
      source: 'ACCOUNT',
      explanation: `Came out of the ${accountRole.toLowerCase().replace(/_/g, ' ')} account.`,
    };
  }

  return {
    role: null,
    source: 'UNRESOLVED',
    explanation: 'No rule, tag or category matched. Assign it by hand or add a rule.',
  };
}

const TAG_ROLE_MAP: Record<string, AccountRole> = {
  gear: 'GEAR_OBJECTS',
  bikepacking: 'GEAR_OBJECTS',
  therapy: 'HEALTH_THERAPY',
  travel: 'TRAVEL',
  investing: 'INVESTING',
  groceries: 'GROCERIES',
};

function tagToRole(tag: string): AccountRole | null {
  return TAG_ROLE_MAP[tag.toLowerCase().trim()] ?? null;
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Tags worth having. Written to the database as suggestions, then editable. */
export const SUGGESTED_TAGS = [
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
] as const;

export interface SeedRule {
  pattern: string;
  matchType: MatchType;
  role: AccountRole | null;
  tag: string | null;
  priority: number;
  note: string;
}

/**
 * Starting suggestions only. Every one of these can be edited or deleted in
 * Settings, and none is referenced by name anywhere else in the code.
 */
export const SEED_MERCHANT_RULES: readonly SeedRule[] = [
  { pattern: 'MAAP', matchType: 'CONTAINS', role: 'GEAR_OBJECTS', tag: 'Gear', priority: 100, note: 'Cycling apparel' },
  { pattern: 'Paddy Pallin', matchType: 'CONTAINS', role: 'GEAR_OBJECTS', tag: 'Gear', priority: 100, note: 'Outdoor gear' },
  { pattern: 'Sea to Summit', matchType: 'CONTAINS', role: 'GEAR_OBJECTS', tag: 'Bikepacking', priority: 100, note: 'Outdoor gear' },
  { pattern: 'Wild Earth', matchType: 'CONTAINS', role: 'GEAR_OBJECTS', tag: 'Bikepacking', priority: 100, note: 'Outdoor gear' },
  { pattern: 'Macpac', matchType: 'CONTAINS', role: 'GEAR_OBJECTS', tag: 'Gear', priority: 100, note: 'Outdoor gear' },
  { pattern: 'Psychology', matchType: 'CONTAINS', role: 'HEALTH_THERAPY', tag: 'Therapy', priority: 90, note: 'Therapy' },
  { pattern: 'Betashares', matchType: 'CONTAINS', role: 'INVESTING', tag: 'Investing', priority: 110, note: 'Long-term investing' },
  { pattern: 'Hostplus', matchType: 'CONTAINS', role: 'INVESTING', tag: 'Investing', priority: 110, note: 'Super' },
  { pattern: 'Spotify', matchType: 'CONTAINS', role: 'FUN', tag: 'Subscription', priority: 80, note: 'Subscription' },
  { pattern: 'Netflix', matchType: 'CONTAINS', role: 'FUN', tag: 'Subscription', priority: 80, note: 'Subscription' },
  { pattern: 'Woolworths', matchType: 'CONTAINS', role: 'GROCERIES', tag: null, priority: 70, note: 'Groceries' },
  { pattern: 'Coles', matchType: 'CONTAINS', role: 'GROCERIES', tag: null, priority: 70, note: 'Groceries' },
  { pattern: 'Aldi', matchType: 'CONTAINS', role: 'GROCERIES', tag: null, priority: 70, note: 'Groceries' },
  { pattern: 'Opal', matchType: 'CONTAINS', role: 'TRANSPORT', tag: null, priority: 70, note: 'Public transport' },
  { pattern: 'Transport for NSW', matchType: 'CONTAINS', role: 'TRANSPORT', tag: null, priority: 70, note: 'Public transport' },
];

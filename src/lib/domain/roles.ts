/**
 * Account roles.
 *
 * A role is the stable internal identity of a money bucket. Up account names
 * are free text that I can rename at any time, so nothing in this app keys
 * behaviour off a display name. The mapping from Up account to role lives in
 * the database and is configured once during setup.
 */

import type { AccountRole } from '@prisma/client';

export const ACCOUNT_ROLES = [
  'SPENDING',
  'RENT',
  'BILLS',
  'HEALTH_THERAPY',
  'GROCERIES',
  'DINING_SOCIAL',
  'FUN',
  'TRANSPORT',
  'TRAVEL',
  'GEAR_OBJECTS',
  'EMERGENCY',
  'FUTURE_OPTIONS',
  'BUFFER',
  'INVESTING',
  'OTHER',
] as const satisfies readonly AccountRole[];

export interface RoleDefinition {
  role: AccountRole;
  label: string;
  /** One line explaining what this bucket is for. Shown in Settings. */
  purpose: string;
  /** Balance never counts toward safe-to-spend; transfers out are reviewed. */
  protected: boolean;
  /** Counts toward safe discretionary spending. */
  discretionary: boolean;
  /** Essential spending, given a wider tolerance before being called out. */
  essential: boolean;
  /** Appears as a row on the Pay Cycle screen. */
  budgeted: boolean;
  /** Money that must not be spent this cycle: rent and bills are reserved. */
  reserved: boolean;
  sortOrder: number;
}

const DEFINITIONS: Record<AccountRole, RoleDefinition> = {
  SPENDING: {
    role: 'SPENDING',
    label: 'Spending',
    purpose: 'The everyday transaction account. Money passes through it rather than living here.',
    protected: false,
    discretionary: false,
    essential: false,
    budgeted: false,
    reserved: false,
    sortOrder: 0,
  },
  RENT: {
    role: 'RENT',
    label: 'Rent',
    purpose: 'A fixed amount taken off the top of every pay before anything else is worked out.',
    protected: false,
    discretionary: false,
    essential: true,
    budgeted: true,
    reserved: true,
    sortOrder: 1,
  },
  BILLS: {
    role: 'BILLS',
    label: 'Bills',
    purpose: 'Known recurring commitments. Treated as already spoken for.',
    protected: false,
    discretionary: false,
    essential: true,
    budgeted: true,
    reserved: true,
    sortOrder: 2,
  },
  HEALTH_THERAPY: {
    role: 'HEALTH_THERAPY',
    label: 'Health & Therapy',
    purpose: 'Therapy, health cover, medical. Essential, and never something to run lean on.',
    protected: false,
    discretionary: false,
    essential: true,
    budgeted: true,
    reserved: false,
    sortOrder: 3,
  },
  GROCERIES: {
    role: 'GROCERIES',
    label: 'Groceries',
    purpose: 'Food from shops. Essential.',
    protected: false,
    discretionary: false,
    essential: true,
    budgeted: true,
    reserved: false,
    sortOrder: 4,
  },
  DINING_SOCIAL: {
    role: 'DINING_SOCIAL',
    label: 'Dining & Social',
    purpose: 'Eating out, drinks, seeing people. Discretionary and entirely legitimate.',
    protected: false,
    discretionary: true,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 5,
  },
  FUN: {
    role: 'FUN',
    label: 'Fun',
    purpose: 'Whatever fun means this fortnight.',
    protected: false,
    discretionary: true,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 6,
  },
  TRANSPORT: {
    role: 'TRANSPORT',
    label: 'Transport',
    purpose: 'Getting around. Essential.',
    protected: false,
    discretionary: false,
    essential: true,
    budgeted: true,
    reserved: false,
    sortOrder: 7,
  },
  TRAVEL: {
    role: 'TRAVEL',
    label: 'Travel',
    purpose: 'Travel only. Not a slush fund for gear or everyday life.',
    protected: false,
    discretionary: false,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 8,
  },
  GEAR_OBJECTS: {
    role: 'GEAR_OBJECTS',
    label: 'Gear & Objects',
    purpose:
      'Things. Funded only by its own share of income. If it is not in here, the answer is not yet.',
    protected: false,
    discretionary: true,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 9,
  },
  EMERGENCY: {
    role: 'EMERGENCY',
    label: 'Emergency',
    purpose: 'Defensive only. Not for overspending, gear, travel or routine bills.',
    protected: true,
    discretionary: false,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 10,
  },
  FUTURE_OPTIONS: {
    role: 'FUTURE_OPTIONS',
    label: 'Future Options',
    purpose:
      'Career change, study, relocation, a break. The price of being able to say no to something.',
    protected: true,
    discretionary: false,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 11,
  },
  BUFFER: {
    role: 'BUFFER',
    label: 'Buffer',
    purpose: 'Slack in the system. Absorbs the ordinary overshoot so nothing else has to.',
    protected: false,
    discretionary: true,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 12,
  },
  INVESTING: {
    role: 'INVESTING',
    label: 'Investing',
    purpose: 'Long-term investing contributions. Leaves Up and does not come back.',
    protected: true,
    discretionary: false,
    essential: false,
    budgeted: true,
    reserved: false,
    sortOrder: 13,
  },
  OTHER: {
    role: 'OTHER',
    label: 'Other',
    purpose: 'Anything that does not belong to a bucket yet.',
    protected: false,
    discretionary: false,
    essential: false,
    budgeted: false,
    reserved: false,
    sortOrder: 99,
  },
};

export function roleDefinition(role: AccountRole): RoleDefinition {
  return DEFINITIONS[role];
}

export function roleLabel(role: AccountRole | null | undefined): string {
  if (!role) return 'Unassigned';
  return DEFINITIONS[role].label;
}

export function allRoleDefinitions(): RoleDefinition[] {
  return ACCOUNT_ROLES.map((r) => DEFINITIONS[r]).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Roles that appear as budget rows on the Pay Cycle screen, in display order. */
export function budgetedRoles(): AccountRole[] {
  return allRoleDefinitions()
    .filter((d) => d.budgeted)
    .map((d) => d.role);
}

/**
 * Default protection. Emergency, Future Options and Investing are protected:
 * their balances never count as spendable and money leaving them is worth
 * noticing. This is only the default — Settings can override per account.
 */
export function defaultIsProtected(role: AccountRole): boolean {
  return DEFINITIONS[role].protected;
}

export function defaultIsDiscretionary(role: AccountRole): boolean {
  return DEFINITIONS[role].discretionary;
}

export function isEssential(role: AccountRole): boolean {
  return DEFINITIONS[role].essential;
}

export function isReserved(role: AccountRole): boolean {
  return DEFINITIONS[role].reserved;
}

/**
 * Roles that must never be raided to fund a purchase. The Buy It engine will
 * not suggest topping up from any of these, ever.
 */
export const NEVER_RAID_ROLES: readonly AccountRole[] = [
  'EMERGENCY',
  'FUTURE_OPTIONS',
  'TRAVEL',
  'INVESTING',
];

/**
 * Roles whose outbound transfers are always worth a look, regardless of what
 * the money was spent on afterwards.
 */
export const ALWAYS_REVIEW_TRANSFER_OUT: readonly AccountRole[] = ['EMERGENCY', 'FUTURE_OPTIONS'];

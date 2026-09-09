/**
 * Settings.
 *
 * Every financial assumption this app makes lives in the database, not in
 * source. Rent, targets, percentages, thresholds, waiting periods, the salary
 * rule — all of it is editable from Settings.
 *
 * The values written on first run are the system as it stands today. They are
 * a starting point, not a constant.
 */

import 'server-only';

import type { AccountRole, Phase, Settings } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PHASE_1_DEFAULTS, PHASE_2_DEFAULTS, toBasisPointRows } from '@/lib/domain/phases';
import { SEED_MERCHANT_RULES } from '@/lib/domain/merchantRules';
import { DEFAULT_THRESHOLDS, type StatusThresholds } from '@/lib/domain/status';
import type { LeakageSettings } from '@/lib/domain/leakage';
import type { WaitTiers } from '@/lib/domain/buyIt';
import type { RecurringSettings } from '@/lib/domain/recurring';

export const SETTINGS_ID = 1;

/**
 * Load settings, creating the row with defaults on first call.
 *
 * Seeding lives here rather than in a migration so that a fresh database, a
 * reset, and a deploy to a new environment all converge on the same state
 * without anyone having to remember to run a script.
 */
export async function getSettings(): Promise<Settings> {
  const existing = await prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return seedDefaults();
}

export async function seedDefaults(): Promise<Settings> {
  const settings = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });

  await seedAllocationPercents();
  await seedSalaryRules();
  await seedMerchantRules();
  await seedGoals();
  await seedExternalAssets();

  return settings;
}

async function seedAllocationPercents(): Promise<void> {
  const count = await prisma.allocationPercent.count();
  if (count > 0) return;

  const rows = [
    ...toBasisPointRows(PHASE_1_DEFAULTS).map((r) => ({ ...r, phase: 'PHASE_1' as Phase })),
    ...toBasisPointRows(PHASE_2_DEFAULTS).map((r) => ({ ...r, phase: 'PHASE_2' as Phase })),
  ];
  await prisma.allocationPercent.createMany({ data: rows, skipDuplicates: true });
}

/**
 * The starting salary rule.
 *
 * The employer name is a seed value in a database row, editable in Settings.
 * Nothing in the calculation path knows this string exists.
 */
async function seedSalaryRules(): Promise<void> {
  const count = await prisma.salaryRule.count();
  if (count > 0) return;

  await prisma.salaryRule.createMany({
    data: [
      {
        label: 'City of Sydney salary',
        pattern: 'City of Sydney',
        matchType: 'CONTAINS',
        minCents: 200_000,
        priority: 100,
        enabled: true,
      },
      {
        label: 'Council of the City of Sydney',
        pattern: 'Council of the City of Sydney',
        matchType: 'CONTAINS',
        minCents: 200_000,
        priority: 110,
        enabled: true,
      },
    ],
  });
}

async function seedMerchantRules(): Promise<void> {
  const count = await prisma.merchantRule.count();
  if (count > 0) return;

  await prisma.merchantRule.createMany({
    data: SEED_MERCHANT_RULES.map((r) => ({
      pattern: r.pattern,
      matchType: r.matchType,
      role: r.role,
      tag: r.tag,
      priority: r.priority,
      note: r.note,
      isSeed: true,
      enabled: true,
    })),
  });
}

async function seedGoals(): Promise<void> {
  const count = await prisma.financialGoal.count();
  if (count > 0) return;

  await prisma.financialGoal.createMany({
    data: [
      {
        key: 'emergency',
        name: 'Emergency',
        role: 'EMERGENCY',
        targetCents: 1_200_000,
        isHardFloor: true,
        sortOrder: 0,
      },
      {
        key: 'future_options',
        name: 'Future Options',
        role: 'FUTURE_OPTIONS',
        targetCents: 1_000_000,
        isHardFloor: false,
        sortOrder: 1,
      },
    ],
  });
}

async function seedExternalAssets(): Promise<void> {
  const count = await prisma.externalAsset.count();
  if (count > 0) return;

  await prisma.externalAsset.createMany({
    data: [
      {
        key: 'hostplus',
        name: 'Hostplus Indexed Growth',
        provider: 'Hostplus',
        note: 'Super. Up cannot see this, so the balance is whatever was last entered by hand.',
        sortOrder: 0,
      },
      {
        key: 'dhhf',
        name: 'DHHF',
        provider: 'Betashares Direct',
        note: 'Core long-term holding. Snapshots only — this app does not track market prices.',
        sortOrder: 1,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Derived views of settings
// ---------------------------------------------------------------------------

export async function getAllocationPercents(
  phase: Phase,
): Promise<Array<{ role: AccountRole; basisPoints: number }>> {
  const rows = await prisma.allocationPercent.findMany({
    where: { phase },
    orderBy: { role: 'asc' },
  });
  return rows.map((r) => ({ role: r.role, basisPoints: r.basisPoints }));
}

export function thresholdsFrom(settings: Settings): StatusThresholds {
  return {
    runningHotDeltaPct: settings.runningHotDeltaPct ?? DEFAULT_THRESHOLDS.runningHotDeltaPct,
    nearLimitRemainingPct: settings.nearLimitRemainingPct ?? DEFAULT_THRESHOLDS.nearLimitRemainingPct,
    essentialLeewayPct: settings.essentialLeewayPct ?? DEFAULT_THRESHOLDS.essentialLeewayPct,
  };
}

export function leakageSettingsFrom(settings: Settings): LeakageSettings {
  return {
    windowMinutes: settings.leakageWindowMinutes,
    tolerancePct: settings.leakageTolerancePct,
    minCents: settings.leakageMinCents,
  };
}

export function waitTiersFrom(settings: Settings): WaitTiers {
  return {
    tier1MaxCents: settings.waitTier1MaxCents,
    tier2MaxCents: settings.waitTier2MaxCents,
    tier3MaxCents: settings.waitTier3MaxCents,
    tier1Hours: settings.waitTier1Hours,
    tier2Hours: settings.waitTier2Hours,
    tier3Hours: settings.waitTier3Hours,
    tier4Hours: settings.waitTier4Hours,
  };
}

export function recurringSettingsFrom(settings: Settings): RecurringSettings {
  return {
    minOccurrences: settings.recurringMinOccurrences,
    minConfidence: settings.recurringMinConfidence,
    minAmountCents: 200,
  };
}

export async function getSalaryRules() {
  return prisma.salaryRule.findMany({ orderBy: [{ priority: 'desc' }, { id: 'asc' }] });
}

export async function getMerchantRules() {
  return prisma.merchantRule.findMany({ orderBy: [{ priority: 'desc' }, { id: 'asc' }] });
}

// ---------------------------------------------------------------------------
// Account mappings
// ---------------------------------------------------------------------------

export interface MappedAccount {
  accountId: string;
  displayName: string;
  accountType: string;
  balanceCents: number;
  role: AccountRole | null;
  isProtected: boolean;
  isDiscretionary: boolean;
}

export async function getMappedAccounts(): Promise<MappedAccount[]> {
  const accounts = await prisma.account.findMany({
    include: { mapping: true },
    orderBy: { displayName: 'asc' },
  });

  return accounts.map((a) => ({
    accountId: a.id,
    displayName: a.mapping?.displayName ?? a.displayName,
    accountType: a.accountType,
    balanceCents: a.balanceCents,
    role: a.mapping?.role ?? null,
    isProtected: a.mapping?.isProtected ?? false,
    isDiscretionary: a.mapping?.isDiscretionary ?? false,
  }));
}

/** Account id -> role, for resolving which bucket a transaction belongs to. */
export async function getAccountRoleMap(): Promise<Map<string, AccountRole>> {
  const mappings = await prisma.accountRoleMapping.findMany();
  return new Map(mappings.map((m) => [m.accountId, m.role]));
}

/** Role -> total balance across every account mapped to it. */
export async function getBalancesByRole(): Promise<Map<AccountRole, number>> {
  const accounts = await prisma.account.findMany({ include: { mapping: true } });
  const balances = new Map<AccountRole, number>();
  for (const account of accounts) {
    const role = account.mapping?.role;
    if (!role) continue;
    balances.set(role, (balances.get(role) ?? 0) + account.balanceCents);
  }
  return balances;
}

export async function getRoleBalance(role: AccountRole): Promise<number> {
  return (await getBalancesByRole()).get(role) ?? 0;
}

/** Total across accounts that are not protected. The safe-to-spend ceiling. */
export async function getLiquidBalance(): Promise<number> {
  const accounts = await prisma.account.findMany({ include: { mapping: true } });
  return accounts
    .filter((a) => !a.mapping?.isProtected && a.mapping?.role !== 'TRAVEL')
    .reduce((acc, a) => acc + a.balanceCents, 0);
}

// ---------------------------------------------------------------------------
// Setup state
// ---------------------------------------------------------------------------

export interface SetupState {
  hasAccounts: boolean;
  mappedCount: number;
  unmappedCount: number;
  hasSpendingAccount: boolean;
  hasSalaryRule: boolean;
  hasDetectedSalary: boolean;
  hasTransactions: boolean;
  complete: boolean;
  /** Actionable, ordered. Rendered on the setup screen and as review items. */
  missing: string[];
}

export async function getSetupState(): Promise<SetupState> {
  const [accountCount, mappings, salaryRuleCount, salaryTxCount, txCount] = await Promise.all([
    prisma.account.count(),
    prisma.accountRoleMapping.findMany(),
    prisma.salaryRule.count({ where: { enabled: true } }),
    prisma.transaction.count({ where: { isSalary: true } }),
    prisma.transaction.count(),
  ]);

  const missing: string[] = [];
  if (accountCount === 0) missing.push('No accounts have been loaded yet. Run a sync.');
  if (accountCount > 0 && mappings.length === 0) {
    missing.push('No Up accounts are mapped to roles yet. Map them in Setup.');
  }
  const hasSpendingAccount = mappings.some((m) => m.role === 'SPENDING');
  if (accountCount > 0 && !hasSpendingAccount) {
    missing.push('No account is mapped to Spending, so everyday spending cannot be tracked.');
  }
  if (salaryRuleCount === 0) missing.push('No salary rule is set, so pay cycles cannot be found.');
  if (txCount > 0 && salaryTxCount === 0) {
    missing.push('No salary payments were found. Check the salary rule in Settings.');
  }

  return {
    hasAccounts: accountCount > 0,
    mappedCount: mappings.length,
    unmappedCount: Math.max(0, accountCount - mappings.length),
    hasSpendingAccount,
    hasSalaryRule: salaryRuleCount > 0,
    hasDetectedSalary: salaryTxCount > 0,
    hasTransactions: txCount > 0,
    complete: missing.length === 0,
    missing,
  };
}

'use server';

/**
 * Server actions.
 *
 * Every one of these starts with a session check. Middleware is a first pass
 * only — it cannot verify the cookie signature on the Edge runtime — so the
 * real check happens here, on the server, every time.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AccountRole, LeakageVerdict, Priority, RecurringStatus, WishlistStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { endSession, requireSession } from '@/lib/auth/session';
import { parseDecimalToCents } from '@/lib/money';
import { defaultIsDiscretionary, defaultIsProtected } from '@/lib/domain/roles';
import { validateAllocation } from '@/lib/domain/phases';
import { runSync, classifyTransactions, rebuildPayCycles, checkPhaseAndMilestones } from '@/lib/services/sync';
import { setLeakageVerdict } from '@/lib/services/leakageService';
import { setRecurringStatus } from '@/lib/services/recurringService';
import { dismissAllReviewItems, dismissReviewItem } from '@/lib/services/reviewItems';
import { getAllocationPercents, getSettings } from '@/lib/services/settings';
import { syncNotionWishlist } from '@/lib/services/wishlist';
import {
  AiError,
  regeneratePlanningAiInsight,
  regenerateReviewAiInsight,
  regenerateTodayAiInsight,
} from '@/lib/services/aiInsight';
import type { ReviewPeriod } from '@/lib/services/review';
import { pushSimulatedPayday } from '@/lib/up/gateway';
import { useMockData } from '@/lib/env';

const APP_PATHS = [
  '/today',
  '/pay-cycle',
  '/goals',
  '/shopping',
  '/review',
  '/transactions',
  '/settings',
  '/setup',
];

function revalidateAll() {
  for (const path of APP_PATHS) revalidatePath(path);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signOutAction() {
  await endSession();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncAction() {
  await requireSession();
  await runSync({ kind: 'MANUAL' });
  revalidateAll();
}

export async function importHistoryAction(formData: FormData) {
  await requireSession();
  const months = Number(formData.get('months') ?? 6);
  await runSync({
    kind: 'HISTORICAL_IMPORT',
    months: Number.isFinite(months) ? Math.min(24, Math.max(1, months)) : 6,
    since: new Date(Date.now() - Math.min(24, Math.max(1, months)) * 30.44 * 86_400_000),
  });
  revalidateAll();
}

export async function recalculateAction() {
  await requireSession();
  await classifyTransactions();
  await rebuildPayCycles();
  await checkPhaseAndMilestones();
  revalidateAll();
}

/**
 * Add a payday to the mock feed and sync it in.
 *
 * Mock mode only, and guarded rather than merely hidden: a button that is not
 * rendered is not a permission check.
 */
export async function simulatePaydayAction() {
  await requireSession();
  if (!useMockData()) throw new Error('Simulating a payday is only available in mock mode.');

  const settings = await getSettings();
  const percentages = await getAllocationPercents(settings.phase);

  // Map roles to the mock accounts that carry them.
  const mappings = await prisma.accountRoleMapping.findMany();
  const accountByRole = new Map<AccountRole, string>();
  for (const mapping of mappings) {
    if (!accountByRole.has(mapping.role)) accountByRole.set(mapping.role, mapping.accountId);
  }

  const splits = percentages
    .filter((p) => p.basisPoints > 0 && p.role !== 'INVESTING' && accountByRole.has(p.role))
    .map((p) => ({ accountId: accountByRole.get(p.role)!, basisPoints: p.basisPoints }));

  const investing = percentages.find((p) => p.role === 'INVESTING');

  pushSimulatedPayday({
    now: new Date(),
    salaryCents: settings.typicalSalaryCents,
    rentCents: settings.rentCents,
    splits,
    investingBasisPoints: investing?.basisPoints ?? 0,
  });

  await runSync({ kind: 'MANUAL', since: new Date(Date.now() - 86_400_000) });
  revalidateAll();
  redirect('/pay-cycle');
}

// ---------------------------------------------------------------------------
// Account mapping
// ---------------------------------------------------------------------------

export async function saveAccountMappingAction(formData: FormData) {
  await requireSession();

  const accountIds = formData.getAll('accountId').map(String);

  for (const accountId of accountIds) {
    const roleValue = String(formData.get(`role:${accountId}`) ?? '');

    if (!roleValue) {
      await prisma.accountRoleMapping.deleteMany({ where: { accountId } });
      continue;
    }

    const role = roleValue as AccountRole;
    const isProtected = formData.get(`protected:${accountId}`) === 'on';
    const isDiscretionary = formData.get(`discretionary:${accountId}`) === 'on';

    await prisma.accountRoleMapping.upsert({
      where: { accountId },
      create: { accountId, role, isProtected, isDiscretionary },
      update: { role, isProtected, isDiscretionary },
    });
  }

  // Roles change what everything means, so everything derived is rebuilt.
  await classifyTransactions();
  await rebuildPayCycles();
  await checkPhaseAndMilestones();
  revalidateAll();
}

/** Suggest protection and discretionary flags from the chosen role. */
export async function applyRoleDefaultsAction(formData: FormData) {
  await requireSession();
  const accountId = String(formData.get('accountId') ?? '');
  const role = String(formData.get('role') ?? '') as AccountRole;
  if (!accountId || !role) return;

  await prisma.accountRoleMapping.upsert({
    where: { accountId },
    create: {
      accountId,
      role,
      isProtected: defaultIsProtected(role),
      isDiscretionary: defaultIsDiscretionary(role),
    },
    update: {
      role,
      isProtected: defaultIsProtected(role),
      isDiscretionary: defaultIsDiscretionary(role),
    },
  });
  revalidateAll();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveSettingsAction(formData: FormData) {
  await requireSession();
  const settings = await getSettings();

  const money = (key: string, fallback: number): number => {
    const raw = formData.get(key);
    if (raw === null || String(raw).trim() === '') return fallback;
    try {
      return parseDecimalToCents(String(raw));
    } catch {
      return fallback;
    }
  };

  const int = (key: string, fallback: number, min: number, max: number): number => {
    const value = Number(formData.get(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  await prisma.settings.update({
    where: { id: settings.id },
    data: {
      rentCents: money('rentCents', settings.rentCents),
      emergencyTargetCents: money('emergencyTargetCents', settings.emergencyTargetCents),
      futureOptionsTargetCents: money('futureOptionsTargetCents', settings.futureOptionsTargetCents),
      typicalSalaryCents: money('typicalSalaryCents', settings.typicalSalaryCents),
      salaryMinCents: money('salaryMinCents', settings.salaryMinCents),
      salaryCadence: (formData.get('salaryCadence') as 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY') ?? settings.salaryCadence,
      runningHotDeltaPct: int('runningHotDeltaPct', settings.runningHotDeltaPct, 1, 100),
      nearLimitRemainingPct: int('nearLimitRemainingPct', settings.nearLimitRemainingPct, 1, 90),
      essentialLeewayPct: int('essentialLeewayPct', settings.essentialLeewayPct, 0, 100),
      leakageWindowMinutes: int('leakageWindowMinutes', settings.leakageWindowMinutes, 5, 1440),
      leakageTolerancePct: int('leakageTolerancePct', settings.leakageTolerancePct, 1, 100),
      leakageMinCents: money('leakageMinCents', settings.leakageMinCents),
      waitTier1MaxCents: money('waitTier1MaxCents', settings.waitTier1MaxCents),
      waitTier2MaxCents: money('waitTier2MaxCents', settings.waitTier2MaxCents),
      waitTier3MaxCents: money('waitTier3MaxCents', settings.waitTier3MaxCents),
      waitTier2Hours: int('waitTier2Hours', settings.waitTier2Hours, 0, 8760),
      waitTier3Hours: int('waitTier3Hours', settings.waitTier3Hours, 0, 8760),
      waitTier4Hours: int('waitTier4Hours', settings.waitTier4Hours, 0, 8760),
      recurringMinOccurrences: int('recurringMinOccurrences', settings.recurringMinOccurrences, 2, 12),
      recurringMinConfidence: int('recurringMinConfidence', settings.recurringMinConfidence, 0, 100),
      autoTagMode:
        (formData.get('autoTagMode') as 'DRY_RUN' | 'APPLY_LOCAL' | 'APPLY_TO_UP') ??
        settings.autoTagMode,
      historicalImportMonths: int('historicalImportMonths', settings.historicalImportMonths, 1, 24),
      timezone: String(formData.get('timezone') ?? settings.timezone),
    },
  });

  // Targets live in two places by design: Settings holds the plan, goals hold
  // the trackable objects. Keep them in step.
  await prisma.financialGoal.updateMany({
    where: { key: 'emergency' },
    data: { targetCents: money('emergencyTargetCents', settings.emergencyTargetCents) },
  });
  await prisma.financialGoal.updateMany({
    where: { key: 'future_options' },
    data: { targetCents: money('futureOptionsTargetCents', settings.futureOptionsTargetCents) },
  });

  await rebuildPayCycles();
  await checkPhaseAndMilestones();
  revalidateAll();
}

/**
 * Save a phase's percentages.
 *
 * Refuses to save anything that does not add to exactly 100%. Saving a broken
 * split would quietly poison every allocation that followed.
 */
export async function saveAllocationAction(formData: FormData): Promise<void> {
  await requireSession();

  const phase = String(formData.get('phase') ?? 'PHASE_1') as 'PHASE_1' | 'PHASE_2';
  const existing = await prisma.allocationPercent.findMany({ where: { phase } });

  const rows = existing.map((row) => {
    const raw = formData.get(`pct:${row.role}`);
    const pct = Number(raw);
    return {
      id: row.id,
      role: row.role,
      basisPoints: Number.isFinite(pct) ? Math.round(pct * 100) : row.basisPoints,
    };
  });

  const validation = validateAllocation(rows);
  if (!validation.ok) {
    redirect(
      `/settings?tab=allocations&error=${encodeURIComponent(validation.message)}&phase=${phase}`,
    );
  }

  for (const row of rows) {
    await prisma.allocationPercent.update({
      where: { id: row.id },
      data: { basisPoints: row.basisPoints },
    });
  }

  await rebuildPayCycles();
  revalidateAll();
  redirect(`/settings?tab=allocations&saved=1&phase=${phase}`);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function saveSalaryRuleAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get('id') ?? '');
  const data = {
    label: String(formData.get('label') ?? 'Salary'),
    pattern: String(formData.get('pattern') ?? ''),
    matchType: (formData.get('matchType') as 'CONTAINS' | 'EXACT' | 'REGEX') ?? 'CONTAINS',
    minCents: formData.get('minCents') ? parseDecimalToCents(String(formData.get('minCents'))) : null,
    priority: Number(formData.get('priority') ?? 0),
    enabled: formData.get('enabled') !== 'off',
  };

  if (!data.pattern.trim()) return;

  if (id) {
    await prisma.salaryRule.update({ where: { id }, data });
  } else {
    await prisma.salaryRule.create({ data });
  }

  await classifyTransactions();
  await rebuildPayCycles();
  revalidateAll();
}

export async function deleteSalaryRuleAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.salaryRule.delete({ where: { id } });
  await classifyTransactions();
  await rebuildPayCycles();
  revalidateAll();
}

export async function saveMerchantRuleAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get('id') ?? '');
  const roleValue = String(formData.get('role') ?? '');
  const tagValue = String(formData.get('tag') ?? '').trim();

  const data = {
    pattern: String(formData.get('pattern') ?? '').trim(),
    matchType: (formData.get('matchType') as 'CONTAINS' | 'EXACT' | 'REGEX') ?? 'CONTAINS',
    role: roleValue ? (roleValue as AccountRole) : null,
    tag: tagValue || null,
    priority: Number(formData.get('priority') ?? 50),
    enabled: formData.get('enabled') !== 'off',
    note: String(formData.get('note') ?? '') || null,
  };

  if (!data.pattern) return;

  if (id) {
    await prisma.merchantRule.update({ where: { id }, data });
  } else {
    await prisma.merchantRule.create({ data: { ...data, isSeed: false } });
  }

  await classifyTransactions();
  revalidateAll();
}

export async function deleteMerchantRuleAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.merchantRule.delete({ where: { id } });
  await classifyTransactions();
  revalidateAll();
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function setTransactionRoleAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('transactionId') ?? '');
  const roleValue = String(formData.get('role') ?? '');
  if (!id) return;

  await prisma.transaction.update({
    where: { id },
    data: {
      role: roleValue ? (roleValue as AccountRole) : null,
      // MANUAL is sticky: a correction I made survives every future sync.
      roleSource: roleValue ? 'MANUAL' : 'UNRESOLVED',
      needsReview: false,
    },
  });
  revalidateAll();
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function setLeakageVerdictAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  const verdict = String(formData.get('verdict') ?? '') as LeakageVerdict;
  if (!id || !verdict) return;
  await setLeakageVerdict(id, verdict);
  revalidateAll();
}

export async function setRecurringStatusAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') as RecurringStatus;
  if (!id || !status) return;
  await setRecurringStatus(id, status);
  revalidateAll();
}

export async function dismissReviewItemAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await dismissReviewItem(id);
  revalidateAll();
}

export async function dismissAllReviewItemsAction() {
  await requireSession();
  await dismissAllReviewItems();
  revalidateAll();
}

// ---------------------------------------------------------------------------
// Goals and assets
// ---------------------------------------------------------------------------

export async function addAssetSnapshotAction(formData: FormData) {
  await requireSession();

  const assetId = String(formData.get('assetId') ?? '');
  const rawBalance = String(formData.get('balance') ?? '');
  if (!assetId || !rawBalance.trim()) return;

  let balanceCents: number;
  try {
    balanceCents = parseDecimalToCents(rawBalance);
  } catch {
    return;
  }

  const takenAtRaw = String(formData.get('takenAt') ?? '');
  const takenAt = takenAtRaw ? new Date(`${takenAtRaw}T12:00:00`) : new Date();

  await prisma.externalAssetSnapshot.upsert({
    where: { assetId_takenAt: { assetId, takenAt } },
    create: { assetId, balanceCents, takenAt, note: String(formData.get('note') ?? '') || null },
    update: { balanceCents, note: String(formData.get('note') ?? '') || null },
  });

  revalidateAll();
}

export async function addExternalAssetAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await prisma.externalAsset.upsert({
    where: { key },
    create: { key, name, provider: String(formData.get('provider') ?? '') || null },
    update: { name },
  });
  revalidateAll();
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export async function syncNotionAction() {
  await requireSession();
  await syncNotionWishlist();
  revalidatePath('/shopping');
}

// ---------------------------------------------------------------------------
// AI insights
//
// Both actions below call Claude, which costs money and can fail (no key,
// rate limit). redirect() throws internally, so it must happen after the
// try/catch settles — never inside it — or the redirect itself gets caught
// and reported as a generic failure.
// ---------------------------------------------------------------------------

export async function regenerateTodayInsightAction() {
  await requireSession();

  let errorMessage: string | null = null;
  try {
    await regenerateTodayAiInsight();
  } catch (error) {
    errorMessage = error instanceof AiError ? error.userMessage : 'Could not reach Claude.';
  }

  revalidateAll();
  if (errorMessage) redirect(`/today?aiError=${encodeURIComponent(errorMessage)}`);
}

export async function regenerateReviewInsightAction(formData: FormData) {
  await requireSession();
  const period = String(formData.get('period') ?? 'WEEK') as ReviewPeriod;

  let errorMessage: string | null = null;
  try {
    await regenerateReviewAiInsight(period);
  } catch (error) {
    errorMessage = error instanceof AiError ? error.userMessage : 'Could not reach Claude.';
  }

  revalidatePath('/review');
  if (errorMessage) {
    redirect(`/review?period=${period}&aiError=${encodeURIComponent(errorMessage)}`);
  }
}

export async function regeneratePlanningInsightAction() {
  await requireSession();

  let errorMessage: string | null = null;
  try {
    await regeneratePlanningAiInsight();
  } catch (error) {
    errorMessage = error instanceof AiError ? error.userMessage : 'Could not reach Claude.';
  }

  revalidatePath('/goals');
  if (errorMessage) redirect(`/goals?aiError=${encodeURIComponent(errorMessage)}`);
}

export async function saveWishlistItemAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const rawPrice = String(formData.get('price') ?? '').trim();
  let priceCents: number | null = null;
  if (rawPrice) {
    try {
      priceCents = parseDecimalToCents(rawPrice);
    } catch {
      priceCents = null;
    }
  }

  const data = {
    name,
    priceCents,
    rawPrice: rawPrice || null,
    priority: (String(formData.get('priority') ?? 'WANT') as Priority),
    status: (String(formData.get('status') ?? 'CONSIDERING') as WishlistStatus),
    role: (String(formData.get('role') ?? 'GEAR_OBJECTS') as AccountRole),
    notes: String(formData.get('notes') ?? '') || null,
    url: String(formData.get('url') ?? '') || null,
  };

  if (id) {
    await prisma.wishlistItem.update({ where: { id }, data });
  } else {
    // The waiting period counts from when an item entered consideration, so a
    // new item starts its clock now.
    await prisma.wishlistItem.create({ data: { ...data, source: 'LOCAL', addedAt: new Date() } });
  }

  revalidatePath('/shopping');
}

export async function archiveWishlistItemAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.wishlistItem.update({ where: { id }, data: { archived: true } });
  revalidatePath('/shopping');
}

export async function recordPurchaseDecisionAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') as WishlistStatus;
  if (!id || !status) return;
  await prisma.wishlistItem.update({ where: { id }, data: { status } });
  revalidatePath('/shopping');
}

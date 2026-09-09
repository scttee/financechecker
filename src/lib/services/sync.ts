/**
 * Synchronisation.
 *
 * Pulls accounts and transactions from the gateway, stores a normalised
 * projection, then re-derives everything that depends on them: which bucket
 * each transaction belongs to, where the pay cycles fall, what the
 * allocations were, and what the detectors have found.
 *
 * Idempotent throughout. Up transaction ids are the primary key, so running a
 * sync twice, or replaying a webhook, changes nothing. A HELD transaction that
 * settles updates its own row rather than arriving as a second purchase.
 */

import 'server-only';

import type { AccountRole, Phase, SyncKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getGateway } from '@/lib/up/gateway';
import { UpApiError, redact } from '@/lib/up/client';
import {
  hasMaterialChange,
  normaliseAccount,
  normaliseTransaction,
  toTransactionWrite,
  type NormalisedTransaction,
} from '@/lib/up/normalise';
import { resolveRole } from '@/lib/domain/merchantRules';
import {
  derivePayCycles,
  findSalaryTransactions,
  type SalaryRuleInput,
  type TransactionLike,
} from '@/lib/domain/payCycle';
import { calculatePaydayAllocation } from '@/lib/domain/allocation';
import { determinePhase } from '@/lib/domain/phases';
import { defaultIsDiscretionary, defaultIsProtected } from '@/lib/domain/roles';
import {
  getAllocationPercents,
  getMerchantRules,
  getSalaryRules,
  getSettings,
} from './settings';
import { detectAndStoreLeakage } from './leakageService';
import { detectAndStoreRecurring } from './recurringService';
import { raiseReviewItem } from './reviewItems';

export interface SyncResult {
  runId: string;
  ok: boolean;
  accountsSynced: number;
  transactionsSeen: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  pagesFetched: number;
  payCycles: number;
  leakageFound: number;
  recurringFound: number;
  /** Set when the sync failed or partially failed. Always token-free. */
  error: string | null;
  userMessage: string | null;
}

export interface SyncOptions {
  kind?: SyncKind;
  /** Only pull transactions on or after this instant. */
  since?: Date;
  /** Months of history for a first import. */
  months?: number;
  maxPages?: number;
}

/**
 * Run a sync.
 *
 * A failure part-way through is recorded as PARTIAL rather than thrown away:
 * whatever was written stays written, because a half-imported six months is
 * more useful than nothing, and the next run picks up from where this one got
 * to.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const settings = await getSettings();
  const kind: SyncKind = options.kind ?? 'MANUAL';
  const months = options.months ?? settings.historicalImportMonths;

  const since =
    options.since ??
    (await lastSyncedAt()) ??
    new Date(Date.now() - months * 30.44 * 86_400_000);

  const run = await prisma.syncRun.create({
    data: { kind, status: 'RUNNING', since: since.toISOString() },
  });

  const result: SyncResult = {
    runId: run.id,
    ok: false,
    accountsSynced: 0,
    transactionsSeen: 0,
    transactionsCreated: 0,
    transactionsUpdated: 0,
    pagesFetched: 0,
    payCycles: 0,
    leakageFound: 0,
    recurringFound: 0,
    error: null,
    userMessage: null,
  };

  try {
    const gateway = getGateway();

    // --- Accounts --------------------------------------------------------
    const accounts = await gateway.listAccounts();
    for (const resource of accounts) {
      const account = normaliseAccount(resource);
      await prisma.account.upsert({
        where: { id: account.id },
        create: { ...account, lastSyncedAt: new Date() },
        update: {
          displayName: account.displayName,
          accountType: account.accountType,
          ownershipType: account.ownershipType,
          balanceCents: account.balanceCents,
          lastSyncedAt: new Date(),
        },
      });
    }
    result.accountsSynced = accounts.length;

    // --- Transactions ----------------------------------------------------
    //
    // The window is pulled back a day from `since`. Up can settle a
    // transaction after it was first created, and re-reading a day of overlap
    // is cheap insurance against missing that update.
    const overlapped = new Date(since.getTime() - 86_400_000);
    const { items, pages } = await gateway.listTransactions(
      { since: overlapped, pageSize: 100 },
      { maxPages: options.maxPages ?? 200 },
    );
    result.pagesFetched = pages;
    result.transactionsSeen = items.length;

    const knownAccountIds = new Set(accounts.map((a) => a.id));

    for (const resource of items) {
      const normalised = normaliseTransaction(resource);

      // A transaction on an account we have not seen would violate the
      // foreign key. Skip rather than crash: the next sync picks it up once
      // the account exists.
      if (!knownAccountIds.has(normalised.accountId)) continue;
      const transferAccountId =
        normalised.transferAccountId && knownAccountIds.has(normalised.transferAccountId)
          ? normalised.transferAccountId
          : null;

      const existing = await prisma.transaction.findUnique({
        where: { id: normalised.id },
        select: {
          status: true,
          amountCents: true,
          settledAt: true,
          description: true,
          upCategoryId: true,
          deletedAt: true,
        },
      });

      const write = { ...toTransactionWrite(normalised), transferAccountId };

      if (!existing) {
        await prisma.transaction.create({ data: { id: normalised.id, ...write } });
        result.transactionsCreated += 1;
      } else {
        if (hasMaterialChange(existing, normalised)) result.transactionsUpdated += 1;
        await prisma.transaction.update({ where: { id: normalised.id }, data: write });
      }

      await syncTags(normalised);
    }

    // --- Everything derived ----------------------------------------------
    await classifyTransactions();
    const cycles = await rebuildPayCycles();
    result.payCycles = cycles;

    const leakage = await detectAndStoreLeakage();
    result.leakageFound = leakage;

    const recurring = await detectAndStoreRecurring();
    result.recurringFound = recurring;

    await checkPhaseAndMilestones();

    result.ok = true;

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        accountsSynced: result.accountsSynced,
        transactionsSeen: result.transactionsSeen,
        transactionsCreated: result.transactionsCreated,
        transactionsUpdated: result.transactionsUpdated,
        pagesFetched: result.pagesFetched,
      },
    });
  } catch (error) {
    const message =
      error instanceof UpApiError
        ? `${error.kind}: ${error.message}`
        : redact(error instanceof Error ? error.message : String(error));

    result.error = message;
    result.userMessage =
      error instanceof UpApiError
        ? error.userMessage
        : 'The sync did not finish. Whatever was imported has been kept, and running it again is safe.';

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: result.transactionsSeen > 0 ? 'PARTIAL' : 'FAILED',
        finishedAt: new Date(),
        accountsSynced: result.accountsSynced,
        transactionsSeen: result.transactionsSeen,
        transactionsCreated: result.transactionsCreated,
        transactionsUpdated: result.transactionsUpdated,
        pagesFetched: result.pagesFetched,
        error: message.slice(0, 1000),
      },
    });

    if (error instanceof UpApiError && error.kind === 'UNAUTHORISED') {
      await raiseReviewItem({
        kind: 'SYNC_PROBLEM',
        severity: 'NEEDS_ATTENTION',
        title: 'Up rejected the access token',
        body: error.userMessage,
        dedupeKey: 'sync:unauthorised',
      });
    }
  }

  return result;
}

async function lastSyncedAt(): Promise<Date | null> {
  const last = await prisma.syncRun.findFirst({
    where: { status: { in: ['SUCCEEDED', 'PARTIAL'] } },
    orderBy: { startedAt: 'desc' },
  });
  if (!last?.finishedAt) return null;
  // Step back a fortnight so late settlements and adjustments are caught.
  return new Date(last.finishedAt.getTime() - 14 * 86_400_000);
}

/** Tags from Up are mirrored locally so filtering does not need a round trip. */
async function syncTags(normalised: NormalisedTransaction): Promise<void> {
  const existing = await prisma.transactionTag.findMany({
    where: { transactionId: normalised.id, source: 'UP' },
    select: { tag: true },
  });
  const existingTags = new Set(existing.map((t) => t.tag));
  const incoming = new Set(normalised.tags);

  const toAdd = [...incoming].filter((t) => !existingTags.has(t));
  const toRemove = [...existingTags].filter((t) => !incoming.has(t));

  if (toAdd.length > 0) {
    await prisma.transactionTag.createMany({
      data: toAdd.map((tag) => ({ transactionId: normalised.id, tag, source: 'UP' as const })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.transactionTag.deleteMany({
      where: { transactionId: normalised.id, source: 'UP', tag: { in: toRemove } },
    });
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Work out which bucket each transaction belongs to, and which credits are
 * salary.
 *
 * Transactions already assigned by hand (roleSource MANUAL) are left alone.
 * A correction I made must survive every future sync.
 */
export async function classifyTransactions(): Promise<number> {
  const [settings, rules, salaryRules, mappings] = await Promise.all([
    getSettings(),
    getMerchantRules(),
    getSalaryRules(),
    prisma.accountRoleMapping.findMany(),
  ]);

  const accountRoles = new Map(mappings.map((m) => [m.accountId, m.role]));

  const transactions = await prisma.transaction.findMany({
    where: { roleSource: { not: 'MANUAL' } },
    include: { tags: true },
    orderBy: { createdAt: 'desc' },
  });

  const salaryRuleInputs: SalaryRuleInput[] = salaryRules.map((r) => ({
    id: r.id,
    label: r.label,
    pattern: r.pattern,
    matchType: r.matchType,
    minCents: r.minCents,
    priority: r.priority,
    enabled: r.enabled,
  }));

  const salaryLike: TransactionLike[] = transactions.map((t) => ({
    id: t.id,
    description: t.description,
    rawText: t.rawText,
    message: t.message,
    amountCents: t.amountCents,
    createdAt: t.createdAt,
    accountId: t.accountId,
    isInternalTransfer: t.isInternalTransfer,
    deletedAt: t.deletedAt,
  }));

  const salaryIds = new Set(
    findSalaryTransactions(salaryLike, salaryRuleInputs, settings.salaryMinCents).map(
      (m) => m.transactionId,
    ),
  );

  let updated = 0;

  for (const tx of transactions) {
    // An internal transfer is movement, not spending. It never belongs to a
    // budget bucket, or every pay split would read as expenditure.
    if (tx.isInternalTransfer) {
      if (tx.role !== null || tx.roleSource !== 'UNRESOLVED' || tx.isSalary) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { role: null, roleSource: 'UNRESOLVED', isSalary: false },
        });
        updated += 1;
      }
      continue;
    }

    const isSalary = salaryIds.has(tx.id);
    const resolution = isSalary
      ? { role: null, source: 'UNRESOLVED' as const }
      : resolveRole({
          target: { description: tx.description, rawText: tx.rawText, message: tx.message },
          rules,
          tags: tx.tags.map((t) => t.tag),
          upCategoryId: tx.upCategoryId,
          upParentCategoryId: tx.upParentCategoryId,
          accountRole: accountRoles.get(tx.accountId) ?? null,
        });

    const needsReview = !isSalary && resolution.role === null && tx.amountCents < 0;

    if (
      tx.role !== resolution.role ||
      tx.roleSource !== resolution.source ||
      tx.isSalary !== isSalary ||
      tx.needsReview !== needsReview
    ) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          role: resolution.role,
          roleSource: resolution.source,
          isSalary,
          needsReview,
        },
      });
      updated += 1;
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Pay cycles
// ---------------------------------------------------------------------------

/**
 * Rebuild pay cycles from the salary transactions on record, then attach every
 * transaction to the cycle it falls inside.
 *
 * Rebuilt rather than appended to, because a salary rule edited in Settings
 * must be able to change history. The cycle's identity is its salary
 * transaction id, so rebuilding does not churn ids for cycles that did not
 * change.
 */
export async function rebuildPayCycles(now: Date = new Date()): Promise<number> {
  const settings = await getSettings();

  const salaries = await prisma.transaction.findMany({
    where: { isSalary: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (salaries.length === 0) return 0;

  const derived = derivePayCycles(
    salaries.map((s) => ({
      transactionId: s.id,
      ruleId: '',
      ruleLabel: '',
      amountCents: s.amountCents,
      at: s.createdAt,
    })),
    { cadence: settings.salaryCadence, timeZone: settings.timezone, now },
  );

  const emergencyBalance = await roleBalance('EMERGENCY');
  const phaseDecision = determinePhase({
    emergencyBalanceCents: emergencyBalance,
    emergencyTargetCents: settings.emergencyTargetCents,
    currentPhase: settings.phase,
    hasEverReachedTarget: settings.emergencyReachedAt !== null,
  });

  const percentsByPhase = new Map<Phase, Array<{ role: AccountRole; basisPoints: number }>>([
    ['PHASE_1', await getAllocationPercents('PHASE_1')],
    ['PHASE_2', await getAllocationPercents('PHASE_2')],
  ]);

  for (const cycle of derived) {
    // A historical cycle keeps the phase that applied at the time. Only the
    // open cycle follows the current phase.
    const isOpen = cycle.endIsProjected;
    const existing = cycle.salaryTransactionId
      ? await prisma.payCycle.findUnique({ where: { salaryTransactionId: cycle.salaryTransactionId } })
      : null;

    const phase: Phase = isOpen ? phaseDecision.phase : (existing?.phase ?? phaseDecision.phase);
    const percentages = percentsByPhase.get(phase) ?? [];

    const allocation = calculatePaydayAllocation({
      incomeCents: cycle.incomeCents,
      rentCents: settings.rentCents,
      phase,
      percentages,
    });

    const record = existing
      ? await prisma.payCycle.update({
          where: { id: existing.id },
          data: {
            startAt: cycle.startAt,
            endAt: cycle.endAt,
            endIsProjected: cycle.endIsProjected,
            incomeCents: cycle.incomeCents,
            rentCents: settings.rentCents,
            allocatableCents: allocation.allocatableCents,
            phase,
          },
        })
      : await prisma.payCycle.create({
          data: {
            startAt: cycle.startAt,
            endAt: cycle.endAt,
            endIsProjected: cycle.endIsProjected,
            salaryTransactionId: cycle.salaryTransactionId,
            incomeCents: cycle.incomeCents,
            rentCents: settings.rentCents,
            allocatableCents: allocation.allocatableCents,
            phase,
          },
        });

    for (const row of allocation.rows) {
      await prisma.budgetAllocation.upsert({
        where: { payCycleId_role: { payCycleId: record.id, role: row.role } },
        create: {
          payCycleId: record.id,
          role: row.role,
          basisPoints: row.basisPoints,
          allocatedCents: row.allocatedCents,
        },
        update: { basisPoints: row.basisPoints, allocatedCents: row.allocatedCents },
      });
    }

    await prisma.transaction.updateMany({
      where: { createdAt: { gte: cycle.startAt, lt: cycle.endAt } },
      data: { payCycleId: record.id },
    });
  }

  // Anything before the first salary belongs to no cycle. Say so rather than
  // silently folding it into the first one and distorting its figures.
  const first = derived[0];
  if (first) {
    await prisma.transaction.updateMany({
      where: { createdAt: { lt: first.startAt } },
      data: { payCycleId: null },
    });
  }

  return derived.length;
}

async function roleBalance(role: AccountRole): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { mapping: { role } },
  });
  return accounts.reduce((acc, a) => acc + a.balanceCents, 0);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * The Emergency milestone and the phase change that follows it.
 *
 * No money is moved. The plan's arithmetic changes and a calm notice is
 * raised. That is the whole of it.
 */
export async function checkPhaseAndMilestones(): Promise<void> {
  const settings = await getSettings();
  const emergencyBalance = await roleBalance('EMERGENCY');

  const decision = determinePhase({
    emergencyBalanceCents: emergencyBalance,
    emergencyTargetCents: settings.emergencyTargetCents,
    currentPhase: settings.phase,
    hasEverReachedTarget: settings.emergencyReachedAt !== null,
  });

  if (decision.changed) {
    const now = new Date();
    await prisma.settings.update({
      where: { id: settings.id },
      data: { phase: decision.phase, phaseChangedAt: now, emergencyReachedAt: now },
    });
    await prisma.financialGoal.updateMany({
      where: { key: 'emergency', reachedAt: null },
      data: { reachedAt: now },
    });

    await raiseReviewItem({
      kind: 'EMERGENCY_TARGET_REACHED',
      severity: 'INFO',
      title: 'Emergency target reached',
      body: `Emergency has reached ${formatMoney(settings.emergencyTargetCents)}. From here it is a floor rather than a goal.`,
      dedupeKey: 'milestone:emergency-target',
      data: { balanceCents: emergencyBalance, targetCents: settings.emergencyTargetCents },
    });

    await raiseReviewItem({
      kind: 'PHASE_CHANGED',
      severity: 'INFO',
      title: 'The plan has moved to Phase 2',
      body: 'Emergency drops to 0%. Investing goes 8% to 17%, Future Options 3% to 12%, Travel 10% to 12%. Nothing has been moved for you — update the Pay Splitting in Up when you are ready.',
      dedupeKey: 'milestone:phase-2',
      data: { from: 'PHASE_1', to: 'PHASE_2' },
    });
  }

  // A hard floor that has been breached is worth saying out loud, once.
  if (settings.emergencyReachedAt && emergencyBalance < settings.emergencyTargetCents) {
    await raiseReviewItem({
      kind: 'EMERGENCY_TRANSFER_OUT',
      severity: 'NEEDS_ATTENTION',
      title: 'Emergency has dropped below its floor',
      body: `Emergency is at ${formatMoney(emergencyBalance)} against a floor of ${formatMoney(settings.emergencyTargetCents)}. The plan stays in Phase 2 — this is a thing to look at, not a reason to stop investing.`,
      dedupeKey: `emergency:below-floor:${Math.floor(emergencyBalance / 10_000)}`,
      data: { balanceCents: emergencyBalance },
    });
  }

  // Goals that have filled up.
  const goals = await prisma.financialGoal.findMany({ where: { reachedAt: null } });
  for (const goal of goals) {
    const balance = await roleBalance(goal.role);
    if (balance >= goal.targetCents) {
      await prisma.financialGoal.update({
        where: { id: goal.id },
        data: { reachedAt: new Date() },
      });
    }
  }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

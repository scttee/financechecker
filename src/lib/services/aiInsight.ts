/**
 * AI insights, wired to the database.
 *
 * One cached row per kind (Today's headline, and each Review period's
 * narrative). Reading is free and instant. Writing — regenerateTodayAiInsight
 * and regenerateReviewAiInsight — calls Claude and costs real money, so
 * nothing in this file calls either on its own. A server action, triggered by
 * a button, is the only caller.
 *
 * The context sent to Claude is built entirely from figures this app already
 * computes and already shows in full — the health score's own factors, the
 * same safe-to-spend result, the same category statuses, the same review
 * summary — plus recent transaction descriptions and amounts, capped rather
 * than the full history, to keep every call small and its cost predictable.
 */

import 'server-only';

import type { AiInsightKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { formatCents } from '@/lib/money';
import { roleLabel } from '@/lib/domain/roles';
import { STATUS_LABEL } from '@/lib/domain/status';
import { AiError, estimateCostCents, generateReviewNarrative, generateTodayHeadline } from '@/lib/ai/claude';
import { getTodayView } from './overview';
import { getReview, type ReviewPeriod } from './review';

export { AiError };

const REVIEW_KIND: Record<ReviewPeriod, AiInsightKind> = {
  WEEK: 'REVIEW_WEEK',
  MONTH: 'REVIEW_MONTH',
  SIX_MONTHS: 'REVIEW_SIX_MONTHS',
};

/** Recent, real spending only — no internal transfers, no salary. */
async function recentSpendDescriptions(from: Date, to: Date, take: number) {
  const rows = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      isInternalTransfer: false,
      deletedAt: null,
      amountCents: { lt: 0 },
    },
    orderBy: { amountCents: 'asc' }, // largest spend first
    take,
    select: { description: true, amountCents: true, createdAt: true, role: true },
  });

  return rows.map((t) => ({
    description: t.description,
    amount: formatCents(Math.abs(t.amountCents)),
    date: t.createdAt.toISOString().slice(0, 10),
    category: roleLabel(t.role),
  }));
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export interface TodayAiInsight {
  headline: string;
  detail: string;
  generatedAt: Date;
  model: string;
  costCents: number;
}

export async function getTodayAiInsight(): Promise<TodayAiInsight | null> {
  const row = await prisma.aiInsight.findUnique({ where: { kind: 'TODAY_HEADLINE' } });
  if (!row || !row.headline || !row.detail) return null;
  return {
    headline: row.headline,
    detail: row.detail,
    generatedAt: row.generatedAt,
    model: row.model,
    costCents: estimateCostCents(row),
  };
}

export async function regenerateTodayAiInsight(): Promise<void> {
  const view = await getTodayView();
  const now = new Date();
  const lookback = new Date(now.getTime() - 14 * 86_400_000);

  const context = {
    healthScore:
      view.health.status === 'READY'
        ? {
            score: view.health.score,
            tier: view.health.tierLabel,
            factors: view.health.factors.map((f) => ({ label: f.label, score: f.score, detail: f.detail })),
          }
        : null,
    safeToSpend: view.safeToSpend
      ? {
          safeToSpend: formatCents(view.safeToSpend.safeToSpendCents),
          perDay: formatCents(view.safeToSpend.perDayCents),
          daysRemaining: view.safeToSpend.daysRemaining,
        }
      : null,
    categories:
      view.cycle?.categories.map((c) => ({
        label: c.label,
        status: STATUS_LABEL[c.status],
        spentPct: c.spentPct,
        elapsedPct: c.elapsedPct,
        remaining: formatCents(c.remainingCents),
      })) ?? [],
    leakageThisMonth: view.leakageThisMonth,
    recentSpending: await recentSpendDescriptions(lookback, now, 20),
  };

  const result = await generateTodayHeadline(context);

  await prisma.aiInsight.upsert({
    where: { kind: 'TODAY_HEADLINE' },
    create: {
      kind: 'TODAY_HEADLINE',
      headline: result.headline,
      detail: result.detail,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    update: {
      headline: result.headline,
      detail: result.detail,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      generatedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface ReviewAiInsight {
  narrative: string;
  generatedAt: Date;
  model: string;
  costCents: number;
}

export async function getReviewAiInsight(period: ReviewPeriod): Promise<ReviewAiInsight | null> {
  const row = await prisma.aiInsight.findUnique({ where: { kind: REVIEW_KIND[period] } });
  if (!row || !row.narrative) return null;
  return {
    narrative: row.narrative,
    generatedAt: row.generatedAt,
    model: row.model,
    costCents: estimateCostCents(row),
  };
}

export async function regenerateReviewAiInsight(period: ReviewPeriod): Promise<void> {
  const review = await getReview(period);

  const context = {
    period: review.period,
    from: review.from.toISOString().slice(0, 10),
    to: review.to.toISOString().slice(0, 10),
    spent: formatCents(review.spentCents),
    saved: formatCents(review.savedCents),
    invested: formatCents(review.investedCents),
    income: formatCents(review.incomeCents),
    categories: review.categories.slice(0, 10).map((c) => ({
      label: c.label,
      status: STATUS_LABEL[c.status],
      spent: formatCents(c.spentCents),
      remaining: formatCents(c.remainingCents),
    })),
    leakage: {
      count: review.leakage.count,
      total: formatCents(review.leakage.cents),
    },
    theOneThingTheAppAlreadyNoticed: review.oneThing,
    spending: await recentSpendDescriptions(review.from, review.to, 60),
  };

  const result = await generateReviewNarrative(context);
  const kind = REVIEW_KIND[period];

  await prisma.aiInsight.upsert({
    where: { kind },
    create: {
      kind,
      narrative: result.narrative,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    update: {
      narrative: result.narrative,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      generatedAt: new Date(),
    },
  });
}

/**
 * Planning.
 *
 * When will each goal be funded at the current rate. Built entirely from the
 * plan the rest of the app already trusts — the current phase's allocation
 * percentages applied to the typical pay via the same
 * calculatePaydayAllocation used for the real payday audit — not a second,
 * competing estimate of what gets sent where.
 */

import 'server-only';

import type { AccountRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { Cents } from '@/lib/money';
import { calculatePaydayAllocation } from '@/lib/domain/allocation';
import { projectGoal, type GoalProjection } from '@/lib/domain/projection';
import { getAllocationPercents, getBalancesByRole, getSettings } from './settings';

export interface GoalPlan {
  key: string;
  name: string;
  role: AccountRole;
  currentCents: Cents;
  targetCents: Cents;
  reachedAt: Date | null;
  projection: GoalProjection;
  /** Exposed so "what if I contributed more" can call projectGoal() again with the same cycle length. */
  cycleLengthDays: number;
}

export async function getGoalPlans(now: Date = new Date()): Promise<GoalPlan[]> {
  const settings = await getSettings();
  const [percentages, balances, goals, latestCycle] = await Promise.all([
    getAllocationPercents(settings.phase),
    getBalancesByRole(),
    prisma.financialGoal.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.payCycle.findFirst({ orderBy: { startAt: 'desc' } }),
  ]);

  const allocation = calculatePaydayAllocation({
    incomeCents: settings.typicalSalaryCents,
    rentCents: settings.rentCents,
    phase: settings.phase,
    percentages,
  });
  const perCycleByRole = new Map(allocation.rows.map((r) => [r.role, r.allocatedCents]));

  const cycleLengthDays = latestCycle
    ? Math.max(1, Math.round((latestCycle.endAt.getTime() - latestCycle.startAt.getTime()) / 86_400_000))
    : 14;

  return goals.map((g) => {
    const currentCents = balances.get(g.role) ?? 0;
    const perCycleCents = perCycleByRole.get(g.role) ?? 0;
    return {
      key: g.key,
      name: g.name,
      role: g.role,
      currentCents,
      targetCents: g.targetCents,
      reachedAt: g.reachedAt,
      projection: projectGoal({
        currentCents,
        targetCents: g.targetCents,
        perCycleCents,
        now,
        cycleLengthDays,
      }),
      cycleLengthDays,
    };
  });
}

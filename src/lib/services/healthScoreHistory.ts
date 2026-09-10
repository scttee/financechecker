/**
 * Financial health score history.
 *
 * One row per day. The score formula will change over time — scoreVersion
 * on every row freezes which formula produced it, so a later change to the
 * weights never silently rewrites what a past trend line said. Written by
 * the daily cron alongside the AI insights, never computed retroactively:
 * a day with no snapshot is a day with no data, not a day recomputed from
 * today's rules.
 */

import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getTodayView } from './overview';

const SCORE_VERSION = 2;

export async function recordDailyScoreSnapshot(now: Date = new Date()): Promise<{ ok: boolean; score?: number }> {
  const view = await getTodayView(now);
  if (view.health.status !== 'READY') return { ok: false };

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const existing = await prisma.financialHealthScoreSnapshot.findFirst({
    where: { takenAt: { gte: startOfDay } },
    orderBy: { takenAt: 'desc' },
  });

  const dimensions = view.health.dimensions as unknown as Prisma.InputJsonValue;

  if (existing) {
    await prisma.financialHealthScoreSnapshot.update({
      where: { id: existing.id },
      data: { score: view.health.score, scoreVersion: SCORE_VERSION, dimensions },
    });
  } else {
    await prisma.financialHealthScoreSnapshot.create({
      data: { score: view.health.score, scoreVersion: SCORE_VERSION, dimensions, takenAt: now },
    });
  }

  return { ok: true, score: view.health.score };
}

export interface ScoreTrendPoint {
  score: number;
  takenAt: Date;
}

export interface ScoreTrend {
  oneMonthAgo: ScoreTrendPoint | null;
  threeMonthsAgo: ScoreTrendPoint | null;
  sixMonthsAgo: ScoreTrendPoint | null;
}

async function nearestSnapshotBefore(targetDate: Date): Promise<ScoreTrendPoint | null> {
  const row = await prisma.financialHealthScoreSnapshot.findFirst({
    where: { takenAt: { lte: targetDate } },
    orderBy: { takenAt: 'desc' },
  });
  return row ? { score: row.score, takenAt: row.takenAt } : null;
}

/** Null when there is no score history at all yet — distinct from "no change". */
export async function getScoreTrend(now: Date = new Date()): Promise<ScoreTrend | null> {
  const anySnapshot = await prisma.financialHealthScoreSnapshot.findFirst();
  if (!anySnapshot) return null;

  const [oneMonthAgo, threeMonthsAgo, sixMonthsAgo] = await Promise.all([
    nearestSnapshotBefore(new Date(now.getTime() - 30 * 86_400_000)),
    nearestSnapshotBefore(new Date(now.getTime() - 91 * 86_400_000)),
    nearestSnapshotBefore(new Date(now.getTime() - 182 * 86_400_000)),
  ]);

  return { oneMonthAgo, threeMonthsAgo, sixMonthsAgo };
}

/**
 * Daily refresh: AI insights, and one Financial Health score snapshot.
 *
 * A cron-scheduled Railway service hits this once a day with a bearer token
 * — not a session, so it is checked with the same constant-time comparison
 * discipline as the Up webhook signature, against CRON_SECRET rather than a
 * cookie. This is the only thing in the app that calls Claude without a
 * person pressing a button, and the AI calls are bounded to once a day on
 * purpose: four of them (Today's headline, this week's review, the
 * planning narrative, the health summary), not a loop over every period,
 * so the cost stays predictable regardless of how the schedule fires. The
 * score snapshot is free (no AI, no external call) — it rides along here
 * because "once a day" is exactly the cadence a trend line needs, and one
 * cron is simpler than two.
 *
 * Exempt from the session gate for the same reason the webhook and health
 * check are — a cron job has no session to send.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cronSecret } from '@/lib/env';
import {
  AiError,
  regenerateHealthAiSummary,
  regeneratePlanningAiInsight,
  regenerateReviewAiInsight,
  regenerateTodayAiInsight,
} from '@/lib/services/aiInsight';
import { recordDailyScoreSnapshot } from '@/lib/services/healthScoreHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  const token = match?.[1];
  if (!token) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const results: Record<string, string> = {};

  try {
    await regenerateTodayAiInsight();
    results.today = 'ok';
  } catch (error) {
    results.today = error instanceof AiError ? error.userMessage : 'failed';
  }

  try {
    await regenerateReviewAiInsight('WEEK');
    results.reviewWeek = 'ok';
  } catch (error) {
    results.reviewWeek = error instanceof AiError ? error.userMessage : 'failed';
  }

  try {
    await regeneratePlanningAiInsight();
    results.planning = 'ok';
  } catch (error) {
    results.planning = error instanceof AiError ? error.userMessage : 'failed';
  }

  try {
    await regenerateHealthAiSummary();
    results.healthSummary = 'ok';
  } catch (error) {
    results.healthSummary = error instanceof AiError ? error.userMessage : 'failed';
  }

  try {
    const snapshot = await recordDailyScoreSnapshot();
    results.scoreSnapshot = snapshot.ok ? `ok (${snapshot.score})` : 'skipped — not enough data yet';
  } catch (error) {
    results.scoreSnapshot = error instanceof Error ? error.message : 'failed';
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}

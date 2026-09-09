/**
 * The single insight.
 *
 * The Today screen shows one line. Not a feed, not a list of alerts, one line.
 *
 * The discipline this enforces is useful: if everything can be surfaced, then
 * nothing is. So the candidates are scored, the highest wins, and the rest
 * wait until they matter more than what is currently showing.
 *
 * Tone rules, applied without exception:
 *   - nothing is described as bad
 *   - discretionary spending is never a failing
 *   - no exclamation marks, no urgency, no scolding
 *   - "worth noticing" rather than "warning"
 */

import 'server-only';

import { prisma } from '@/lib/db';
import type { SafeToSpendResult } from '@/lib/domain/safeToSpend';
import { attentionFor } from '@/lib/domain/status';
import { formatCents } from '@/lib/money';
import type { CycleView, GoalView } from './overview';
import { getSetupState } from './settings';

export type InsightTone = 'CALM' | 'NOTICE' | 'ATTENTION';

export interface Insight {
  tone: InsightTone;
  headline: string;
  /** Optional second line. Kept short or omitted entirely. */
  detail: string | null;
  /** Where to go to see the whole picture, if anywhere. */
  href: string | null;
  /** Why this was chosen over everything else. Shown behind "Why this?". */
  reason: string;
}

interface Candidate extends Insight {
  score: number;
}

export async function buildInsight(input: {
  cycle: CycleView | null;
  safeToSpend: SafeToSpendResult | null;
  goals: GoalView[];
  leakageThisMonth: { cents: number; count: number };
  now: Date;
}): Promise<Insight> {
  const { cycle, safeToSpend, goals, leakageThisMonth } = input;
  const candidates: Candidate[] = [];

  // --- Setup gaps beat everything. Wrong figures are worse than no figures.
  const setup = await getSetupState();
  if (!setup.complete) {
    candidates.push({
      score: 1000,
      tone: 'ATTENTION',
      headline: 'Setup is not finished yet',
      detail: setup.missing[0] ?? null,
      href: '/setup',
      reason: 'Until the accounts are mapped and a salary is detected, every other figure here would be a guess.',
    });
  }

  if (!cycle) {
    candidates.push({
      score: 900,
      tone: 'NOTICE',
      headline: 'No pay cycle yet',
      detail: 'Once a salary payment is found, the fortnight starts tracking itself.',
      href: '/settings',
      reason: 'Everything on this screen is measured against a pay cycle, and there is not one yet.',
    });
  }

  // --- The milestone.
  const emergency = goals.find((g) => g.key === 'emergency');
  if (emergency?.reachedAt && Date.now() - emergency.reachedAt.getTime() < 14 * 86_400_000) {
    candidates.push({
      score: 800,
      tone: 'CALM',
      headline: 'Emergency target reached',
      detail: `${formatCents(emergency.balanceCents)} against a ${formatCents(emergency.targetCents)} target. The plan has moved to Phase 2.`,
      href: '/goals',
      reason: 'This happened in the last fortnight and it changes how every future pay is split.',
    });
  }

  // --- Pay that has not landed.
  if (cycle?.progress.isOverdue) {
    candidates.push({
      score: 700,
      tone: 'NOTICE',
      headline: 'Pay has not landed yet',
      detail: `The fortnight was due to turn over on ${shortDate(cycle.endAt)}. Nothing has been counted as salary since.`,
      href: '/pay-cycle',
      reason: 'The projected payday has passed, so the figures on this screen are stretching past the cycle they were built for.',
    });
  }

  // --- Categories moving faster than the clock.
  if (cycle) {
    const hot = cycle.categories
      .filter((c) => c.status === 'RUNNING_HOT')
      .sort((a, b) => b.spentPct - b.elapsedPct - (a.spentPct - a.elapsedPct))[0];

    if (hot) {
      const attention = attentionFor(hot);
      candidates.push({
        score: attention === 'NEEDS_ATTENTION' ? 620 : 500,
        tone: attention === 'NEEDS_ATTENTION' ? 'NOTICE' : 'CALM',
        headline: `${hot.label} is running ahead of the pay cycle`,
        detail: `${hot.spentPct}% used against ${hot.elapsedPct}% of the fortnight gone. ${formatCents(hot.remainingCents)} left.`,
        href: '/pay-cycle',
        reason: `Of everything tracked this cycle, ${hot.label} is the furthest ahead of the clock.`,
      });
    }

    const spent = cycle.categories
      .filter((c) => c.status === 'SPENT' && !c.isEssential && !c.isProtected)
      .sort((a, b) => a.remainingCents - b.remainingCents)[0];

    if (spent) {
      candidates.push({
        score: 560,
        tone: 'CALM',
        headline: `${spent.label} is fully spent this fortnight`,
        detail:
          spent.remainingCents < 0
            ? `${formatCents(Math.abs(spent.remainingCents))} past the allocation, with ${cycle.progress.daysRemaining} days to payday.`
            : `Nothing left until payday in ${cycle.progress.daysRemaining} days.`,
        href: '/pay-cycle',
        reason: `${spent.label} has no allocation left and there is still time to run in the cycle.`,
      });
    }
  }

  // --- Leakage.
  if (leakageThisMonth.count > 0) {
    const unreviewed = await prisma.leakageEvent.count({ where: { verdict: 'UNREVIEWED' } });
    if (unreviewed > 0) {
      candidates.push({
        score: 600,
        tone: 'NOTICE',
        headline:
          unreviewed === 1
            ? 'One movement out of a purpose-built Saver is worth a look'
            : `${unreviewed} movements out of purpose-built Savers are worth a look`,
        detail: `${formatCents(leakageThisMonth.cents)} this month, correlated with spending shortly afterwards.`,
        href: '/review',
        reason: 'Money leaving a Saver that exists for one thing, followed by spending on another, is the pattern this app was built to make visible.',
      });
    }
  }

  // --- Nothing spare.
  if (safeToSpend && safeToSpend.safeToSpendCents === 0 && cycle) {
    candidates.push({
      score: 550,
      tone: 'NOTICE',
      headline: 'Nothing spare until payday',
      detail: `${cycle.progress.daysRemaining} days to go. The essentials are still funded — this is about discretionary spending only.`,
      href: '/today#safe-to-spend',
      reason: 'The discretionary buckets are committed for the rest of this cycle.',
    });
  }

  // --- The good case, which deserves saying as plainly as the bad ones.
  if (safeToSpend && cycle) {
    candidates.push({
      score: 100,
      tone: 'CALM',
      headline: "You're on track",
      detail: `${formatCents(safeToSpend.safeToSpendCents)} of discretionary money over ${cycle.progress.daysRemaining} days, and nothing is running ahead of itself.`,
      href: null,
      reason: 'Nothing else scored higher, which is the point: on an ordinary day this screen should be boring.',
    });
  }

  candidates.push({
    score: 0,
    tone: 'CALM',
    headline: 'Nothing to report',
    detail: null,
    href: null,
    reason: 'There is not enough data yet to say anything useful.',
  });

  const winner = candidates.sort((a, b) => b.score - a.score)[0]!;
  const { score: _score, ...insight } = winner;
  return insight;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Australia/Sydney',
  }).format(date);
}

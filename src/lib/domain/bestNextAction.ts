/**
 * Best next action.
 *
 * Same shape as the single insight on Today: candidates are scored, the
 * highest wins, exactly one is returned. Twelve simultaneous suggestions is
 * not a recommendation, it's a list — the discipline of picking one is the
 * point.
 */

import type { Cents } from '@/lib/money';

export interface NextActionCandidate {
  headline: string;
  detail: string;
  href: string | null;
}

interface ScoredCandidate extends NextActionCandidate {
  score: number;
}

export function selectBestNextAction(input: {
  emergencyProgressPct: number;
  emergencyReached: boolean;
  futureOptionsProgressPct: number;
  debtCents: Cents;
  /** How many of the 5 protection kinds have anything recorded. */
  protectionRecordedCount: number;
  /** How many of the last 3 pay cycles had an investing contribution. */
  recentCyclesWithContribution: number;
  adminOverdueCount: number;
}): NextActionCandidate {
  const candidates: ScoredCandidate[] = [];

  if (input.debtCents > 0) {
    candidates.push({
      score: 900,
      headline: 'Prioritise debt',
      detail: 'Debt is currently recorded on the balance sheet — clearing it outranks building further buffers.',
      href: '/health#health-balances',
    });
  }

  if (!input.emergencyReached && input.emergencyProgressPct < 100) {
    candidates.push({
      score: 800,
      headline: 'Build Emergency',
      detail: `Emergency is ${Math.round(input.emergencyProgressPct)}% funded. This is Phase 1's main job.`,
      href: '/goals',
    });
  }

  if (
    (input.emergencyReached || input.emergencyProgressPct >= 100) &&
    input.futureOptionsProgressPct < 100
  ) {
    candidates.push({
      score: 700,
      headline: 'Build Future Options',
      detail: `Emergency is funded. Future Options is ${Math.round(input.futureOptionsProgressPct)}% there.`,
      href: '/goals',
    });
  }

  if (input.recentCyclesWithContribution === 0) {
    candidates.push({
      score: 600,
      headline: 'Restore the investing habit',
      detail: 'No investing contribution landed in the last 3 pay cycles.',
      href: '/pay-cycle',
    });
  }

  if (input.protectionRecordedCount < 5) {
    candidates.push({
      score: 500,
      headline: 'Review protection',
      detail: `${5 - input.protectionRecordedCount} of 5 protection items are not recorded yet.`,
      href: '/health#health-records',
    });
  }

  if (input.adminOverdueCount > 0) {
    candidates.push({
      score: 400,
      headline: 'Catch up on admin',
      detail: `${input.adminOverdueCount} admin ${input.adminOverdueCount === 1 ? 'item is' : 'items are'} overdue.`,
      href: '/health#health-records',
    });
  }

  candidates.push({
    score: 0,
    headline: 'Keep going',
    detail: 'Nothing here is asking for a decision right now.',
    href: null,
  });

  const winner = candidates.sort((a, b) => b.score - a.score)[0]!;
  const { score: _score, ...action } = winner;
  return action;
}

/**
 * Runway, wired to the database.
 *
 * Three runways, same underlying math, three different cost baskets and
 * funding sources:
 *
 *   Survival      essentials only,                funded by Emergency
 *   Normal life   essentials + Dining & Social + Fun, funded by Emergency
 *   Career break  the normal-life basket,          funded by Future Options
 *
 * Emergency stays a protected floor by construction — Career Break is never
 * given Emergency as a funding source, only Future Options, so a deliberate
 * break can never be computed as eating into it.
 *
 * Costs are trailing 3-month actual spend, divided by 3 — "recent actual
 * averages", not a manual budget guess.
 */

import 'server-only';

import type { AccountRole } from '@prisma/client';
import { calculateRunway, type RunwayResult } from '@/lib/domain/runway';
import { isEssential } from '@/lib/domain/roles';
import { ACCOUNT_ROLES } from '@/lib/domain/roles';
import { spendByRole } from './overview';
import { getRoleBalance } from './settings';

const NORMAL_LIFE_EXTRA: AccountRole[] = ['DINING_SOCIAL', 'FUN'];
const COST_WINDOW_MONTHS = 3;

async function monthlyCost(roles: readonly AccountRole[], now: Date): Promise<number> {
  const from = new Date(now.getTime() - COST_WINDOW_MONTHS * 30.44 * 86_400_000);
  const spend = await spendByRole(from, now);
  const total = roles.reduce((sum, role) => sum + (spend.get(role) ?? 0), 0);
  return Math.round(total / COST_WINDOW_MONTHS);
}

export interface RunwayView {
  survival: RunwayResult;
  normalLife: RunwayResult;
  careerBreak: RunwayResult;
}

export async function getRunway(now: Date = new Date()): Promise<RunwayView> {
  const essentialRoles = ACCOUNT_ROLES.filter((role) => isEssential(role));
  const normalLifeRoles = [...essentialRoles, ...NORMAL_LIFE_EXTRA];

  const [essentialMonthlyCents, normalLifeMonthlyCents, emergencyCents, futureOptionsCents] = await Promise.all([
    monthlyCost(essentialRoles, now),
    monthlyCost(normalLifeRoles, now),
    getRoleBalance('EMERGENCY'),
    getRoleBalance('FUTURE_OPTIONS'),
  ]);

  return {
    survival: calculateRunway({ fundingBalanceCents: emergencyCents, monthlyCostCents: essentialMonthlyCents }),
    normalLife: calculateRunway({ fundingBalanceCents: emergencyCents, monthlyCostCents: normalLifeMonthlyCents }),
    careerBreak: calculateRunway({
      fundingBalanceCents: futureOptionsCents,
      monthlyCostCents: normalLifeMonthlyCents,
    }),
  };
}

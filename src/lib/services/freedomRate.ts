/**
 * Freedom rate, wired to the database.
 *
 * Future-choice contributions: long-term investing, Future Options, and
 * Emergency while it is still below target — once Emergency is reached the
 * plan itself stops sending it money, so counting further Emergency
 * transfers here would count something the plan no longer does. Everyday
 * spending (Travel, Gear, Rent, Bills, Groceries, lifestyle) never counts,
 * by construction: this only ever sums transfers into the three named roles.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { calculateFreedomRate, type FreedomRateResult } from '@/lib/domain/freedomRate';
import { incomeIn, investedIn, transfersInto } from './review';
import { getSettings } from './settings';

async function futureChoiceContributions(from: Date, to: Date): Promise<number> {
  const settings = await getSettings();
  const emergencyReached = settings.emergencyReachedAt !== null;

  const [investing, futureOptions, emergency] = await Promise.all([
    investedIn(from, to),
    transfersInto('FUTURE_OPTIONS', from, to),
    emergencyReached ? Promise.resolve(0) : transfersInto('EMERGENCY', from, to),
  ]);

  return investing + futureOptions + emergency;
}

export interface FreedomRateWindows {
  cycle: FreedomRateResult;
  rolling3Months: FreedomRateResult;
  rolling12Months: FreedomRateResult;
}

export async function getFreedomRate(now: Date = new Date()): Promise<FreedomRateWindows> {
  const currentCycle = await prisma.payCycle.findFirst({
    where: { startAt: { lte: now } },
    orderBy: { startAt: 'desc' },
  });

  const cycleFrom = currentCycle?.startAt ?? new Date(now.getTime() - 14 * 86_400_000);
  const rolling3From = new Date(now.getTime() - 90 * 86_400_000);
  const rolling12From = new Date(now.getTime() - 365 * 86_400_000);

  const [cycleChoice, cycleIncome, r3Choice, r3Income, r12Choice, r12Income] = await Promise.all([
    futureChoiceContributions(cycleFrom, now),
    incomeIn(cycleFrom, now),
    futureChoiceContributions(rolling3From, now),
    incomeIn(rolling3From, now),
    futureChoiceContributions(rolling12From, now),
    incomeIn(rolling12From, now),
  ]);

  return {
    cycle: calculateFreedomRate({ futureChoiceCents: cycleChoice, netIncomeCents: cycleIncome }),
    rolling3Months: calculateFreedomRate({ futureChoiceCents: r3Choice, netIncomeCents: r3Income }),
    rolling12Months: calculateFreedomRate({ futureChoiceCents: r12Choice, netIncomeCents: r12Income }),
  };
}

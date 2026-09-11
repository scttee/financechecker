import 'server-only';
import { prisma } from '@/lib/db';
import { getSettings, getBalancesByRole, getAllocationPercents } from './settings';
import { getBalanceSheet } from './balanceSheet';
import { calculatePaydayAllocation } from '@/lib/domain/allocation';
import { toDateInputValue } from '@/lib/time';

export async function getSavingsProjection(now = new Date()) {
  const [settings, balances, sheet, cycle] = await Promise.all([
    getSettings(), getBalancesByRole(), getBalanceSheet(), prisma.payCycle.findFirst({ orderBy: { startAt: 'desc' } }),
  ]);
  const percentages = await getAllocationPercents(settings.phase);
  const allocation = calculatePaydayAllocation({ incomeCents: settings.typicalSalaryCents, rentCents: settings.rentCents, phase: settings.phase, percentages });
  const perCycleCents = allocation.rows.filter((r) => ['EMERGENCY', 'FUTURE_OPTIONS', 'INVESTING'].includes(r.role)).reduce((sum, r) => sum + r.allocatedCents, 0);
  return {
    today: toDateInputValue(now, settings.timezone),
    nextPayday: toDateInputValue(cycle?.endAt ?? now, settings.timezone),
    cadence: settings.salaryCadence,
    balanceCents: Math.max(0, (balances.get('EMERGENCY') ?? 0) + (balances.get('FUTURE_OPTIONS') ?? 0) + sheet.investmentsCents),
    perCycleCents,
    ready: !!cycle && allocation.warnings.length === 0,
  };
}

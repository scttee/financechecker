import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getGoalPlans } from '@/lib/services/planning';
import { getRunway } from '@/lib/services/runway';
import { getSettings, getRoleBalance } from '@/lib/services/settings';
import { toDateInputValue } from '@/lib/time';
import { shiftMonths } from '@/lib/domain/careerBreak';
import { Card, Notice, PageTitle } from '@/components/ui';
import { CareerBreakPlanner } from '@/components/CareerBreakPlanner';

export const dynamic = 'force-dynamic';
export default async function PlanPage() {
  const [settings, plans, runway, saved, balanceCents, latestCycle, oldestTransaction] = await Promise.all([
    getSettings(), getGoalPlans(), getRunway(), prisma.careerBreakPlan.findUnique({ where: { id: 'personal' } }),
    getRoleBalance('FUTURE_OPTIONS'), prisma.payCycle.findFirst({ orderBy: { startAt: 'desc' } }),
    prisma.transaction.findFirst({ where: { deletedAt: null, isInternalTransfer: false, amountCents: { lt: 0 } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const now = new Date();
  const today = toDateInputValue(now, settings.timezone);
  const baselinePerCycleCents = plans.find((p) => p.role === 'FUTURE_OPTIONS')?.projection.perCycleCents ?? 0;
  const initial = saved ?? {
    startDate: shiftMonths(today, 12), durationMonths: 6, monthlyCostCents: runway.normalLife.monthlyCostCents,
    perCycleCents: baselinePerCycleCents, upfrontCents: 0, bufferMonths: 2,
  };
  const incompleteHistory = !oldestTransaction || now.getTime() - oldestTransaction.createdAt.getTime() < 92 * 86_400_000;
  const nextPayday = latestCycle ? toDateInputValue(latestCycle.endAt, settings.timezone) : shiftMonths(today, 1);
  return <div className="space-y-5">
    <PageTitle sub="Make room for a career break, a new direction, or time that belongs to you.">Your future</PageTitle>
    <Card className="border-l-4 border-l-accent"><p className="text-sm font-semibold">A plan for more choice</p><p className="mt-1 max-w-3xl text-sm text-muted">Start with the life you want to make possible. This scenario connects your Future Options fund to a start date, living costs and a buffer for what comes next.</p></Card>
    {!latestCycle ? <Notice tone="notice" title="A payday is needed">Set up your salary rule before saving a plan. <Link className="text-accent underline" href="/settings?tab=salary">Open salary settings</Link></Notice> : <>
      {!saved && incompleteHistory ? <Notice tone="notice" title="Check the monthly cost estimate">There is less than three months of recorded spending. The suggested average may be too low. Enter your full expected monthly costs before relying on the projection.</Notice> : null}
      <CareerBreakPlanner initial={initial} context={{ today, nextPayday, cadence: settings.salaryCadence, balanceCents }} savedAt={saved?.updatedAt.toISOString() ?? null} baselinePerCycleCents={baselinePerCycleCents} />
    </>}
  </div>;
}

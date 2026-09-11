import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getGoalPlans } from '@/lib/services/planning';
import { getRunway } from '@/lib/services/runway';
import { getSettings, getRoleBalance } from '@/lib/services/settings';
import { toDateInputValue } from '@/lib/time';
import { shiftMonths } from '@/lib/domain/careerBreak';
import { Card, Notice, PageTitle } from '@/components/ui';
import { CareerBreakPlanner } from '@/components/CareerBreakPlanner';
import { SavingsOutlook } from '@/components/SavingsOutlook';
import { getSavingsProjection } from '@/lib/services/savingsProjection';

export const dynamic = 'force-dynamic';
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  if (params.view !== 'career-break') {
    const data = await getSavingsProjection();
    return <div className="dashboard-stack">
      <PageTitle sub="The money you keep. The choices it creates.">Future</PageTitle>
      {data.ready ? <SavingsOutlook data={data} /> : <Notice title="Your projection needs a complete pay plan"><Link className="text-accent underline" href="/settings?tab=allocations">Check salary and allocations</Link></Notice>}
      <div className="support-links"><Link href="/goals">Balances & goals <span aria-hidden>↗</span></Link><Link href="/plan?view=career-break">Plan a career break <span aria-hidden>↗</span></Link></div>
    </div>;
  }
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
    <Link href="/plan" className="inline-flex min-h-11 items-center text-sm text-accent">← Back to Future</Link>
    <PageTitle sub="A scenario for time away, with Emergency protected.">Career break</PageTitle>

    {!latestCycle ? <Notice tone="notice" title="A payday is needed">Set up your salary rule before saving a plan. <Link className="text-accent underline" href="/settings?tab=salary">Open salary settings</Link></Notice> : <>
      {!saved && incompleteHistory ? <Notice tone="notice" title="Check the monthly cost estimate">There is less than three months of recorded spending. The suggested average may be too low. Enter your full expected monthly costs before relying on the projection.</Notice> : null}
      <CareerBreakPlanner initial={initial} context={{ today, nextPayday, cadence: settings.salaryCadence, balanceCents }} savedAt={saved?.updatedAt.toISOString() ?? null} baselinePerCycleCents={baselinePerCycleCents} />
    </>}
  </div>;
}

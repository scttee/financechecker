import Link from 'next/link';
import { HeartPulse, TrendingUp, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { getTodayView } from '@/lib/services/overview';
import type { getSavingsProjection } from '@/lib/services/savingsProjection';
import { projectSavings } from '@/lib/domain/savingsProjection';
import { formatCents } from '@/lib/money';
import { formatRelative } from '@/lib/time';
import { Empty, LinkButton, Notice, PageTitle } from '@/components/ui';
import { SafeToSpendCard } from '@/components/SafeToSpend';
import { TodaySpendingCard } from '@/components/TodaySpending';

export function TodayDashboard({ view, savings, setupComplete }: {
  view: Awaited<ReturnType<typeof getTodayView>>;
  savings: Awaited<ReturnType<typeof getSavingsProjection>>;
  setupComplete: boolean;
}) {
  const { cycle, health, safeToSpend, spentTodayCents, dailyCategories, insight } = view;
  const future = savings.ready ? projectSavings({...savings, months:12, extraPerCycleCents:0}) : null;
  return <div className="dashboard-stack">
    <PageTitle sub={view.lastSyncAt ? `Updated ${formatRelative(view.lastSyncAt,new Date(),view.timezone)}` : 'Sync to bring your picture up to date.'}>Today</PageTitle>
    {!setupComplete ? <Notice tone="notice" title="Finish setting up your plan"><Link href="/setup" className="text-accent underline">Review the remaining setup steps</Link></Notice> : null}
    {safeToSpend && cycle ? <SafeToSpendCard result={safeToSpend} daysToPayday={safeToSpend.daysRemaining} nextPayday={cycle.endAt} nextPaydayIsProjected={cycle.endIsProjected} timezone={view.timezone} spentTodayCents={spentTodayCents} /> : <Empty title="Your spending room starts with a payday" body="Check your salary rule so we can find this pay cycle." action={<LinkButton href="/settings?tab=salary">Check salary</LinkButton>} />}
    <div className="duo-grid">
      <Link href="/health" className="duo-tile">
        <span className="flex items-center justify-between gap-2 text-sm font-medium text-muted"><span className="flex items-center gap-2"><HeartPulse className="h-4 w-4" aria-hidden />Health</span><ArrowUpRight className="h-4 w-4" aria-hidden /></span>
        <span className="tabular mt-5 block text-4xl font-semibold tracking-tight">{health.status === 'READY' ? health.score : '—'}<span className="ml-1 text-sm font-normal text-muted">/100</span></span>
        <span className="mt-2 block text-sm text-muted">{health.status === 'READY' ? health.tierLabel : 'Building your picture'}</span>
      </Link>
      <Link href="/plan" className="duo-tile duo-tile-future">
        <span className="flex items-center justify-between gap-2 text-sm font-medium text-muted"><span className="flex items-center gap-2"><TrendingUp className="h-4 w-4" aria-hidden />Future</span><ArrowUpRight className="h-4 w-4" aria-hidden /></span>
        <span className="tabular duo-figure mt-5 block break-words text-3xl font-semibold tracking-tight">{future ? formatCents(future.baselineCents,{showCents:false}) : '—'}</span>
        <span className="mt-2 block text-sm text-muted">Projected savings · 1 year</span>
      </Link>
    </div>
    {insight.tone !== 'CALM' ? <Notice title={insight.label} tone={insight.tone === 'ATTENTION' ? 'attention' : 'notice'}><p>{insight.headline}</p>{insight.href ? <Link href={insight.href} className="mt-2 inline-flex text-accent underline">View details</Link> : null}</Notice> : null}
    {dailyCategories.length > 0 ? <details className="disclosure-panel"><summary><span>Today by category</span><span className="text-xs font-normal text-muted">A closer look</span></summary><div className="pt-4"><TodaySpendingCard categories={dailyCategories} /></div></details> : null}
    <div className="flex flex-wrap gap-x-6 gap-y-2 px-1 text-sm text-muted">{[['/transactions','Transactions'],['/pay-cycle','Pay-cycle detail']].map(([href,label]) => <Link key={href} href={href!} className="inline-flex min-h-11 items-center gap-1 hover:text-ink">{label}<ChevronRight className="h-4 w-4" aria-hidden /></Link>)}</div>
  </div>;
}

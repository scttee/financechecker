import Link from 'next/link';
import { getTodayView, recentCyclesWithInvesting } from '@/lib/services/overview';
import { projectGoal } from '@/lib/domain/projection';
import { getScoreTrend } from '@/lib/services/healthScoreHistory';
import { getBalanceSheet } from '@/lib/services/balanceSheet';
import { getFreedomRate } from '@/lib/services/freedomRate';
import { getRunway } from '@/lib/services/runway';
import { getProtectionItems, PROTECTION_KINDS } from '@/lib/services/protection';
import { getAdminItems, ADMIN_KINDS } from '@/lib/services/admin';
import { getGoalPlans } from '@/lib/services/planning';
import { getHealthAiSummary } from '@/lib/services/aiInsight';
import { getSettings } from '@/lib/services/settings';
import { configStatus } from '@/lib/env';
import { selectBestNextAction } from '@/lib/domain/bestNextAction';
import { formatCents } from '@/lib/money';
import { formatDate, formatDateTime, toDateInputValue } from '@/lib/time';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Money,
  Notice,
  Pill,
  Why,
} from '@/components/ui';
import { FinancialHealthCard } from '@/components/FinancialHealth';
import {
  regenerateHealthInsightAction,
  saveAdminItemAction,
  saveProtectionItemAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

function months(value: number | null): string {
  if (value === null) return 'Not enough spending history yet';
  return `${value} ${value === 1 ? 'month' : 'months'}`;
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ aiError?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();

  const [
    view,
    trend,
    balanceSheet,
    freedomRate,
    runway,
    protectionItems,
    adminItems,
    plans,
    aiSummary,
    settings,
  ] = await Promise.all([
    getTodayView(now),
    getScoreTrend(now),
    getBalanceSheet(),
    getFreedomRate(now),
    getRunway(now),
    getProtectionItems(),
    getAdminItems(now),
    getGoalPlans(now),
    getHealthAiSummary(),
    getSettings(),
  ]);

  const status = configStatus();
  const { health } = view;

  const protectionRecordedCount = protectionItems.filter(
    (p) => p.provider || p.coverCents !== null || p.notes || p.lastReviewed,
  ).length;
  const adminOverdueCount = adminItems.filter((a) => a.overdue).length;

  const bestNextAction = selectBestNextAction({
    emergencyProgressPct: view.goals.find((g) => g.key === 'emergency')?.progressPct ?? 0,
    emergencyReached: settings.emergencyReachedAt !== null,
    futureOptionsProgressPct: view.goals.find((g) => g.key === 'future_options')?.progressPct ?? 0,
    debtCents: balanceSheet.debtCents,
    protectionRecordedCount,
    recentCyclesWithContribution: view.cycle ? await recentCyclesWithInvesting(view.cycle.id, 3) : 0,
    adminOverdueCount,
  });

  return (
    <div className="space-y-3">
      {params.aiError ? (
        <Notice tone="notice" title="Claude did not answer">
          <p>{params.aiError}</p>
        </Notice>
      ) : null}

      {health.status === 'READY' ? <FinancialHealthCard health={health} trend={trend} /> : null}

      {/* Best next action. One, not twelve. */}
      <Card className="border-l-[3px]">
        <p className="text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-muted">
          Best next action
        </p>
        <p className="mt-2 text-lg font-medium leading-snug tracking-tight">
          {bestNextAction.headline}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{bestNextAction.detail}</p>
        {bestNextAction.href ? (
          <Link href={bestNextAction.href} className="mt-2 inline-block text-sm font-medium text-accent hover:underline">
            Look
          </Link>
        ) : null}
      </Card>

      {/* Claude's read, once generated. */}
      {status.aiConfigured || aiSummary ? (
        <Card>
          <CardHeader title="Claude's read" />
          {aiSummary ? (
            <div className="space-y-3 text-sm leading-relaxed">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">What changed</p>
                <p className="mt-0.5">{aiSummary.whatChanged}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Going well</p>
                <p className="mt-0.5">{aiSummary.goingWell}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Worth noticing</p>
                <p className="mt-0.5">{aiSummary.worthNoticing}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Best next move</p>
                <p className="mt-0.5">{aiSummary.bestNextMove}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Context</p>
                <p className="mt-0.5">{aiSummary.context}</p>
              </div>
              <p className="text-xs text-faint">
                Generated {formatDateTime(aiSummary.generatedAt, settings.timezone)} · {aiSummary.model} · about{' '}
                {aiSummary.costCents < 1 ? '<1¢' : `${Math.round(aiSummary.costCents)}¢`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">Not generated yet.</p>
          )}
          {status.aiConfigured ? (
            <form action={regenerateHealthInsightAction} className="mt-3">
              <Button type="submit" variant="secondary">
                {aiSummary ? 'Regenerate' : 'Ask Claude'}
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {/* Balance sheet. */}
      <Card>
        <CardHeader title="Balance sheet" hint="Cash from Up, everything else from manual snapshots on Goals." />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted">Net financial assets</p>
            <p className="tabular text-figure-sm">{formatCents(balanceSheet.netFinancialAssetsCents, { showCents: false })}</p>
          </div>
          <div>
            <p className="text-sm text-muted">Accessible financial assets</p>
            <p className="tabular text-figure-sm">{formatCents(balanceSheet.accessibleFinancialAssetsCents, { showCents: false })}</p>
          </div>
        </div>
        <Why label="What's the difference?">
          <p>
            Net financial assets is cash plus investments plus super, minus debt. Accessible financial
            assets is the same total with super taken out — money that could actually be reached
            without waiting for preservation age.
          </p>
          <ul className="mt-2 space-y-1">
            <li className="flex justify-between"><span>Cash (Up)</span><Money cents={balanceSheet.cashCents} /></li>
            <li className="flex justify-between"><span>Investments</span><Money cents={balanceSheet.investmentsCents} /></li>
            <li className="flex justify-between"><span>Super</span><Money cents={balanceSheet.superCents} /></li>
            <li className="flex justify-between"><span>Debt</span><Money cents={-balanceSheet.debtCents} /></li>
          </ul>
        </Why>
      </Card>

      {/* Freedom rate. */}
      <Card>
        <CardHeader
          title="Freedom rate"
          hint="Share of take-home income directed toward future choice — Emergency while below target, Future Options, long-term investing."
        />
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">This cycle</p>
            <p className="tabular mt-1 text-figure-sm">{freedomRate.cycle.pct}%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">3 months</p>
            <p className="tabular mt-1 text-figure-sm">{freedomRate.rolling3Months.pct}%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">12 months</p>
            <p className="tabular mt-1 text-figure-sm">{freedomRate.rolling12Months.pct}%</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">
          {freedomRate.cycle.pct}% of take-home income this cycle increased your future financial
          options.
        </p>
      </Card>

      {/* Runway. */}
      <Card>
        <CardHeader title="Runway" hint="Emergency stays a protected floor — a career break only ever draws on Future Options." />
        <ul className="divide-y divide-line">
          <li className="flex items-baseline justify-between gap-3 py-2">
            <div>
              <p className="font-medium">Survival</p>
              <p className="text-xs text-faint">Essentials only, funded by Emergency</p>
            </div>
            <span className="tabular font-medium">{months(runway.survival.months)}</span>
          </li>
          <li className="flex items-baseline justify-between gap-3 py-2">
            <div>
              <p className="font-medium">Normal life</p>
              <p className="text-xs text-faint">Essentials + Dining &amp; Social + Fun, funded by Emergency</p>
            </div>
            <span className="tabular font-medium">{months(runway.normalLife.months)}</span>
          </li>
          <li className="flex items-baseline justify-between gap-3 py-2">
            <div>
              <p className="font-medium">Deliberate career break</p>
              <p className="text-xs text-faint">Normal-life costs, funded by Future Options only</p>
            </div>
            <span className="tabular font-medium">{months(runway.careerBreak.months)}</span>
          </li>
        </ul>
        {runway.normalLife.monthlyCostCents > 0 ? (
          <p className="mt-2 text-sm text-muted">
            One additional month of normal-life runway costs about{' '}
            <span className="tabular font-medium text-ink">{formatCents(runway.normalLife.monthlyCostCents, { showCents: false })}</span>.
          </p>
        ) : null}
      </Card>

      {/* Goal trajectories. */}
      {plans.filter((p) => !p.reachedAt).length > 0 ? (
        <Card>
          <CardHeader title="Goal trajectories" hint="What if I contributed more or less?" />
          <div className="space-y-4">
            {plans
              .filter((p) => !p.reachedAt)
              .map((plan) => {
                const current = plan.projection.perCycleCents;
                const rateVariants = [
                  { label: 'Current', perCycleCents: current },
                  { label: '+$100/cycle', perCycleCents: current + 10_000 },
                  { label: '+$250/cycle', perCycleCents: current + 25_000 },
                  { label: '-$100/cycle', perCycleCents: Math.max(0, current - 10_000) },
                ];
                return (
                  <div key={plan.key}>
                    <p className="font-medium">{plan.name}</p>
                    <ul className="mt-1.5 space-y-1 text-sm">
                      {rateVariants.map((v) => {
                        const projection = projectGoal({
                          currentCents: plan.currentCents,
                          targetCents: plan.targetCents,
                          perCycleCents: v.perCycleCents,
                          now,
                          cycleLengthDays: plan.cycleLengthDays,
                        });
                        return (
                          <li key={v.label} className="flex items-baseline justify-between gap-3">
                            <span className={v.label === 'Current' ? 'font-medium text-ink' : 'text-muted'}>
                              {formatCents(v.perCycleCents, { showCents: false })}/fortnight
                              {v.label !== 'Current' ? ` (${v.label})` : ''}
                            </span>
                            <span className="tabular text-muted">
                              {projection.projectedDate
                                ? formatDate(projection.projectedDate, settings.timezone)
                                : 'No projection'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
          </div>
        </Card>
      ) : null}

      {/* Protection. */}
      <Card>
        <CardHeader title="Protection" hint="Tracked by hand. Cover amounts are never assumed." />
        <ul className="divide-y divide-line">
          {protectionItems.map((item) => (
            <li key={item.kind} className="py-3 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{item.label}</p>
                <Pill tone={item.lastReviewed ? 'ontrack' : item.provider || item.coverCents !== null ? 'notice' : 'neutral'}>
                  {item.lastReviewed
                    ? `Reviewed ${formatDate(item.lastReviewed, settings.timezone)}`
                    : item.provider || item.coverCents !== null
                      ? 'Recorded'
                      : 'Not recorded'}
                </Pill>
              </div>
              <details className="group mt-2">
                <summary className="text-sm font-medium text-accent hover:underline">Edit</summary>
                <form action={saveProtectionItemAction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <input type="hidden" name="kind" value={item.kind} />
                  <Field label="Provider" htmlFor={`provider-${item.kind}`}>
                    <Input id={`provider-${item.kind}`} name="provider" defaultValue={item.provider ?? ''} />
                  </Field>
                  <Field label="Cover" htmlFor={`cover-${item.kind}`}>
                    <Input
                      id={`cover-${item.kind}`}
                      name="coverCents"
                      inputMode="decimal"
                      placeholder="0.00"
                      defaultValue={item.coverCents !== null ? (item.coverCents / 100).toFixed(2) : ''}
                    />
                  </Field>
                  <Field label="Premium" htmlFor={`premium-${item.kind}`}>
                    <Input
                      id={`premium-${item.kind}`}
                      name="premiumCents"
                      inputMode="decimal"
                      placeholder="0.00"
                      defaultValue={item.premiumCents !== null ? (item.premiumCents / 100).toFixed(2) : ''}
                    />
                  </Field>
                  <Field label="Waiting period" htmlFor={`waiting-${item.kind}`}>
                    <Input id={`waiting-${item.kind}`} name="waitingPeriod" defaultValue={item.waitingPeriod ?? ''} />
                  </Field>
                  <Field label="Benefit period" htmlFor={`benefit-${item.kind}`}>
                    <Input id={`benefit-${item.kind}`} name="benefitPeriod" defaultValue={item.benefitPeriod ?? ''} />
                  </Field>
                  <Field label="Last reviewed" htmlFor={`reviewed-${item.kind}`}>
                    <Input
                      id={`reviewed-${item.kind}`}
                      name="lastReviewed"
                      type="date"
                      defaultValue={item.lastReviewed ? toDateInputValue(item.lastReviewed, settings.timezone) : ''}
                    />
                  </Field>
                  <Field label="Next review" htmlFor={`next-${item.kind}`}>
                    <Input
                      id={`next-${item.kind}`}
                      name="nextReview"
                      type="date"
                      defaultValue={item.nextReview ? toDateInputValue(item.nextReview, settings.timezone) : ''}
                    />
                  </Field>
                  <div className="col-span-2 sm:col-span-3">
                    <Field label="Notes" htmlFor={`notes-${item.kind}`}>
                      <Input id={`notes-${item.kind}`} name="notes" defaultValue={item.notes ?? ''} />
                    </Field>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <Button type="submit" variant="secondary">Save</Button>
                  </div>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </Card>

      {/* Admin. */}
      <Card>
        <CardHeader title="Financial admin" hint="Last completed, next due. Not a task manager." />
        <ul className="divide-y divide-line">
          {adminItems.map((item) => (
            <li key={item.kind} className="py-3 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{item.label}</p>
                <Pill tone={item.overdue ? 'attention' : item.lastCompleted ? 'ontrack' : 'neutral'}>
                  {item.overdue
                    ? 'Overdue'
                    : item.lastCompleted
                      ? `Done ${formatDate(item.lastCompleted, settings.timezone)}`
                      : 'Not tracked'}
                </Pill>
              </div>
              <details className="group mt-2">
                <summary className="text-sm font-medium text-accent hover:underline">Edit</summary>
                <form action={saveAdminItemAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="kind" value={item.kind} />
                  <div className="w-40">
                    <Field label="Last completed" htmlFor={`completed-${item.kind}`}>
                      <Input
                        id={`completed-${item.kind}`}
                        name="lastCompleted"
                        type="date"
                        defaultValue={item.lastCompleted ? toDateInputValue(item.lastCompleted, settings.timezone) : ''}
                      />
                    </Field>
                  </div>
                  <div className="w-40">
                    <Field label="Next due" htmlFor={`due-${item.kind}`}>
                      <Input
                        id={`due-${item.kind}`}
                        name="nextDue"
                        type="date"
                        defaultValue={item.nextDue ? toDateInputValue(item.nextDue, settings.timezone) : ''}
                      />
                    </Field>
                  </div>
                  <div className="min-w-[10rem] flex-1">
                    <Field label="Notes" htmlFor={`notes-admin-${item.kind}`}>
                      <Input id={`notes-admin-${item.kind}`} name="notes" defaultValue={item.notes ?? ''} />
                    </Field>
                  </div>
                  <Button type="submit" variant="secondary">Save</Button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { getTodayView } from '@/lib/services/overview';
import { getSetupState } from '@/lib/services/settings';
import { formatCents } from '@/lib/money';
import { formatDayShort } from '@/lib/time';
import {
  Card,
  CardHeader,
  Empty,
  Figure,
  LinkButton,
  Money,
  Notice,
  Pill,
  Progress,
  Stack,
  Why,
} from '@/components/ui';
import { SafeToSpendCard } from '@/components/SafeToSpend';
import { FinancialHealthCard } from '@/components/FinancialHealth';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const setup = await getSetupState();

  if (!setup.hasAccounts) {
    return (
      <Stack>
        <Empty
          title="Nothing loaded yet"
          body="Run a sync to load your accounts, then map them to what they are for."
          action={<LinkButton href="/setup" variant="primary">Start setup</LinkButton>}
        />
      </Stack>
    );
  }

  const view = await getTodayView();
  const { cycle, insight, health, safeToSpend } = view;

  const tone =
    insight.tone === 'ATTENTION' ? 'attention' : insight.tone === 'NOTICE' ? 'notice' : 'ontrack';

  return (
    <div className="space-y-3">
      {/* The score. One number standing in for the five that answer "am I
          okay, and should I be spending right now" — everything below it is
          the same numbers shown individually, and the working behind the
          score itself is one tap away. */}
      {health.status === 'READY' ? <FinancialHealthCard health={health} /> : null}

      {/* The one insight. Whatever is worth saying in a full sentence today,
          distinct from the score above it. */}
      <Card className="border-l-[3px]" >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Pill tone={tone}>{insight.label}</Pill>
            <p className="mt-2 text-lg font-medium leading-snug tracking-tight">
              {insight.headline}
            </p>
            {insight.detail ? (
              <p className="mt-1 text-sm leading-relaxed text-muted">{insight.detail}</p>
            ) : null}
          </div>
          {insight.href ? (
            <Link
              href={insight.href}
              className="shrink-0 text-sm font-medium text-accent hover:underline"
            >
              Look
            </Link>
          ) : null}
        </div>
        <Why label="Why this?">
          <p>{insight.reason}</p>
          <p>
            Only one thing is shown here at a time. If everything could be surfaced, nothing would
            be.
          </p>
        </Why>
      </Card>

      {!setup.complete ? (
        <Notice tone="notice" title="Setup is not finished">
          <ul className="list-inside list-disc space-y-1">
            {setup.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href="/setup" className="font-medium text-accent hover:underline">
              Finish setup
            </Link>
          </p>
        </Notice>
      ) : null}

      {/* Safe to spend. The number this app exists to get right. */}
      {safeToSpend && cycle ? (
        <SafeToSpendCard
          result={safeToSpend}
          daysToPayday={cycle.progress.daysRemaining}
          nextPayday={cycle.endAt}
          nextPaydayIsProjected={cycle.endIsProjected}
          timezone={view.timezone}
        />
      ) : (
        <Empty
          title="No pay cycle yet"
          body="Once a salary payment is found, safe-to-spend starts working."
          action={<LinkButton href="/settings?tab=salary">Check the salary rule</LinkButton>}
        />
      )}

      {/* Goals. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {view.goals.map((goal) => (
          <Card key={goal.key}>
            <CardHeader
              title={goal.name}
              action={
                goal.reachedAt ? (
                  <Pill tone="ontrack">Reached</Pill>
                ) : goal.isHardFloor ? (
                  <Pill tone="protected">Protected</Pill>
                ) : (
                  <Pill tone="protected">Protected</Pill>
                )
              }
            />
            <p className="tabular text-figure-sm">
              {formatCents(goal.balanceCents, { showCents: false })}
              <span className="ml-1.5 text-base font-normal text-muted">
                / {formatCents(goal.targetCents, { showCents: false })}
              </span>
            </p>
            <Progress
              className="mt-3"
              value={goal.progressPct}
              tone={goal.reachedAt ? 'ontrack' : 'protected'}
              label={`${goal.name} progress`}
            />
            <p className="mt-2 text-sm text-muted">
              {goal.reachedAt
                ? `Reached. From here it is a floor rather than a goal.`
                : `${goal.progressPct}% there. ${formatCents(Math.max(0, goal.targetCents - goal.balanceCents))} to go.`}
            </p>
          </Card>
        ))}
      </div>

      {/* Purpose-built Savers, and what is invested. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader title="Travel" />
          <Figure cents={view.travelBalanceCents} size="sm" />
          <p className="mt-1 text-sm text-muted">For travel. Not a general fund.</p>
        </Card>
        <Card>
          <CardHeader title="Gear & Objects" />
          <Figure cents={view.gearBalanceCents} size="sm" />
          <p className="mt-1 text-sm text-muted">
            {view.gearBalanceCents > 0 ? (
              <Link href="/shopping" className="text-accent hover:underline">
                See what this covers
              </Link>
            ) : (
              'Empty until payday.'
            )}
          </p>
        </Card>
        <Card>
          <CardHeader title="Invested this cycle" />
          <Figure cents={view.investedThisCycleCents} size="sm" />
          <p className="mt-1 text-sm text-muted">
            {view.phase === 'PHASE_2' ? '17% of post-rent income.' : '8% of post-rent income.'}
          </p>
        </Card>
      </div>

      {/* Where we are in the fortnight. */}
      {cycle ? (
        <Card>
          <CardHeader
            title="Pay cycle"
            action={
              <Link href="/pay-cycle" className="text-sm font-medium text-accent hover:underline">
                Open
              </Link>
            }
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div>
              <p className="text-sm text-muted">Next payday</p>
              <p className="tabular text-lg font-semibold tracking-tight">
                {formatDayShort(cycle.endAt, view.timezone)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">Days until payday</p>
              <p className="tabular text-lg font-semibold tracking-tight">
                {cycle.progress.daysRemaining}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">This pay</p>
              <p className="tabular text-lg font-semibold tracking-tight">
                <Money cents={cycle.incomeCents} />
              </p>
            </div>
          </div>
          <Progress
            className="mt-3"
            value={cycle.progress.elapsedPct}
            tone="accent"
            label="Pay cycle elapsed"
          />
          <p className="mt-2 text-sm text-muted">
            {cycle.progress.elapsedPct}% of the fortnight gone.{' '}
            {cycle.endIsProjected
              ? 'The next payday is projected from your cadence until it lands.'
              : 'The next payday is confirmed.'}
          </p>
        </Card>
      ) : null}

      {view.leakageThisMonth.count > 0 ? (
        <Card>
          <CardHeader
            title="Leakage this month"
            action={
              <Link href="/review" className="text-sm font-medium text-accent hover:underline">
                Review
              </Link>
            }
          />
          <Figure cents={view.leakageThisMonth.cents} size="sm" />
          <p className="mt-1 text-sm text-muted">
            Across {view.leakageThisMonth.count}{' '}
            {view.leakageThisMonth.count === 1 ? 'movement' : 'movements'} out of purpose-built
            Savers, correlated with spending shortly after. Worth noticing, not worth worrying
            about.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

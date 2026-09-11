import Link from 'next/link';
import { buildCycleView, getCurrentCycleView, listPayCycles } from '@/lib/services/overview';
import { getPaydayView } from '@/lib/services/payday';
import { formatBasisPoints, formatCents } from '@/lib/money';
import { formatDayShort } from '@/lib/time';
import { attentionFor } from '@/lib/domain/status';
import { useMockData } from '@/lib/env';
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  Empty,
  KeyValue,
  LinkButton,
  Money,
  Notice,
  PaceBar,
  Pill,
  Progress,
  StatusPill,
  Why,
} from '@/components/ui';
import { simulatePaydayAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function PayCyclePage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const params = await searchParams;
  const cycles = await listPayCycles(10);

  const view = params.cycle
    ? await buildCycleView(params.cycle)
    : await getCurrentCycleView();

  if (!view) {
    return (
      <Empty
        title="No pay cycle yet"
        body="Pay cycles are worked out from your salary payments. Once one is found, this screen fills in."
        action={<LinkButton href="/settings?tab=salary">Check the salary rule</LinkButton>}
      />
    );
  }

  const payday = await getPaydayView(view.id);
  const isCurrent = cycles[0]?.id === view.id;

  return (
    <div className="space-y-5">
      <PageTitle sub="Know what is available, what is committed, and how this pay is working for you.">Pay cycle</PageTitle>
      {/* Cycle picker. */}
      {cycles.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-card p-1.5" role="navigation" aria-label="pay cycle options">
          {cycles.map((cycle, index) => (
            <Link
              key={cycle.id}
              aria-current={cycle.id === view.id ? "page" : undefined}
              href={`/pay-cycle?cycle=${cycle.id}`}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 py-2.5 text-xs font-medium transition-colors ${
                cycle.id === view.id
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:bg-track hover:text-ink'
              }`}
            >
              {index === 0 ? 'This cycle' : formatDayShort(cycle.startAt)}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Where we are. */}
      <Card>
        <CardHeader
          title={isCurrent ? 'This pay cycle' : 'Pay cycle'}
          hint={`${formatDayShort(view.startAt)} to ${formatDayShort(view.endAt)}`}
          action={<Pill tone="neutral">{view.phase === 'PHASE_1' ? 'Phase 1' : 'Phase 2'}</Pill>}
        />

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <p className="text-sm text-muted">Income</p>
            <p className="tabular text-figure-sm">{formatCents(view.incomeCents)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">Rent</p>
            <p className="tabular text-figure-sm">{formatCents(view.rentCents)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">Available to allocate</p>
            <p className="tabular text-figure-sm">{formatCents(view.allocatableCents)}</p>
          </div>
        </div>

        <Progress className="mt-4" value={view.progress.elapsedPct} label="Cycle elapsed" />
        <p className="mt-2 text-sm text-muted">
          {view.progress.elapsedPct}% elapsed, {view.progress.daysRemaining}{' '}
          {view.progress.daysRemaining === 1 ? 'day' : 'days'} to payday.
        </p>

        {view.progress.isOverdue ? (
          <Notice tone="notice" title="Pay has not landed yet">
            The projected payday has passed and no salary has been found since. The figures below
            still refer to the last cycle, so they are stretching.
          </Notice>
        ) : null}
      </Card>

      {/* The budget table. */}
      <Card>
        <CardHeader
          title="Categories"
          hint="Allocated, spent, and whether the pace matches the clock."
        />

        <ul className="divide-y divide-line">
          {view.categories.map((line) => {
            const usedPct = Math.min(100, line.spentPct);
            const attention = attentionFor(line);

            return (
              <li key={line.role} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{line.label}</span>
                  <StatusPill status={line.status} />
                </div>

                <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                  <span className="text-muted">
                    Allocated <Money cents={line.allocatedCents} className="text-ink" />
                  </span>
                  <span className="text-muted">
                    Spent <Money cents={line.spentCents} className="text-ink" />
                  </span>
                  <span className="text-muted">
                    Remaining{' '}
                    <Money
                      cents={line.remainingCents}
                      className={line.remainingCents < 0 ? 'text-attention' : 'text-ink'}
                    />
                  </span>
                </div>

                <PaceBar
                  spentPct={usedPct}
                  elapsedPct={line.elapsedPct}
                  tone={
                    line.status === 'PROTECTED'
                      ? 'protected'
                      : line.status === 'SPENT'
                        ? 'attention'
                        : line.status === 'RUNNING_HOT' || line.status === 'NEAR_LIMIT'
                          ? 'notice'
                          : 'ontrack'
                  }
                />

                <p className="mt-1.5 text-xs text-faint">
                  {line.spentPct}% of budget used · {line.elapsedPct}% of pay cycle elapsed
                  {attention === 'WORTH_NOTICING' && line.isEssential
                    ? ' · essential, so given extra room'
                    : ''}
                </p>

                <Why>
                  <p>{line.explanation}</p>
                  {line.isProtected ? (
                    <p>
                      Protected buckets are shown for completeness. Their balance is never counted
                      as money available to spend.
                    </p>
                  ) : null}
                </Why>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Payday autopilot. */}
      {payday ? (
        <Card>
          <CardHeader
            title="Payday"
            hint={
              payday.salaryDescription
                ? `${payday.salaryDescription}, ${formatDayShort(payday.startAt)}`
                : formatDayShort(payday.startAt)
            }
            action={<Pill tone="neutral">{payday.phase === 'PHASE_1' ? 'Phase 1' : 'Phase 2'}</Pill>}
          />

          <div className="space-y-0.5 border-b border-line pb-3">
            <KeyValue label="Income" value={<Money cents={payday.allocation.incomeCents} />} />
            <KeyValue label="Rent" value={<Money cents={-payday.allocation.rentCents} />} />
            <KeyValue
              label="Available for allocation"
              value={<Money cents={payday.allocation.allocatableCents} />}
            />
          </div>

          {payday.allocation.warnings.map((warning) => (
            <div key={warning} className="mt-3">
              <Notice tone="notice">{warning}</Notice>
            </div>
          ))}

          <p className="mb-2 mt-3 text-sm text-muted">
            What the plan says should have moved, against what actually did.
          </p>

          <ul className="divide-y divide-line">
            {payday.audit.rows.map((row) => (
              <li key={row.role} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-faint">
                    {row.isOffTheTop
                      ? `Off the top = ${formatCents(row.expectedCents)}`
                      : `${formatBasisPoints(row.basisPoints)} = ${formatCents(row.expectedCents)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm font-medium">
                    {row.status === 'NOT_TRACKED' ? '—' : formatCents(row.observedCents)}
                  </p>
                  <AuditPill status={row.status} />
                </div>
              </li>
            ))}
          </ul>

          <Why label="What does this mean?">
            <ul className="space-y-1.5">
              {payday.audit.rows.map((row) => (
                <li key={row.role}>
                  <span className="font-medium text-ink">{row.label}.</span> {row.explanation}
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-line pt-2">
              This app does not move money and never will. Up&apos;s own Pay Splitting does the
              transfers; this is the receipt.
            </p>
          </Why>
        </Card>
      ) : null}

      {useMockData() ? (
        <Card>
          <CardHeader
            title="Mock mode"
            hint="Add a payday to the mock feed and watch the whole flow run."
          />
          <form action={simulatePaydayAction}>
            <Button type="submit" variant="secondary">
              Simulate a payday
            </Button>
          </form>
          <p className="mt-2 text-sm text-muted">
            In Phase 1 this pushes Emergency past its target, which fires the milestone and moves
            the plan to Phase 2. No real money is involved anywhere in mock mode.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function AuditPill({ status }: { status: string }) {
  const map: Record<string, { tone: 'ontrack' | 'notice' | 'attention' | 'neutral'; text: string }> = {
    MATCHED: { tone: 'ontrack', text: 'Matched' },
    UNDER: { tone: 'notice', text: 'Under' },
    OVER: { tone: 'notice', text: 'Over' },
    MISSING: { tone: 'attention', text: 'Not seen' },
    NOT_TRACKED: { tone: 'neutral', text: 'Not tracked' },
  };
  const entry = map[status] ?? map.NOT_TRACKED!;
  return <Pill tone={entry.tone}>{entry.text}</Pill>;
}

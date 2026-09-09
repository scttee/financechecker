import Link from 'next/link';
import { prisma } from '@/lib/db';
import { PERIOD_LABEL, getReview, type ReviewPeriod } from '@/lib/services/review';
import { VERDICT_LABEL, listLeakageEvents, readExplanation } from '@/lib/services/leakageService';
import { RECURRING_STATUS_LABEL, listRecurring, monthlyCommitmentTotal } from '@/lib/services/recurringService';
import { KIND_LABEL, SEVERITY_LABEL, listOpenReviewItems } from '@/lib/services/reviewItems';
import { FREQUENCY_LABEL } from '@/lib/domain/recurring';
import { roleLabel } from '@/lib/domain/roles';
import { formatCents } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/time';
import { getSettings } from '@/lib/services/settings';
import {
  Button,
  Card,
  CardHeader,
  Money,
  Notice,
  Pill,
  Progress,
  StatusPill,
  Why,
  type PillTone,
} from '@/components/ui';
import {
  dismissAllReviewItemsAction,
  dismissReviewItemAction,
  setLeakageVerdictAction,
  setRecurringStatusAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

const PERIODS: ReviewPeriod[] = ['WEEK', 'MONTH', 'SIX_MONTHS'];

const SEVERITY_TONE: Record<string, PillTone> = {
  INFO: 'protected',
  WORTH_NOTICING: 'notice',
  NEEDS_ATTENTION: 'attention',
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = (PERIODS.includes(params.period as ReviewPeriod)
    ? params.period
    : 'WEEK') as ReviewPeriod;

  const [review, items, leakage, recurring, monthlyTotal, settings] = await Promise.all([
    getReview(period),
    listOpenReviewItems(),
    listLeakageEvents({ limit: 20 }),
    listRecurring(),
    monthlyCommitmentTotal(),
    getSettings(),
  ]);

  // Load the transactions named by leakage findings so the evidence can be
  // shown rather than just referenced.
  const spendIds = leakage.flatMap((e) => e.spendTransactionIds);
  const spendById = new Map(
    (
      await prisma.transaction.findMany({
        where: { id: { in: spendIds.length > 0 ? spendIds : ['none'] } },
      })
    ).map((t) => [t.id, t]),
  );

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/review?period=${p}`}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
              p === period ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-track hover:text-ink'
            }`}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </div>

      {/* The thirty-second version. */}
      <Card>
        <CardHeader
          title={PERIOD_LABEL[period]}
          hint={`${formatDate(review.from, settings.timezone)} to ${formatDate(review.to, settings.timezone)}`}
        />

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">Spent</p>
            <p className="tabular mt-1 text-figure-sm">
              {formatCents(review.spentCents, { showCents: false })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">Saved</p>
            <p className="tabular mt-1 text-figure-sm">
              {formatCents(review.savedCents, { showCents: false })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted">Invested</p>
            <p className="tabular mt-1 text-figure-sm">
              {formatCents(review.investedCents, { showCents: false })}
            </p>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-line border-t border-line">
          {review.categories.slice(0, 6).map((line) => (
            <li key={line.role} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-sm">{line.label}</span>
              <div className="flex items-baseline gap-3">
                <Money cents={line.spentCents} className="text-sm text-muted" />
                <StatusPill status={line.status} />
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted">Travel</p>
            <p className="tabular font-medium">
              <Money cents={review.travelInCents} showSign /> in
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Gear remaining</p>
            <p className="tabular font-medium">{formatCents(review.gearRemainingCents)}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm text-muted">Emergency</p>
            <p className="tabular font-medium">
              {formatCents(review.emergencyBalanceCents, { showCents: false })} /{' '}
              {formatCents(review.emergencyTargetCents, { showCents: false })}
            </p>
            <Progress
              className="mt-2"
              value={
                review.emergencyTargetCents > 0
                  ? (review.emergencyBalanceCents / review.emergencyTargetCents) * 100
                  : 0
              }
              tone="protected"
              label="Emergency progress"
            />
          </div>
        </div>
      </Card>

      {/* One thing to notice. */}
      {review.oneThing ? (
        <Card>
          <CardHeader title="One thing to notice" />
          <p className="text-base leading-snug">{review.oneThing.headline}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{review.oneThing.detail}</p>
        </Card>
      ) : null}

      {/* Things needing a decision. */}
      {items.length > 0 ? (
        <Card>
          <CardHeader
            title="Needs a look"
            action={
              <form action={dismissAllReviewItemsAction}>
                <button
                  type="submit"
                  className="text-xs font-medium text-muted hover:text-ink hover:underline"
                >
                  Clear all
                </button>
              </form>
            }
          />
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={SEVERITY_TONE[item.severity] ?? 'neutral'}>
                        {SEVERITY_LABEL[item.severity]}
                      </Pill>
                      <span className="text-xs text-faint">{KIND_LABEL[item.kind]}</span>
                    </div>
                    <p className="mt-1.5 font-medium leading-snug">{item.title}</p>
                    {item.body ? (
                      <p className="mt-0.5 text-sm leading-relaxed text-muted">{item.body}</p>
                    ) : null}
                  </div>
                  <form action={dismissReviewItemAction} className="shrink-0">
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-muted hover:text-ink hover:underline"
                    >
                      Dismiss
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Saver leakage. */}
      <Card>
        <CardHeader
          title="Saver movements"
          hint="Money leaving a Saver built for one purpose, followed by spending on another."
        />

        {leakage.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing found. Money is staying in the Savers it was put into.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {leakage.map((event) => {
              const explanation = readExplanation(event.explanation);
              const spends = event.spendTransactionIds
                .map((id) => spendById.get(id))
                .filter((t): t is NonNullable<typeof t> => Boolean(t));

              return (
                <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">
                        {explanation.headline ||
                          `${formatCents(event.transferCents)} moved out of ${roleLabel(event.sourceRole)}`}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {formatDateTime(event.transferAt, settings.timezone)} · confidence{' '}
                        {event.confidence}/100
                      </p>
                    </div>
                    <Pill tone={event.verdict === 'UNREVIEWED' ? 'notice' : 'neutral'}>
                      {VERDICT_LABEL[event.verdict]}
                    </Pill>
                  </div>

                  {spends.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {spends.map((spend) => (
                        <li key={spend.id} className="flex justify-between gap-3 text-sm">
                          <span className="text-muted">{spend.description}</span>
                          <Money cents={Math.abs(spend.amountCents)} className="text-muted" />
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Why label="Why was this flagged?">
                    {explanation.steps.map((step) => (
                      <p key={step.label}>
                        <span className="font-medium text-ink">{step.label}.</span> {step.detail}
                      </p>
                    ))}
                  </Why>

                  {event.verdict === 'UNREVIEWED' ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(['EXPECTED', 'LEGITIMATE_EXCEPTION', 'NOT_RELATED', 'CONFIRMED'] as const).map(
                        (verdict) => (
                          <form key={verdict} action={setLeakageVerdictAction}>
                            <input type="hidden" name="id" value={event.id} />
                            <input type="hidden" name="verdict" value={verdict} />
                            <button
                              type="submit"
                              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-track hover:text-ink"
                            >
                              {VERDICT_LABEL[verdict]}
                            </button>
                          </form>
                        ),
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Recurring. */}
      <Card>
        <CardHeader
          title="Recurring spend"
          hint={`About ${formatCents(monthlyTotal)} a month across ${recurring.length} ${recurring.length === 1 ? 'merchant' : 'merchants'}.`}
        />

        {recurring.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing has repeated often enough or regularly enough to call recurring yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recurring.map((row) => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{row.displayName}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {FREQUENCY_LABEL[row.frequency]} · {formatCents(row.typicalAmountCents)} ·{' '}
                      {formatCents(row.monthlyEquivalentCents)}/month · confidence {row.confidence}
                      /100
                    </p>
                    <p className="mt-0.5 text-xs text-faint">
                      Last {formatDate(row.lastSeenAt, settings.timezone)}
                      {row.nextExpectedAt
                        ? ` · next expected ${formatDate(row.nextExpectedAt, settings.timezone)}`
                        : ''}
                    </p>
                  </div>
                  <Pill tone={row.status === 'NEW' ? 'notice' : 'neutral'}>
                    {row.status === 'NEW' ? 'Possible new cost' : RECURRING_STATUS_LABEL[row.status]}
                  </Pill>
                </div>

                {row.status === 'NEW' ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(['EXPECTED', 'CANCELLED', 'NOT_RECURRING', 'REVIEW'] as const).map((status) => (
                      <form key={status} action={setRecurringStatusAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-track hover:text-ink"
                        >
                          {RECURRING_STATUS_LABEL[status]}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Notice tone="neutral">
          Marking something cancelled records your decision here. It does not cancel anything with
          the merchant, and this app has no way to.
        </Notice>
      </Card>
    </div>
  );
}

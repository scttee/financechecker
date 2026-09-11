import type { SafeToSpendResult } from '@/lib/domain/safeToSpend';
import { formatCents } from '@/lib/money';
import { formatDayShort } from '@/lib/time';
import { roleLabel } from '@/lib/domain/roles';
import { Card, CardHeader, Money, Progress, Why } from '@/components/ui';

/**
 * The safe-to-spend card.
 *
 * The hero figure is today's pace, not the total until payday — "what can I
 * spend today" is the question this gets checked daily to answer, and the
 * total is context for that, not the other way around. Still called a pace
 * rather than an allowance, because it is a way of reading the number rather
 * than a budget to be policed. And the working is always available: a figure
 * I cannot check is a figure I will stop believing.
 *
 * A pace barely moves when a single day's spending lands — an $8 coffee
 * against nine days left only pulls it down by less than a dollar, which
 * reads as "this isn't updating" even though the transaction landed fine. The
 * spent-today line underneath exists so today's spending is visible on its
 * own terms, next to the rate, rather than only smeared across the days that
 * remain.
 */
export function SafeToSpendCard({
  result,
  daysToPayday,
  nextPayday,
  nextPaydayIsProjected,
  timezone,
  spentTodayCents,
}: {
  result: SafeToSpendResult;
  daysToPayday: number;
  nextPayday: Date;
  nextPaydayIsProjected: boolean;
  timezone: string;
  spentTodayCents: number;
}) {
  const overToday = spentTodayCents > result.perDayCents;
  const todayPct =
    result.perDayCents > 0
      ? (spentTodayCents / result.perDayCents) * 100
      : spentTodayCents > 0
        ? 100
        : 0;

  return (
    <Card id="safe-to-spend" className="spend-hero">
      <CardHeader
        title="Your daily spending pace"
        hint={
          nextPaydayIsProjected
            ? `Payday projected for ${formatDayShort(nextPayday, timezone)}`
            : `Payday ${formatDayShort(nextPayday, timezone)}`
        }
      />

      <p className="tabular mt-5 text-5xl font-semibold tracking-tight sm:text-6xl">{formatCents(result.perDayCents, { showCents: false })}</p>

      <p className="mt-1.5 text-sm text-muted">
        <span className="tabular font-medium text-ink">{formatCents(result.safeToSpendCents)}</span>{' '}
        total over {daysToPayday} {daysToPayday === 1 ? 'day' : 'days'} to payday. Not an
        allowance, just the rate this spreads to.
      </p>

      {spentTodayCents > 0 || result.perDayCents > 0 ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted">Spent today</span>
            <span className="tabular font-medium">
              <Money cents={spentTodayCents} className={overToday ? 'text-attention' : undefined} />
            </span>
          </div>
          <Progress
            className="mt-1.5"
            value={todayPct}
            tone={overToday ? 'notice' : 'ontrack'}
            label="Spent today against today's pace"
          />
        </div>
      ) : null}

      {result.safeToSpendCents === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing spare in the discretionary buckets. Rent, bills, groceries and health are
          tracked separately. Check your pay cycle for their remaining budgets.
        </p>
      ) : null}

      <Why label="How was this calculated?">
        <ol className="space-y-2">
          {result.breakdown.map((line, index) => (
            <li key={`${line.label}-${index}`} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={
                    line.kind === 'RESULT' ? 'font-medium text-ink' : 'text-muted'
                  }
                >
                  {line.label}
                </span>
                <span
                  className={
                    line.kind === 'RESULT'
                      ? 'tabular font-medium text-ink'
                      : line.amountCents < 0
                        ? 'tabular text-attention'
                        : 'tabular text-muted'
                  }
                >
                  {line.kind === 'RESULT' || line.kind === 'CAP' || line.kind === 'FLOOR' ? (
                    <Money cents={line.runningCents} />
                  ) : (
                    <Money cents={line.amountCents} showSign />
                  )}
                </span>
              </div>
              <span className="text-xs leading-relaxed text-faint">{line.detail}</span>
            </li>
          ))}
        </ol>

        {result.exclusions.length > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-1.5 font-medium text-ink">Deliberately left out</p>
            <ul className="space-y-1">
              {result.exclusions.map((exclusion) => (
                <li key={exclusion.role} className="text-xs leading-relaxed">
                  <span className="font-medium text-muted">{roleLabel(exclusion.role)}</span>{' '}
                  <span className="text-faint">{exclusion.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-faint">
          Your bank balance is not this number, and it should not be. Most of a balance is already
          promised to rent, bills, Emergency and Future Options before you touch it.
        </p>
      </Why>
    </Card>
  );
}

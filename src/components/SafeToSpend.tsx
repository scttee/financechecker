import type { SafeToSpendResult } from '@/lib/domain/safeToSpend';
import { formatCents } from '@/lib/money';
import { formatDayShort } from '@/lib/time';
import { roleLabel } from '@/lib/domain/roles';
import { Card, Money, Why } from '@/components/ui';

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
  return (
    <Card id="safe-to-spend" className="spend-hero">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted">Your spending room</h2>
        <span className="text-xs text-muted">{nextPaydayIsProjected ? 'Expected payday' : 'Payday'} {formatDayShort(nextPayday, timezone)}</span>
      </div>
      <div className="mt-7 grid grid-cols-[1.25fr_1fr] items-end gap-4">
        <div><p className="text-sm text-muted">Available per day</p><p className="tabular mt-2 break-words text-5xl font-semibold tracking-tight sm:text-6xl">{formatCents(result.perDayCents, { showCents: false })}</p></div>
        <div className="border-l border-line pl-4"><p className="text-sm text-muted">Spent today</p><p className="tabular mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl"><Money cents={spentTodayCents} /></p></div>
      </div>
      <p className="mt-6 text-sm text-muted"><Money cents={result.safeToSpendCents} className="font-medium text-ink" /> left to spread over {daysToPayday} {daysToPayday === 1 ? 'day' : 'days'}, including today.</p>
      {result.safeToSpendCents === 0 ? <p className="mt-2 text-sm text-muted">No discretionary spending room remains. Essential budgets are tracked separately in your pay cycle.</p> : null}
      <Why label="How this works">
        <p>The daily figure spreads your remaining discretionary money evenly until payday. It updates as spending lands; it is a pace, not a fixed daily allowance.</p>
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

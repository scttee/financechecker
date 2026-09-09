import type { SafeToSpendResult } from '@/lib/domain/safeToSpend';
import { formatCents } from '@/lib/money';
import { formatDayShort } from '@/lib/time';
import { roleLabel } from '@/lib/domain/roles';
import { Card, CardHeader, Money, Why } from '@/components/ui';

/**
 * The safe-to-spend card.
 *
 * Two rules shape this. The daily figure is called a pace rather than an
 * allowance, because it is a way of reading the number rather than a budget to
 * be policed. And the working is always available: a figure I cannot check is
 * a figure I will stop believing.
 */
export function SafeToSpendCard({
  result,
  daysToPayday,
  nextPayday,
  nextPaydayIsProjected,
  timezone,
}: {
  result: SafeToSpendResult;
  daysToPayday: number;
  nextPayday: Date;
  nextPaydayIsProjected: boolean;
  timezone: string;
}) {
  return (
    <Card id="safe-to-spend">
      <CardHeader
        title="Safe to spend until payday"
        hint={
          nextPaydayIsProjected
            ? `Payday projected for ${formatDayShort(nextPayday, timezone)}`
            : `Payday ${formatDayShort(nextPayday, timezone)}`
        }
      />

      <p className="tabular text-figure">{formatCents(result.safeToSpendCents)}</p>

      <p className="mt-1.5 text-sm text-muted">
        Available pace: about{' '}
        <span className="tabular font-medium text-ink">
          {formatCents(result.perDayCents, { showCents: result.perDayCents < 1000 })}
        </span>
        /day over {daysToPayday} {daysToPayday === 1 ? 'day' : 'days'}. Not an allowance, just the
        rate this spreads to.
      </p>

      {result.safeToSpendCents === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing spare in the discretionary buckets. Rent, bills, groceries and health are
          separate and still funded.
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

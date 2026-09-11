import type { DailyCategoryLine } from '@/lib/services/overview';
import { formatCents } from '@/lib/money';
import { Card, CardHeader, Money, Progress } from '@/components/ui';

/**
 * Today, by category.
 *
 * Safe-to-spend answers "what's left overall". This answers the narrower
 * question that actually comes up mid-afternoon: is there room in Dining &
 * Social specifically, today specifically, for a coffee. Each category's
 * daily figure is what is left in it spread evenly over the days to payday —
 * a pace, not a per-day cap Up enforces, so going over it once is a thing to
 * notice rather than a rule broken.
 */
export function TodaySpendingCard({ categories }: { categories: DailyCategoryLine[] }) {
  if (categories.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Today, by category" hint="Spread evenly to payday" />
      <div className="space-y-4">
        {categories.map((c) => {
          const hasBudget = c.dailyBudgetCents > 0;
          const pct = hasBudget
            ? (c.spentTodayCents / c.dailyBudgetCents) * 100
            : c.spentTodayCents > 0
              ? 100
              : 0;
          const over = c.spentTodayCents > c.dailyBudgetCents;

          return (
            <div key={c.role}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">{c.label}</span>
                <span className="tabular text-sm">
                  <Money cents={c.spentTodayCents} className={over ? 'text-attention' : undefined} />
                  <span className="text-muted"> today</span>
                </span>
              </div>
              <Progress
                className="mt-1.5"
                value={pct}
                tone={!hasBudget ? 'attention' : over ? 'notice' : 'ontrack'}
                label={`${c.label} spent today against daily pace`}
              />
              <p className="mt-1 text-xs text-muted">
                {hasBudget ? (
                  <>
                    About {formatCents(c.dailyBudgetCents, { showCents: false })}/day left in{' '}
                    {c.label.toLowerCase()}, {formatCents(Math.max(0, c.remainingCents), { showCents: false })} to
                    payday.
                  </>
                ) : (
                  <>Nothing spare left in {c.label.toLowerCase()} this cycle.</>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

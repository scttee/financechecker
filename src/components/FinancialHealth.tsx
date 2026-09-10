import type { FinancialHealth, HealthTier } from '@/lib/domain/health';
import type { ScoreTrend } from '@/lib/services/healthScoreHistory';
import { Card, Why } from '@/components/ui';

const TIER_COLOR: Record<HealthTier, string> = {
  THRIVING: 'var(--ontrack)',
  STEADY: 'var(--ontrack)',
  TIGHTENING: 'var(--notice)',
  NEEDS_A_LOOK: 'var(--attention)',
};

const TIER_TRACK: Record<HealthTier, string> = {
  THRIVING: 'var(--ontrack-soft)',
  STEADY: 'var(--ontrack-soft)',
  TIGHTENING: 'var(--notice-soft)',
  NEEDS_A_LOOK: 'var(--attention-soft)',
};

function trendLine(currentScore: number, trend: ScoreTrend | null): string | null {
  if (!trend) return null;
  const point = trend.threeMonthsAgo ?? trend.oneMonthAgo;
  if (!point) return null;

  const delta = currentScore - point.score;
  const span = trend.threeMonthsAgo ? '3 months' : '1 month';
  if (delta === 0) return `Unchanged in ${span}`;
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'point' : 'points'} in ${span}`;
}

/**
 * One score standing in for the six dimensions already shown individually
 * elsewhere — Cashflow, Resilience, Wealth Building, Optionality,
 * Protection, Admin. Nothing here is computed twice: opening "What's behind
 * this?" shows the same figures already trusted on Pay Cycle, Goals and the
 * Health dashboard, just weighted into one read.
 */
export function FinancialHealthCard({
  health,
  trend = null,
}: {
  health: FinancialHealth;
  trend?: ScoreTrend | null;
}) {
  const color = TIER_COLOR[health.tier];
  const track = TIER_TRACK[health.tier];

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - health.score / 100);
  const trendText = trendLine(health.score, trend);

  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r={radius} fill="none" stroke={track} strokeWidth="9" />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 400ms ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-2xl font-bold tracking-tight">{health.score}</span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium uppercase tracking-[0.08em]" style={{ color }}>
            {health.tierLabel}
          </p>
          {trendText ? <p className="mt-0.5 text-xs text-faint">{trendText}</p> : null}
          <p className="mt-1 text-sm leading-relaxed text-muted">{health.spendingGuidance}</p>
        </div>
      </div>

      <Why label="What's behind this?">
        <div className="space-y-3">
          {health.dimensions.map((dim) => (
            <div key={dim.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-ink">{dim.label}</span>
                <span className="tabular text-faint">
                  {dim.points}/{dim.maxPoints}
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(dim.points / dim.maxPoints) * 100}%`,
                    backgroundColor: TIER_COLOR[health.tier],
                  }}
                />
              </div>
              <ul className="mt-1.5 space-y-1 border-l border-line pl-2.5">
                {dim.subFactors.map((factor) => (
                  <li key={factor.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-faint">{factor.label}</span>
                    <span className="tabular shrink-0 text-faint">
                      {factor.points >= 0 ? '+' : ''}
                      {factor.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3">
          Every number behind this score is shown in full elsewhere — this just weighs them
          together. Nothing here is calculated by Claude; this is arithmetic, the same as
          everywhere else in the app.
        </p>
      </Why>
    </Card>
  );
}

import type { FinancialHealth, HealthTier } from '@/lib/domain/health';
import { Card, Why } from '@/components/ui';
import { cn } from '@/lib/cn';

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

/**
 * One score standing in for the five numbers already shown individually
 * elsewhere on Today — pace, spending room, Emergency coverage,
 * attentiveness, and how current the pay cycle is. Nothing here is computed
 * twice: opening "What's behind this?" shows the same figures already
 * trusted on Pay Cycle, Goals and Review, just weighted into one read.
 */
export function FinancialHealthCard({ health }: { health: FinancialHealth }) {
  const color = TIER_COLOR[health.tier];
  const track = TIER_TRACK[health.tier];

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - health.score / 100);

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
          <p
            className="text-[0.8125rem] font-medium uppercase tracking-[0.08em]"
            style={{ color }}
          >
            {health.tierLabel}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{health.spendingGuidance}</p>
        </div>
      </div>

      <Why label="What's behind this?">
        <ul className="space-y-2.5">
          {health.factors.map((factor) => (
            <li key={factor.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-ink">{factor.label}</span>
                <span className="tabular text-faint">{Math.round(factor.weight * 100)}% weight</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-track">
                <div
                  className={cn('h-full rounded-full')}
                  style={{ width: `${factor.score}%`, backgroundColor: TIER_COLOR[health.tier] }}
                />
              </div>
              <p className="mt-1">{factor.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3">
          Every number behind this score is shown in full elsewhere — this just weighs them
          together. Pace and spending room count for most of it; Emergency coverage, staying on
          top of leakage findings and an up-to-date pay cycle make up the rest.
        </p>
      </Why>
    </Card>
  );
}

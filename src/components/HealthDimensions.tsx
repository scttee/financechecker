import { HeartPulse, ShieldCheck, TrendingUp, Compass, Umbrella, ClipboardCheck } from 'lucide-react';
import type { FinancialHealth } from '@/lib/domain/health';
import { Card, Progress, Why } from '@/components/ui';

const icons = { CASHFLOW: HeartPulse, RESILIENCE: ShieldCheck, WEALTH_BUILDING: TrendingUp, OPTIONALITY: Compass, PROTECTION: Umbrella, ADMIN: ClipboardCheck };
export function HealthDimensions({ health }: { health: FinancialHealth }) {
  return <section aria-labelledby="health-dimensions" className="space-y-4">
    <h2 id="health-dimensions" className="text-xl font-semibold tracking-tight">The full picture</h2>
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{health.dimensions.map((dim) => {
      const Icon = icons[dim.key];
      return <Card key={dim.key}><div className="mb-4 flex items-center gap-2 text-accent"><Icon className="h-5 w-5" aria-hidden /><h3 className="text-sm font-semibold">{dim.label}</h3></div>
        <p className="tabular text-3xl font-semibold">{dim.points}<span className="ml-1 text-base font-normal text-muted">/ {dim.maxPoints}</span></p>
        <Progress value={dim.points / dim.maxPoints * 100} label={`${dim.label}: ${dim.points} of ${dim.maxPoints} points`} className="mt-4" />
        <Why label="What contributes">{dim.subFactors.map((factor) => <div key={factor.key}><p className="flex justify-between gap-3 font-medium text-ink"><span>{factor.label}</span><span className="tabular shrink-0">{factor.points}/{factor.maxPoints}</span></p><p className="mt-1 text-xs">{factor.detail}</p></div>)}</Why>
      </Card>;
    })}</div>
  </section>;
}

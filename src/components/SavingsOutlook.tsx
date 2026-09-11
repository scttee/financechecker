'use client';

import { useState } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Card, Field, Input, Why } from '@/components/ui';
import { projectSavings } from '@/lib/domain/savingsProjection';
import type { CareerBreakContext } from '@/lib/domain/careerBreak';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/cn';

export function SavingsOutlook({ data }: { data: CareerBreakContext & { perCycleCents: number } }) {
  const [months, setMonths] = useState(12);
  const [extra, setExtra] = useState('50');
  const amount = Number(extra);
  const valid = extra.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 10000;
  const result = projectSavings({ ...data, months, extraPerCycleCents: valid ? Math.round(amount * 100) : 0 });
  const cadence = data.cadence === 'MONTHLY' ? 'month' : data.cadence === 'WEEKLY' ? 'week' : 'fortnight';
  const max = Math.max(1, result.scenarioCents);
  const path = (kind: 'baselineCents' | 'scenarioCents') => result.points.map((p) => `${30 + p.month / months * 440},${170 - p[kind] / max * 145}`).join(' ');
  return <div className="space-y-4">
    <Card className="outlook-card !p-6 sm:!p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4" aria-hidden />Savings & investments</p>
        <div role="group" aria-label="Projection horizon" className="flex rounded-full bg-white/10 p-1">
          {[12,36,60].map((n) => <button key={n} type="button" aria-pressed={months === n} onClick={() => setMonths(n)} className={cn('min-h-11 rounded-full px-4 text-sm font-medium', months === n ? 'bg-white text-[#20212b]' : 'text-white')}>{n/12}Y</button>)}
        </div>
      </div>
      <p className="mt-7 text-sm text-white/80">In {months/12} {months === 12 ? 'year' : 'years'}{valid && amount > 0 ? `, saving ${formatCents(Math.round(amount * 100))} extra each ${cadence}` : ', at your current allocation'}</p>
      <p className="tabular mt-2 break-words text-4xl font-semibold tracking-tight sm:text-6xl">{valid ? formatCents(result.scenarioCents, {showCents:false}) : 'Check the amount below'}</p>
      <p className="mt-3 text-sm text-white/80">{formatCents(data.balanceCents, {showCents:false})} today. Contributions only; no market growth assumed.</p>
      <svg role="img" aria-label={`Current allocation projects ${formatCents(result.baselineCents)}. ${valid ? `With extra saving: ${formatCents(result.scenarioCents)}.` : 'Enter a valid extra amount.'} Monthly figures available below.`} viewBox="0 0 500 195" className="mt-5 max-h-64 w-full">
        {[0,0.5,1].map((f) => <line key={f} x1="30" x2="470" y1={170-f*145} y2={170-f*145} stroke="rgba(255,255,255,0.15)" />)}
        <polyline points={path('baselineCents')} fill="none" stroke="#c3c7d6" strokeWidth="2" strokeDasharray="5 5" />
        {valid ? <polyline points={path('scenarioCents')} fill="none" stroke="#bff5d6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /> : null}
        <text x="30" y="192" fill="#e2e5ee" fontSize="17">Today</text><text x="470" y="192" textAnchor="end" fill="#e2e5ee" fontSize="17">{months/12} {months === 12 ? 'year' : 'years'}</text>
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/80"><span>— With extra saving</span><span>┄ Current allocation</span></div>
    </Card>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <Field label={`Save a little more each ${cadence}`} htmlFor="extra-saving" hint="Money you choose to keep rather than spend. This is a what-if; your bank plan stays unchanged.">
          <div className="mt-3 flex items-center gap-2"><span aria-hidden className="text-2xl text-muted">$</span><Input id="extra-saving" aria-describedby="extra-saving-hint" aria-label={`Extra dollars saved each ${cadence}`} type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} aria-invalid={!valid || undefined} className="!text-2xl !font-semibold" /></div>
        </Field>
        {!valid ? <p className="mt-2 text-sm text-attention">Enter an amount from $0 to $10,000.</p> : null}
      </Card>
      <Card className="!bg-accent-soft">
        <p className="flex items-center gap-2 text-sm font-medium text-muted"><ArrowUpRight className="h-4 w-4" aria-hidden />The difference it makes</p>
        <p role="status" aria-live="polite" className="tabular mt-4 text-3xl font-semibold tracking-tight">{valid ? `+${formatCents(result.extraSavedCents, {showCents:false})}` : '—'}</p>
        <p className="mt-2 text-sm text-muted">Extra kept over {result.cycles} projected paydays.</p>
      </Card>
    </div>
    <Why label="Assumptions & monthly figures">
      <p>Starting balance: Emergency + Future Options + latest recorded investments. Everyday cash, Travel, Gear, super and debts are excluded, so this is not a net-worth projection. Investment snapshots may be older than bank balances.</p>
      <p>Your current allocation contributes {formatCents(data.perCycleCents)} each {cadence}. This rate is held constant and all projected contributions are retained. Paydays follow your salary cadence after today. No withdrawals, interest, investment returns, fees, inflation or tax changes are modelled.</p>
      <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><caption className="sr-only">Contributions-only monthly projection</caption><thead><tr><th scope="col" className="py-2 text-left">Month</th><th scope="col" className="text-right">Current plan</th><th scope="col" className="text-right">With extra</th></tr></thead><tbody>{result.points.map((p) => <tr key={p.month} className="border-t border-line"><th scope="row" className="py-2 text-left font-normal">{p.month === 0 ? 'Today' : p.month}</th><td className="tabular text-right">{formatCents(p.baselineCents,{showCents:false})}</td><td className="tabular text-right">{valid ? formatCents(p.scenarioCents,{showCents:false}) : '—'}</td></tr>)}</tbody></table></div>
    </Why>
  </div>;
}

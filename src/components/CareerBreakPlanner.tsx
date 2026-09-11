'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, CalendarDays, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Card, CardHeader, Field, Input, Money, Pill, Why } from '@/components/ui';
import { careerBreakSchema, projectCareerBreak, shiftMonths, type CareerBreakContext, type CareerBreakInputs } from '@/lib/domain/careerBreak';
import { saveCareerBreakPlan } from '@/app/(app)/plan/actions';
import { formatCents } from '@/lib/money';

const showDate = (s: string) => new Intl.DateTimeFormat('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
const serialise = (p: CareerBreakInputs) => ({ startDate: p.startDate, durationMonths: String(p.durationMonths), monthlyCostCents: String(p.monthlyCostCents / 100), perCycleCents: String(p.perCycleCents / 100), upfrontCents: String(p.upfrontCents / 100), bufferMonths: String(p.bufferMonths) });

export function CareerBreakPlanner({ initial, context, savedAt, baselinePerCycleCents }: {
  initial: CareerBreakInputs; context: CareerBreakContext; savedAt: string | null; baselinePerCycleCents: number;
}) {
  const [fields, setFields] = useState(() => serialise(initial));
  const [savedFields, setSavedFields] = useState(() => savedAt ? JSON.stringify(serialise(initial)) : '');
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(fields) !== savedFields;
  const input = careerBreakSchema.safeParse({
    startDate: fields.startDate,
    durationMonths: Number(fields.durationMonths),
    monthlyCostCents: Math.round(Number(fields.monthlyCostCents) * 100),
    perCycleCents: Math.round(Number(fields.perCycleCents) * 100),
    upfrontCents: Math.round(Number(fields.upfrontCents) * 100),
    bufferMonths: Number(fields.bufferMonths),
  });
  const valid = input.success && Object.values(fields).every((s) => s.trim() !== '') && fields.startDate >= context.today && fields.startDate <= shiftMonths(context.today, 240);
  const result = valid && input.success ? projectCareerBreak(input.data, context) : null;
  const baseline = valid && input.success ? projectCareerBreak({ ...input.data, perCycleCents: baselinePerCycleCents }, context) : null;
  const cadenceLabel = context.cadence === 'MONTHLY' ? 'month' : context.cadence === 'WEEKLY' ? 'week' : 'fortnight';
  const set = (key: keyof typeof fields, value: string) => { setFields((f) => ({ ...f, [key]: value })); setMessage(''); };
  const moneyField = (key: 'monthlyCostCents' | 'perCycleCents' | 'upfrontCents', label: string, hint: string) => (
    <Field label={label} htmlFor={key} hint={hint}>
      <Input id={key} type="number" inputMode="decimal" min={key === 'monthlyCostCents' ? '0.01' : '0'} max="1000000" step="0.01" value={fields[key]} onChange={(e) => set(key, e.target.value)} required />
    </Field>
  );
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="order-2 lg:order-none">
        <CardHeader title="Shape your break" hint="Explore a possibility, then save the assumptions you want to keep." />
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !input.success) return;
          const submitted = JSON.stringify(fields);
          startTransition(async () => {
            try {
              const response = await saveCareerBreakPlan(input.data);
              setMessage(response.message);
              if (response.ok) setSavedFields(submitted);
            } catch { setMessage('Your session may have expired. Sign in again before saving.'); }
          });
        }}>
          <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
            <legend className="sr-only">Career break assumptions</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date" htmlFor="startDate" hint="Your first day without salary.">
                <Input id="startDate" type="date" min={context.today} max={shiftMonths(context.today, 240)} value={fields.startDate} onChange={(e) => set('startDate', e.target.value)} required />
              </Field>
              <Field label="Months away" htmlFor="durationMonths">
                <Input id="durationMonths" type="number" min="1" max="60" step="1" value={fields.durationMonths} onChange={(e) => set('durationMonths', e.target.value)} required />
              </Field>
            </div>
            {moneyField('monthlyCostCents', 'Monthly living costs ($)', 'Include rent, everyday spending and any costs you expect to keep paying.')}
            {moneyField('perCycleCents', `Save each ${cadenceLabel} ($)`, `Your current plan sends ${formatCents(baselinePerCycleCents)} to Future Options each ${cadenceLabel}.`)}
            {moneyField('upfrontCents', 'One-off costs ($)', 'For example, flights, moving or study fees. Deducted at the start.')}
            <Field label="Return-to-work buffer (months)" htmlFor="bufferMonths" hint="Money you want left when the break ends, using the same monthly costs.">
              <Input id="bufferMonths" type="number" min="0" max="24" step="1" value={fields.bufferMonths} onChange={(e) => set('bufferMonths', e.target.value)} required />
            </Field>
            {result ? <p role="status" aria-live="polite" className="rounded-xl bg-paper p-3 text-sm">{result.gapCents > 0 ? `${formatCents(result.gapCents)} funding gap with these assumptions.` : "This scenario covers your break and buffer."}</p> : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button type="submit" disabled={!valid || !dirty}>{pending ? 'Saving…' : 'Save my plan'}</Button>
              <span className="text-xs text-muted">{dirty ? 'Unsaved scenario' : 'Saved to your account'}</span>
            </div>
          </fieldset>
          <p role="status" aria-live="polite" className="text-sm text-muted">{message}</p>
        </form>
      </Card>
      <div className="contents lg:block lg:space-y-5">
        {!result || !input.success ? (
          <Card><CardHeader title="Let’s fill in the picture" /><p className="text-sm text-muted">Enter a future start date, positive living costs, and valid amounts to see your projection. A saved start date in the past needs updating.</p></Card>
        ) : (
          <>
            <Card className="spend-hero order-1">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-accent"><Sparkles className="h-4 w-4" aria-hidden />Your possible future</span>
                <Pill tone={result.gapCents === 0 ? 'ontrack' : 'notice'}>{result.gapCents === 0 ? 'Funded in this scenario' : 'Funding gap'}</Pill>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight">{input.data.durationMonths} months of freedom</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted"><CalendarDays className="h-4 w-4" aria-hidden />{showDate(input.data.startDate)} <ArrowRight className="h-3 w-3" aria-label="to" />{showDate(shiftMonths(input.data.startDate, input.data.durationMonths))}</p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <div><p className="text-sm text-muted">Projected break fund</p><p className="tabular mt-1 text-3xl font-semibold">{formatCents(result.projectedCents, { showCents: false })}</p></div>
                <div><p className="text-sm text-muted">Needed, including buffer</p><p className="tabular mt-1 text-3xl font-semibold">{formatCents(result.targetCents, { showCents: false })}</p></div>
              </div>
              <p className="mt-4 text-xs text-muted">Starting with {formatCents(Math.max(0, context.balanceCents))} in Future Options and {result.cycles} projected paydays before the break.</p>
              <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed">
                {result.gapCents === 0 ? `This scenario covers your break and leaves ${formatCents(result.endBalanceCents)} when it ends.` : `${formatCents(result.gapCents)} more is needed to cover the break and your return-to-work buffer.`}
              </p>
            </Card>
            <Card className="order-3">
              <CardHeader title="Your fund through the break" hint="Balance after one-off costs, then each month’s living costs. Below zero means a shortfall." />
              <BalanceChart points={result.points} bufferCents={result.bufferCents} />
              <Why label="View monthly figures">
                <div className="max-h-72 overflow-y-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Projected monthly break fund balances</caption><thead><tr><th scope="col" className="py-2">Month</th><th scope="col" className="py-2 text-right">Balance</th></tr></thead><tbody>{result.points.map((p) => <tr key={p.month} className="border-t border-line"><th scope="row" className="py-2 font-normal">{p.month === 0 ? 'Start, after one-off costs' : `Month ${p.month}`}</th><td className="py-2 text-right tabular">{formatCents(p.balanceCents)}</td></tr>)}</tbody></table></div>
              </Why>
            </Card>
            <Card className="order-3">
              <CardHeader title="What gets you there" />
              <dl className="space-y-4 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Earliest funded start at this rate</dt><dd className="text-right font-semibold">{result.earliestStartDate ? result.earliestStartDate === context.today ? 'Already funded' : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${result.earliestStartDate}T00:00:00Z`)) : input.data.perCycleCents === 0 ? 'Add contributions to project a date' : 'Beyond the 20-year planning window'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Paydays before the break</dt><dd className="tabular font-semibold">{result.cycles}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Required each {cadenceLabel}</dt><dd className="tabular font-semibold">{result.requiredPerCycleCents === null ? 'No paydays left' : formatCents(result.requiredPerCycleCents)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Full months covered, preserving buffer</dt><dd className="tabular font-semibold">{result.fundedMonths}</dd></div>
              </dl>
              {baseline ? <p className="mt-4 border-t border-line pt-4 text-sm text-muted">At your current allocation, the projected fund is <Money cents={baseline.projectedCents} />{baseline.gapCents > 0 ? <>, leaving a <Money cents={baseline.gapCents} /> gap.</> : ', enough for this scenario.'} Extra contributions need to come from a real change to your budget.</p> : null}
            </Card>
          </>
        )}
        <Card className="order-3"><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-5 w-5 text-accent" aria-hidden />Emergency stays protected</p><p className="mt-2 text-sm text-muted">Only your Future Options balance funds this plan. Contributions follow your selected salary cadence and stop before the start date. There is no salary during the break. Costs stay constant; interest, investment returns, inflation and tax changes are excluded. These are planning assumptions, not a forecast or a change to your bank.</p></Card>
      </div>
    </div>
  );
}

function BalanceChart({ points, bufferCents }: { points: { month: number; balanceCents: number }[]; bufferCents: number }) {
  const max = Math.max(1, bufferCents, ...points.map((p) => p.balanceCents));
  const min = Math.min(0, ...points.map((p) => p.balanceCents));
  const y = (n: number) => 160 - (n - min) / (max - min) * 140;
  const line = points.map((p, i) => `${30 + i / (points.length - 1) * 440},${y(p.balanceCents)}`).join(' ');
  return <svg viewBox="0 0 500 200" className="mt-4 w-full" role="img" aria-label={`Fund starts at ${formatCents(points[0]!.balanceCents)} after one-off costs and ends at ${formatCents(points[points.length - 1]!.balanceCents)}. Buffer: ${formatCents(bufferCents)}. Monthly figures available below.`}>
    <line x1="30" x2="470" y1={y(0)} y2={y(0)} stroke="var(--line)" />
    <line x1="30" x2="470" y1={y(bufferCents)} y2={y(bufferCents)} stroke="var(--muted)" strokeDasharray="4 5" />
    <polyline fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={line} />
    <text x="30" y="190" fill="var(--muted)" fontSize="13">Start</text><text x="470" y="190" textAnchor="end" fill="var(--muted)" fontSize="13">Month {points.length - 1}</text>
    <text x="470" y={Math.max(14, y(bufferCents) - 8)} textAnchor="end" fill="var(--muted)" fontSize="12">Return-to-work buffer</text>
  </svg>;
}

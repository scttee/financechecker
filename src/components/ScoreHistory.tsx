'use client';

import { useState } from 'react';
import { Card, CardHeader, Why } from '@/components/ui';
import { cn } from '@/lib/cn';

export function ScoreHistory({ points, today, timezone = "Australia/Sydney" }: { points: { date: string; score: number }[]; today: string; timezone?: string }) {
  const [days, setDays] = useState(90);
  const end = new Date(today).getTime();
  const start = end - days * 86_400_000;
  const visible = points.filter((p) => new Date(p.date).getTime() >= start && new Date(p.date).getTime() <= end);
  const label = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: timezone }).format(new Date(s));
  const delta = visible.length > 1 ? visible[visible.length - 1]!.score - visible[0]!.score : null;
  const coords = visible.map((p) => `${35 + (new Date(p.date).getTime() - start) / (end - start) * 430},${155 - p.score * 1.3}`).join(' ');
  return <Card>
    <CardHeader title="Your health over time" hint="Recorded scores using the current formula. Missing days are not filled in." />
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="inline-flex rounded-xl bg-track p-1" role="group" aria-label="Score history period">
        {([30, 90, 180] as const).map((period) => <button key={period} type="button" aria-pressed={days === period} onClick={() => setDays(period)} className={cn('min-h-11 rounded-lg px-4 text-sm font-medium', period === days ? 'bg-card text-ink shadow-sm' : 'text-muted')}>{period === 30 ? '1 month' : period === 90 ? '3 months' : '6 months'}</button>)}
      </div>
      <p className="text-sm text-muted">{delta === null ? 'Building your history' : delta === 0 ? 'No net change across recorded scores' : `${delta > 0 ? '+' : ''}${delta} points across recorded scores`}</p>
    </div>
    {visible.length < 2 ? <p className="mt-6 rounded-xl bg-paper p-5 text-sm text-muted">{visible.length === 1 ? `One score recorded: ${visible[0]!.score} on ${label(visible[0]!.date)}. ` : 'No scores recorded in this period. '}A trend appears after at least two snapshots are recorded.</p> : <>
      <svg role="img" aria-label={`${visible.length} recorded scores, from ${visible[0]!.score} to ${visible[visible.length - 1]!.score}. Full values below.`} viewBox="0 0 500 195" className="mt-4 max-h-64 w-full">
        {[0, 50, 100].map((n) => <g key={n}><line x1="35" x2="465" y1={155 - n * 1.3} y2={155 - n * 1.3} stroke="var(--line)" strokeDasharray="3 5" /><text x="26" y={159 - n * 1.3} textAnchor="end" fontSize="12" fill="var(--muted)">{n}</text></g>)}
        <polyline points={coords} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
        {visible.map((p, i) => <circle key={i} cx={35 + (new Date(p.date).getTime() - start) / (end - start) * 430} cy={155 - p.score * 1.3} r="3" fill="var(--accent)" />)}
        <text x="35" y="185" fontSize="12" fill="var(--muted)">{label(new Date(start).toISOString())}</text><text x="465" y="185" textAnchor="end" fontSize="12" fill="var(--muted)">{label(today)}</text>
      </svg>
      <Why label="View recorded scores"><div className="max-h-64 overflow-y-auto"><table className="w-full text-sm"><caption className="sr-only">Financial health score history</caption><thead><tr><th scope="col" className="text-left">Recorded</th><th scope="col" className="text-right">Score out of 100</th></tr></thead><tbody>{visible.map((p, i) => <tr key={i} className="border-t border-line"><th scope="row" className="py-2 text-left font-normal">{label(p.date)}</th><td className="py-2 text-right tabular">{p.score}</td></tr>)}</tbody></table></div></Why>
    </>}
  </Card>;
}

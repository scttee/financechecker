'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ellipsis, Receipt, CalendarRange, Target, ShoppingBag, Settings, ClipboardCheck, Compass } from 'lucide-react';

export function ToolsMenu({ reviewCount }: {reviewCount:number}) {
  const path = usePathname();
  return <details className="relative" key={path} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
    <summary className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card hover:bg-track" aria-label="Open supporting tools"><Ellipsis className="h-5 w-5" aria-hidden /></summary>
    <nav aria-label="Supporting tools" className="absolute right-0 top-full z-40 mt-2 max-h-[75dvh] w-64 overflow-y-auto rounded-3xl border border-line bg-card p-2 shadow-xl">
      <p className="px-3 py-2 text-xs font-semibold text-muted">Explore & manage</p>
      {[
        {href:'/transactions',label:'Transactions',Icon:Receipt}, {href:'/pay-cycle',label:'Pay-cycle detail',Icon:CalendarRange},
        {href:'/review',label:'Review activity',Icon:ClipboardCheck}, {href:'/goals',label:'Balances & goals',Icon:Target},
        {href:'/shopping',label:'Purchase list',Icon:ShoppingBag}, {href:'/plan?view=career-break',label:'Career-break planner',Icon:Compass}, {href:'/settings',label:'Settings',Icon:Settings},
      ].map(({href,label,Icon}) => <Link key={href} href={href} onClick={(event) => { const panel = event.currentTarget.closest("details"); if (panel) panel.open = false; }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm hover:bg-track"><Icon className="h-4 w-4 text-muted" aria-hidden />{label}{href === '/review' && reviewCount > 0 ? <span className="ml-auto rounded-full bg-notice-soft px-2 text-xs text-notice">{reviewCount}<span className="sr-only"> items to review</span></span> : null}</Link>)}
    </nav>
  </details>;
}

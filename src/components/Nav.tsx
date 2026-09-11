'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, HeartPulse, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/today', label: 'Today', Icon: Home },
  { href: '/health', label: 'Health', Icon: HeartPulse },
  { href: '/plan', label: 'Future', Icon: TrendingUp },
];
export function Nav() {
  const path = usePathname();
  return <nav aria-label="Main" className="primary-nav">
    <ul className="flex items-center gap-1">{ITEMS.map(({href,label,Icon}) => {
      const active = path === href || path.startsWith(`${href}/`);
      return <li className="flex-1" key={href}><Link href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors', active ? 'bg-ink text-card' : 'text-muted hover:bg-track hover:text-ink')}><Icon className="h-4 w-4 shrink-0" aria-hidden /><span>{label}</span></Link></li>;
    })}</ul>
  </nav>;
}

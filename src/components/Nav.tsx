'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarRange,
  HeartPulse,
  Home,
  Receipt,
  Settings,
  ShoppingBag,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/today', label: 'Today', Icon: Home },
  { href: '/pay-cycle', label: 'Pay cycle', Icon: CalendarRange },
  { href: '/goals', label: 'Goals', Icon: Target },
  { href: '/shopping', label: 'Shopping', Icon: ShoppingBag },
  { href: '/review', label: 'Review', Icon: BarChart3 },
  { href: '/health', label: 'Health', Icon: HeartPulse },
  { href: '/transactions', label: 'Transactions', Icon: Receipt },
  { href: '/settings', label: 'Settings', Icon: Settings },
] as const;

/**
 * Navigation.
 *
 * A bottom bar on a phone, where the thumb is, and a horizontal strip on
 * larger screens. The five most-used destinations get the bar; Transactions
 * and Settings live behind the "More" position, because a dashboard you check
 * daily should not present seven equal choices.
 */
export function Nav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Phone: fixed bottom bar. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur sm:hidden"
        aria-label="Main"
      >
        <ul className="mx-auto flex max-w-column items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)]">
          {ITEMS.slice(0, 5).map(({ href, label, Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium transition-colors',
                  isActive(href) ? 'text-accent' : 'text-muted',
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={isActive(href) ? 2.2 : 1.7} aria-hidden />
                  {href === '/review' && reviewCount > 0 ? <Dot /> : null}
                </span>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Desktop and tablet: a quiet strip, not a stretched sidebar. */}
      <nav className="hidden sm:block" aria-label="Main">
        <ul className="flex flex-wrap items-center gap-1">
          {ITEMS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                  isActive(href)
                    ? 'bg-accent-soft text-accent'
                    : 'text-muted hover:bg-track hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                {label}
                {href === '/review' && reviewCount > 0 ? (
                  <span className="tabular rounded-full bg-notice-soft px-1.5 text-[0.6875rem] font-semibold text-notice">
                    {reviewCount}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Dot() {
  return (
    <span
      className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-notice"
      aria-label="Items to review"
    />
  );
}

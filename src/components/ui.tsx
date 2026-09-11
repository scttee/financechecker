/**
 * The interface primitives.
 *
 * Small, plain, and shaped by the product rules rather than by a component
 * library: restrained cards, one accent, muted status colours, large legible
 * figures, and a "Why?" disclosure available anywhere a number is calculated.
 */

import { cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import type { CategoryStatus } from '@/lib/domain/status';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = 'section',
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        'rounded-card border border-line bg-card p-5 shadow-card sm:p-6',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{children}</h1>
      {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
    </header>
  );
}

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-5', className)}>{children}</div>;
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="font-medium">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function Figure({
  cents,
  label,
  sub,
  size = 'lg',
  showCents = true,
}: {
  cents: number;
  label?: string;
  sub?: ReactNode;
  size?: 'lg' | 'md' | 'sm';
  showCents?: boolean;
}) {
  return (
    <div>
      {label ? (
        <p className="text-sm font-semibold tracking-wide text-muted">
          {label}
        </p>
      ) : null}
      <p
        className={cn(
          'tabular mt-1',
          size === 'lg' && 'text-figure',
          size === 'md' && 'text-figure-sm',
          size === 'sm' && 'text-lg font-semibold tracking-tight',
        )}
      >
        {formatCents(cents, { showCents })}
      </p>
      {sub ? <div className="mt-1 text-sm text-muted">{sub}</div> : null}
    </div>
  );
}

export function Money({
  cents,
  className,
  showCents = true,
  showSign = false,
}: {
  cents: number;
  className?: string;
  showCents?: boolean;
  showSign?: boolean;
}) {
  return (
    <span className={cn('tabular', className)}>{formatCents(cents, { showCents, showSign })}</span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({
  value,
  tone = 'accent',
  label,
  className,
}: {
  /** 0-100. */
  value: number;
  tone?: 'accent' | 'ontrack' | 'notice' | 'attention' | 'protected';
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const bar = {
    accent: 'bg-accent',
    ontrack: 'bg-ontrack',
    notice: 'bg-notice',
    attention: 'bg-attention',
    protected: 'bg-protectedc',
  }[tone];

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-track', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className={cn('h-full rounded-full transition-[width]', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * A budget bar with a marker showing how far through the cycle we are. The
 * marker is the whole point: a bar at 76% means nothing until you know
 * whether 35% or 90% of the fortnight has gone.
 */
export function PaceBar({
  spentPct,
  elapsedPct,
  tone = 'accent',
}: {
  spentPct: number;
  elapsedPct: number;
  tone?: 'accent' | 'ontrack' | 'notice' | 'attention' | 'protected';
}) {
  const spent = Math.max(0, Math.min(100, spentPct));
  const elapsed = Math.max(0, Math.min(100, elapsedPct));
  const bar = {
    accent: 'bg-accent',
    ontrack: 'bg-ontrack',
    notice: 'bg-notice',
    attention: 'bg-attention',
    protected: 'bg-protectedc',
  }[tone];

  return (
    <div role="img" aria-label={`${Math.round(spentPct)}% of budget spent; ${Math.round(elapsedPct)}% of pay cycle elapsed`} className="relative h-2 w-full overflow-hidden rounded-full bg-track">
      <div className={cn('h-full rounded-full', bar)} style={{ width: `${spent}%` }} />
      <div
        className="absolute top-0 h-full w-px bg-ink/40"
        style={{ left: `${elapsed}%` }}
        aria-hidden
        title={`${elapsed}% of the pay cycle elapsed`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type PillTone = 'neutral' | 'ontrack' | 'notice' | 'attention' | 'protected';

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  const tones: Record<PillTone, string> = {
    neutral: 'bg-track text-muted',
    ontrack: 'bg-ontrack-soft text-ontrack',
    notice: 'bg-notice-soft text-notice',
    attention: 'bg-attention-soft text-attention',
    protected: 'bg-protected-soft text-protectedc',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<CategoryStatus, PillTone> = {
  ON_TRACK: 'ontrack',
  RUNNING_HOT: 'notice',
  NEAR_LIMIT: 'notice',
  SPENT: 'attention',
  PROTECTED: 'protected',
  RESERVED: 'neutral',
};

export const STATUS_TEXT: Record<CategoryStatus, string> = {
  ON_TRACK: 'On track',
  RUNNING_HOT: 'Running hot',
  NEAR_LIMIT: 'Near limit',
  SPENT: 'Spent',
  PROTECTED: 'Protected',
  RESERVED: 'Reserved',
};

export function StatusPill({ status }: { status: CategoryStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Pill>;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

/**
 * Every calculated conclusion in this app can be opened up. Native <details>,
 * so it works without JavaScript and is announced correctly by screen readers.
 */
export function Why({
  children,
  label = 'Why?',
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <details className={cn('group mt-3', className)}>
      <summary className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        <span>{label}</span>
        <svg
          className="h-3 w-3 transition-transform group-open:rotate-90"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-line pl-3 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </details>
  );
}

export function KeyValue({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="tabular text-sm font-medium text-ink">{value}</span>
      {detail}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const buttonStyles = {
  primary: cn(BUTTON_BASE, 'bg-ink text-card hover:opacity-90'),
  secondary: cn(BUTTON_BASE, 'border border-line bg-card text-ink hover:bg-track'),
  ghost: cn(BUTTON_BASE, 'text-muted hover:bg-track hover:text-ink'),
  quiet: cn(
    'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-track hover:text-ink',
  ),
};

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonStyles;
}) {
  return (
    <button className={cn(buttonStyles[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof buttonStyles;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonStyles[variant], className)}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {hint && htmlFor && isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
            'aria-describedby': [((children as ReactElement<{ 'aria-describedby'?: string }>).props['aria-describedby']), `${htmlFor}-hint`].filter(Boolean).join(' '),
          })
        : children}
      {hint ? <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputStyles =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputStyles, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputStyles, 'resize-y', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputStyles, 'pr-8', props.className)} />;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: PillTone;
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<PillTone, string> = {
    neutral: 'border-line bg-track/50',
    ontrack: 'border-ontrack/25 bg-ontrack-soft',
    notice: 'border-notice/25 bg-notice-soft',
    attention: 'border-attention/25 bg-attention-soft',
    protected: 'border-protectedc/25 bg-protected-soft',
  };

  return (
    <div className={cn('rounded-card border p-3.5 text-sm leading-relaxed', tones[tone])}>
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-muted">{children}</div>
    </div>
  );
}

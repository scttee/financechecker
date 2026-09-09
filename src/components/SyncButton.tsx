'use client';

import { useFormStatus } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { syncAction } from '@/app/actions';

function Inner() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-track hover:text-ink disabled:opacity-60',
      )}
      aria-live="polite"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} aria-hidden />
      {pending ? 'Syncing' : 'Sync'}
    </button>
  );
}

export function SyncButton() {
  return (
    <form action={syncAction}>
      <Inner />
    </form>
  );
}

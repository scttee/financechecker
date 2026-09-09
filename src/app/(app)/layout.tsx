import { redirect } from 'next/navigation';
import { isSignedIn } from '@/lib/auth/session';
import { configStatus } from '@/lib/env';
import { countOpenReviewItems } from '@/lib/services/reviewItems';
import { Nav } from '@/components/Nav';
import { SyncButton } from '@/components/SyncButton';
import { Pill } from '@/components/ui';
import { signOutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * The signed-in shell.
 *
 * The session signature is verified here, on the server. Middleware only
 * checks that a cookie is present, because it runs on the Edge runtime where
 * node:crypto is unavailable.
 *
 * The review count is read defensively: a database that is not migrated yet
 * should show an empty badge, not a stack trace over the whole app.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSignedIn())) redirect('/login');

  const status = configStatus();
  let reviewCount = 0;
  try {
    reviewCount = await countOpenReviewItems();
  } catch {
    reviewCount = 0;
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-wide flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">Future Scotty</span>
            {status.mockMode ? (
              <Pill tone="notice" className="normal-case tracking-normal">
                Mock data
              </Pill>
            ) : null}
          </div>

          <div className="hidden flex-1 sm:block">
            <Nav reviewCount={reviewCount} />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <SyncButton />
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-track hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-wide px-5 pb-24 pt-5 sm:pb-10">{children}</main>

      <div className="sm:hidden">
        <Nav reviewCount={reviewCount} />
      </div>
    </div>
  );
}

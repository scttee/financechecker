import { redirect } from 'next/navigation';
import { appPasswordHash, authSecret, configStatus } from '@/lib/env';
import { verifyPassword } from '@/lib/auth/password';
import { isSignedIn, startSession } from '@/lib/auth/session';
import { Button, Card, Field, Input, Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Sign in.
 *
 * One password, one user. The form posts to a server action, so the password
 * never travels through a client-side handler and is never held in component
 * state.
 */
async function signIn(formData: FormData) {
  'use server';

  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/today');
  const hash = appPasswordHash();

  if (!hash) redirect('/login?error=not-configured');

  // Fail closed if AUTH_SECRET is missing, rather than issuing a cookie signed
  // with nothing.
  try {
    authSecret();
  } catch {
    redirect('/login?error=not-configured');
  }

  const ok = await verifyPassword(password, hash);
  if (!ok) redirect('/login?error=wrong');

  await startSession();
  // Only ever redirect within this app. An open redirect on a login form is a
  // gift to anyone building a phishing page.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/today');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (await isSignedIn()) redirect('/today');

  const params = await searchParams;
  const status = configStatus();

  return (
    <main className="mx-auto flex min-h-dvh max-w-column flex-col justify-center px-5 py-10">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Future Scotty</h1>
        <p className="mt-1 text-sm text-muted">
          {status.mockMode
            ? 'Running on mock data. No real bank is connected.'
            : 'Connected to Up. This page is the only way in.'}
        </p>
      </div>

      <Card>
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={params.next ?? '/today'} />

          <Field
            label="Password"
            htmlFor="password"
            hint="Set with npm run hash-password, stored as a scrypt hash in APP_PASSWORD_HASH."
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
            />
          </Field>

          {params.error === 'wrong' ? (
            <Notice tone="attention">That password did not match. Try again.</Notice>
          ) : null}

          {params.error === 'not-configured' || !status.authConfigured ? (
            <Notice tone="notice" title="Not set up yet">
              <p>
                APP_PASSWORD_HASH and AUTH_SECRET need to be set before you can sign in. From the
                project directory:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-track p-2.5 text-xs leading-relaxed text-ink">
                npm run gen-secret{'\n'}npm run hash-password -- &quot;your password&quot;
              </pre>
              <p className="mt-2">Put both values in .env and restart.</p>
            </Notice>
          ) : null}

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-xs leading-relaxed text-faint">
        This app reads your banking data. It never moves money and never makes payments.
      </p>
    </main>
  );
}

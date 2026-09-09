import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie';

/**
 * The gate.
 *
 * Everything except the login page, the webhook endpoint and static assets
 * requires a session cookie.
 *
 * The cookie's SIGNATURE is not checked here. Middleware runs on the Edge
 * runtime, which has no `node:crypto`, and reaching for a WebCrypto
 * reimplementation of the same check would mean two verification paths that
 * can disagree. Instead this is a cheap first pass, and every page and route
 * behind it verifies properly on the server. A forged cookie gets past the
 * doorman and is stopped at the desk.
 *
 * The webhook is exempt because Up authenticates with an HMAC signature, not a
 * session. It does its own verification and rejects anything unsigned.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/webhooks/up') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest';

  if (isPublic) return NextResponse.next();

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

/**
 * Sessions.
 *
 * A signed cookie, nothing more. There is one user, so there is no session
 * table, no refresh token dance, and no user record to look up. The cookie
 * carries an issue time and an expiry and is signed with HMAC-SHA256 over the
 * payload.
 *
 * Deliberately hand-rolled and short, because a hundred lines I can read end
 * to end is a better guarantee than a dependency I have not read at all.
 */

import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { authSecret } from '@/lib/env';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './cookie';

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

interface SessionPayload {
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
  /** Random, so two sessions issued in the same second differ. */
  jti: string;
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    iat,
    exp: iat + SESSION_TTL_SECONDS,
    jti: randomBytes(9).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, authSecret())}`;
}

export type SessionVerification =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

export function verifySessionToken(
  token: string | undefined | null,
  now: Date = new Date(),
): SessionVerification {
  if (!token) return { valid: false, reason: 'MALFORMED' };

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { valid: false, reason: 'MALFORMED' };

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, authSecret());

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return { valid: true, payload };
}

// ---------------------------------------------------------------------------
// Cookie handling
// ---------------------------------------------------------------------------

export async function startSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure in production. Left off locally so http://localhost works.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function isSignedIn(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value).valid;
}

/** Throws when not signed in. Used at the top of every server action. */
export async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) {
    throw new Error('Not signed in');
  }
}

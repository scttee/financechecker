/**
 * The session cookie name, and nothing else.
 *
 * This lives apart from session.ts on purpose. Middleware runs on the Edge
 * runtime, which has no `node:crypto`, and importing the name from session.ts
 * would drag the whole HMAC implementation into the Edge bundle and fail the
 * build. A module with no imports can be shared by both runtimes safely.
 */

export const SESSION_COOKIE = 'future_scotty_session';

/** 30 days. Long enough not to be a nuisance on a phone I check daily. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

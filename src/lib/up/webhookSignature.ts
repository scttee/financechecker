/**
 * Webhook signature verification.
 *
 * Up sends every webhook event with an `X-Up-Authenticity-Signature` header
 * holding the SHA-256 HMAC of the raw request body, signed with the webhook's
 * `secretKey`.
 *
 * Three things matter and all three are easy to get wrong:
 *
 *  1. The signature is over the RAW body. Parsing the JSON and re-serialising
 *     it changes whitespace and key order, and the signature will not match.
 *     The route reads `await request.text()` and passes the string here.
 *
 *  2. The comparison must be constant time. A plain `===` on strings leaks
 *     timing information that can be used to forge a signature byte by byte.
 *
 *  3. The algorithm is pinned to SHA-256 here. It is never read from the
 *     request, because an attacker who chooses the algorithm can choose a weak
 *     one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const UP_SIGNATURE_HEADER = 'x-up-authenticity-signature';

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: 'MISSING_SECRET' | 'MISSING_SIGNATURE' | 'MALFORMED_SIGNATURE' | 'MISMATCH' };

/** The hex-encoded SHA-256 HMAC of `rawBody` under `secret`. */
export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify an incoming webhook.
 *
 * Returns a reason rather than throwing, so the route can log why a delivery
 * was rejected without ever putting the secret or the expected signature into
 * the response.
 */
export function verifyUpSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): SignatureResult {
  if (!secret) return { valid: false, reason: 'MISSING_SECRET' };
  if (!signatureHeader) return { valid: false, reason: 'MISSING_SIGNATURE' };

  const received = signatureHeader.trim().toLowerCase();

  // A SHA-256 hex digest is exactly 64 hex characters. Anything else cannot
  // match, and rejecting it early keeps Buffer.from from silently truncating
  // rubbish into something the wrong length.
  if (!/^[0-9a-f]{64}$/.test(received)) {
    return { valid: false, reason: 'MALFORMED_SIGNATURE' };
  }

  const expected = computeSignature(rawBody, secret);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'MISMATCH' };

  return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'MISMATCH' };
}

export const SIGNATURE_FAILURE_MESSAGE: Record<
  Exclude<SignatureResult, { valid: true }>['reason'],
  string
> = {
  MISSING_SECRET:
    'UP_WEBHOOK_SECRET is not set, so incoming events cannot be verified. Events are being rejected until it is.',
  MISSING_SIGNATURE: 'The request arrived without an X-Up-Authenticity-Signature header.',
  MALFORMED_SIGNATURE: 'The signature header was not a 64-character SHA-256 hex digest.',
  MISMATCH: 'The signature did not match the body. The request was not signed by Up.',
};

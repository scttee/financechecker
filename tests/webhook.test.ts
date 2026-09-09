import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSignature, verifyUpSignature } from '@/lib/up/webhookSignature';

const SECRET = 'a-webhook-secret-key-from-up';

const BODY = JSON.stringify({
  data: {
    type: 'webhook-events',
    id: '32e730bd-752d-4ae8-a8e2-bab115c72b6d',
    attributes: { eventType: 'TRANSACTION_CREATED', createdAt: '2026-09-09T12:19:02+10:00' },
    relationships: {
      webhook: { data: { type: 'webhooks', id: '135017b5-2585-4564-ac7d-040043d51667' } },
      transaction: { data: { type: 'transactions', id: 'e1c6d0ab-1234-4b0a-9c1d-4d2e3f5a6b7c' } },
    },
  },
});

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('webhook signature verification', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyUpSignature(BODY, sign(BODY), SECRET)).toEqual({ valid: true });
  });

  it('computes the same digest Up documents', () => {
    // Up's own examples use hex-encoded SHA-256 HMAC over the raw body.
    expect(computeSignature(BODY, SECRET)).toBe(sign(BODY));
    expect(computeSignature(BODY, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a body that was tampered with after signing', () => {
    const signature = sign(BODY);
    const tampered = BODY.replace('TRANSACTION_CREATED', 'TRANSACTION_DELETED');
    expect(verifyUpSignature(tampered, signature, SECRET)).toEqual({
      valid: false,
      reason: 'MISMATCH',
    });
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyUpSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toEqual({
      valid: false,
      reason: 'MISMATCH',
    });
  });

  it('rejects a request with no signature header', () => {
    expect(verifyUpSignature(BODY, null, SECRET)).toEqual({
      valid: false,
      reason: 'MISSING_SIGNATURE',
    });
    expect(verifyUpSignature(BODY, '', SECRET)).toEqual({
      valid: false,
      reason: 'MISSING_SIGNATURE',
    });
  });

  it('rejects everything when no secret is configured, rather than letting it through', () => {
    expect(verifyUpSignature(BODY, sign(BODY), null)).toEqual({
      valid: false,
      reason: 'MISSING_SECRET',
    });
    expect(verifyUpSignature(BODY, sign(BODY), '')).toEqual({
      valid: false,
      reason: 'MISSING_SECRET',
    });
  });

  it('rejects a signature that is not a 64-character hex digest', () => {
    for (const bad of ['abc', 'z'.repeat(64), sign(BODY).slice(0, 63), `${sign(BODY)}00`]) {
      expect(verifyUpSignature(BODY, bad, SECRET).valid).toBe(false);
    }
    expect(verifyUpSignature(BODY, 'not-hex', SECRET)).toEqual({
      valid: false,
      reason: 'MALFORMED_SIGNATURE',
    });
  });

  it('accepts an uppercase hex digest, since hex case carries no meaning', () => {
    expect(verifyUpSignature(BODY, sign(BODY).toUpperCase(), SECRET)).toEqual({ valid: true });
  });

  it('is sensitive to whitespace, which is why the RAW body must be used', () => {
    // Parsing and re-serialising JSON changes the bytes and breaks the
    // signature. This test exists to make that failure mode explicit.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(reserialised).not.toBe(BODY);
    expect(verifyUpSignature(reserialised, sign(BODY), SECRET).valid).toBe(false);
  });

  it('handles a PING event body', () => {
    const ping = JSON.stringify({
      data: {
        type: 'webhook-events',
        id: 'ping-event-id',
        attributes: { eventType: 'PING', createdAt: '2026-09-09T12:19:02+10:00' },
        relationships: {
          webhook: { data: { type: 'webhooks', id: 'wh-1' } },
        },
      },
    });
    expect(verifyUpSignature(ping, sign(ping), SECRET)).toEqual({ valid: true });
  });

  it('handles a body containing multi-byte characters', () => {
    const body = JSON.stringify({ description: 'Café — ⚡️ 日本' });
    expect(verifyUpSignature(body, sign(body), SECRET)).toEqual({ valid: true });
  });

  it('handles an empty body without throwing', () => {
    expect(verifyUpSignature('', sign(''), SECRET)).toEqual({ valid: true });
  });
});

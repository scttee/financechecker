/**
 * The Up webhook endpoint.
 *
 * Four things this route must get right, in this order:
 *
 *  1. Read the RAW body. The signature is over the exact bytes Up sent, so the
 *     body is read as text and only parsed after verification.
 *  2. Verify the signature before doing anything else, using constant-time
 *     comparison. An unverified request is not looked at.
 *  3. Be idempotent. Up retries on any non-200 and the event id stays the same
 *     across retries, so the id is recorded and a repeat is a no-op.
 *  4. Answer fast. Up times out at 30 seconds and advises against heavy work
 *     before responding, so the event is recorded, a 200 is returned, and the
 *     sync happens after the response has gone.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { upWebhookSecret } from '@/lib/env';
import {
  SIGNATURE_FAILURE_MESSAGE,
  UP_SIGNATURE_HEADER,
  verifyUpSignature,
} from '@/lib/up/webhookSignature';
import type { UpWebhookEventCallback } from '@/lib/up/types';
import { processWebhookEvent } from '@/lib/services/webhookProcessor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // 1. Raw body. Never request.json() before verifying.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Could not read body' }, { status: 400 });
  }

  // 2. Signature.
  const signature = request.headers.get(UP_SIGNATURE_HEADER);
  const verification = verifyUpSignature(rawBody, signature, upWebhookSecret());

  if (!verification.valid) {
    // The reason is logged for the operator but never returned, so a caller
    // probing the endpoint learns nothing about why they failed.
    console.warn(`[up-webhook] rejected: ${SIGNATURE_FAILURE_MESSAGE[verification.reason]}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // 3. Parse, now that we know it came from Up.
  let payload: UpWebhookEventCallback;
  try {
    payload = JSON.parse(rawBody) as UpWebhookEventCallback;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const event = payload?.data;
  if (!event?.id || !event.attributes?.eventType) {
    return NextResponse.json({ error: 'Unexpected payload shape' }, { status: 400 });
  }

  const eventType = event.attributes.eventType;
  const transactionId = event.relationships?.transaction?.data?.id ?? null;

  // 4. Idempotency, but only for events we actually finished.
  //
  // An event we recorded and then failed to process is NOT a duplicate to be
  // waved through: doing that would turn Up's retry — the one mechanism that
  // could recover it — into a no-op. Only a settled outcome short-circuits.
  let existing: { status: string } | null;
  try {
    existing = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
      select: { status: true },
    });
  } catch (error) {
    // If we cannot even read the ledger we cannot say whether this event is
    // new, so we must not claim success. 503 keeps Up's retry alive.
    console.error('[up-webhook] could not read event ledger', error);
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  if (existing && (existing.status === 'PROCESSED' || existing.status === 'IGNORED')) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  if (!existing) {
    try {
      await prisma.webhookEvent.create({
        data: {
          id: event.id,
          eventType,
          transactionId,
          status: eventType === 'PING' ? 'PROCESSED' : 'RECEIVED',
          processedAt: eventType === 'PING' ? new Date() : null,
        },
      });
    } catch (error) {
      // Only a unique-constraint violation means two deliveries raced and the
      // other one has it. Every other failure — the database being
      // unreachable, a schema problem — must return non-2xx, or Up records the
      // delivery as successful and never retries an event we did not store.
      if (isUniqueViolation(error)) {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }
      console.error('[up-webhook] could not record event', error);
      return NextResponse.json({ error: 'Could not record event' }, { status: 503 });
    }
  }

  if (eventType === 'PING') {
    return NextResponse.json({ ok: true, pong: true }, { status: 200 });
  }

  // Kick off the work without awaiting it, so Up gets its 200 well inside the
  // 30-second timeout it documents.
  //
  // On a long-lived server this promise simply runs. On a serverless platform
  // the instance may be frozen the moment the response is sent, leaving the
  // row in RECEIVED. That is survivable rather than silent: the check above
  // lets Up's own retry pick it up, and `recoverStalledWebhookEvents` sweeps
  // anything still outstanding on the next sync. Neither path loses the event.
  void processWebhookEvent({ eventId: event.id, eventType, transactionId }).catch((error) => {
    console.error('[up-webhook] processing failed', error);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Prisma's unique-constraint code. Checked structurally rather than with
 * `instanceof`, so this holds across Prisma client versions and does not drag
 * the error classes into the bundle.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Up only ever POSTs here. A GET is answered with a short note so that opening
 * the URL in a browser explains itself rather than looking broken.
 */
export function GET() {
  return NextResponse.json(
    {
      endpoint: 'Up webhook receiver',
      method: 'POST',
      note: 'Requests must carry a valid X-Up-Authenticity-Signature header.',
      secretConfigured: upWebhookSecret() !== null,
    },
    { status: 200 },
  );
}

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

  // 4. Idempotency. The event id is constant across delivery retries, so a
  // repeat is acknowledged and dropped rather than processed twice.
  const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

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
  } catch {
    // A unique-constraint failure means two deliveries raced. The other one
    // has it; this one is done.
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  if (eventType === 'PING') {
    return NextResponse.json({ ok: true, pong: true }, { status: 200 });
  }

  // Kick off the work without awaiting it. Up gets its 200 immediately, and a
  // failure in processing is recorded against the event row rather than
  // causing a retry storm of events we have already accepted.
  void processWebhookEvent({ eventId: event.id, eventType, transactionId }).catch((error) => {
    console.error('[up-webhook] processing failed', error);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
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

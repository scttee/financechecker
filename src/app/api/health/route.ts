/**
 * Health check.
 *
 * For Railway, Docker and anything else that wants to know whether the process
 * is up. It reports whether the database answers and whether each integration
 * is configured, as booleans only. No secret, no value, no length, nothing
 * that would help someone work out what a credential looks like.
 *
 * Exempt from the session gate on purpose: a health check that requires a
 * login cannot do its job.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { configStatus } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const status = configStatus();

  return NextResponse.json(
    {
      ok: database,
      database,
      mockMode: status.mockMode,
      configured: {
        up: status.upTokenConfigured,
        webhook: status.upWebhookSecretConfigured,
        notion: status.notionConfigured,
        auth: status.authConfigured,
      },
      time: new Date().toISOString(),
    },
    { status: database ? 200 : 503 },
  );
}

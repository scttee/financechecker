/**
 * Webhook processing.
 *
 * Runs after the endpoint has already returned 200, so nothing here is on the
 * critical path of Up's 30-second timeout.
 *
 * Each event type has one job:
 *
 *   TRANSACTION_CREATED  fetch the transaction and store it
 *   TRANSACTION_SETTLED  fetch it again and update the SAME row, because the
 *                        id does not change when a hold settles
 *   TRANSACTION_DELETED  soft-delete, because Up no longer has the record and
 *                        the link would 404
 *   PING                 handled at the endpoint, never reaches here
 */

import 'server-only';

import type { UpWebhookEventType } from '@/lib/up/types';
import { prisma } from '@/lib/db';
import { getGateway } from '@/lib/up/gateway';
import { UpApiError, redact } from '@/lib/up/client';
import { normaliseTransaction, toTransactionWrite } from '@/lib/up/normalise';
import { classifyTransactions, rebuildPayCycles, checkPhaseAndMilestones } from './sync';
import { detectAndStoreLeakage } from './leakageService';

export interface WebhookJob {
  eventId: string;
  eventType: UpWebhookEventType;
  transactionId: string | null;
}

export async function processWebhookEvent(job: WebhookJob): Promise<void> {
  const { eventId, eventType, transactionId } = job;

  try {
    if (!transactionId) {
      await markProcessed(eventId, 'IGNORED', 'No transaction on the event');
      return;
    }

    if (eventType === 'TRANSACTION_DELETED') {
      // Up has removed it — usually a hotel deposit being returned. Soft
      // delete, so history stays explainable and the row can come back if the
      // transaction reappears.
      await prisma.transaction.updateMany({
        where: { id: transactionId },
        data: { deletedAt: new Date() },
      });
      await refreshDerived();
      await markProcessed(eventId, 'PROCESSED');
      return;
    }

    const gateway = getGateway();
    const resource = await gateway.getTransaction(transactionId);
    const normalised = normaliseTransaction(resource);

    // The account must exist before the transaction can reference it.
    const account = await prisma.account.findUnique({ where: { id: normalised.accountId } });
    if (!account) {
      const accounts = await gateway.listAccounts();
      for (const a of accounts) {
        await prisma.account.upsert({
          where: { id: a.id },
          create: {
            id: a.id,
            displayName: a.attributes.displayName,
            accountType: a.attributes.accountType,
            ownershipType: a.attributes.ownershipType,
            balanceCents: a.attributes.balance.valueInBaseUnits,
            openedAt: new Date(a.attributes.createdAt),
          },
          update: { balanceCents: a.attributes.balance.valueInBaseUnits },
        });
      }
    }

    const knownTransfer = normalised.transferAccountId
      ? await prisma.account.findUnique({ where: { id: normalised.transferAccountId } })
      : null;

    const write = {
      ...toTransactionWrite(normalised),
      transferAccountId: knownTransfer ? normalised.transferAccountId : null,
    };

    // Upsert on the Up id. A SETTLED event for a transaction we already hold
    // as HELD updates that row in place. There is no path here that creates a
    // second row for the same purchase.
    await prisma.transaction.upsert({
      where: { id: normalised.id },
      create: { id: normalised.id, ...write },
      update: write,
    });

    // Balances move when a transaction lands, so refresh them.
    const accounts = await gateway.listAccounts();
    for (const a of accounts) {
      await prisma.account.updateMany({
        where: { id: a.id },
        data: { balanceCents: a.attributes.balance.valueInBaseUnits, lastSyncedAt: new Date() },
      });
    }

    await refreshDerived();
    await markProcessed(eventId, 'PROCESSED');
  } catch (error) {
    const message =
      error instanceof UpApiError
        ? `${error.kind}: ${error.message}`
        : redact(error instanceof Error ? error.message : String(error));
    await markProcessed(eventId, 'FAILED', message);
  }
}

async function refreshDerived(): Promise<void> {
  await classifyTransactions();
  await rebuildPayCycles();
  await detectAndStoreLeakage();
  await checkPhaseAndMilestones();
}

async function markProcessed(
  eventId: string,
  status: 'PROCESSED' | 'FAILED' | 'IGNORED',
  error?: string,
): Promise<void> {
  await prisma.webhookEvent.updateMany({
    where: { id: eventId },
    data: { status, processedAt: new Date(), error: error?.slice(0, 1000) ?? null },
  });
}

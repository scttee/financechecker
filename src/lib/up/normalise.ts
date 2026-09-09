/**
 * Normalisation.
 *
 * Turns an Up resource into the narrow projection this app stores. What is
 * deliberately NOT kept: attachments, performing-customer records, note
 * bodies, foreign exchange breakdowns, and the raw JSON payload itself. If a
 * field is not used by a calculation or a screen, it is not stored.
 *
 * `rawText` and the card's last four digits are kept, because merchant rules
 * need the former and identifying which card was used needs the latter. Up
 * treats both as non-sensitive and neither identifies an account.
 */

import type { Prisma, TxStatus } from '@prisma/client';
import type { UpAccountResource, UpTransactionResource } from './types';

export interface NormalisedAccount {
  id: string;
  displayName: string;
  accountType: string;
  ownershipType: string;
  balanceCents: number;
  openedAt: Date;
}

export function normaliseAccount(resource: UpAccountResource): NormalisedAccount {
  return {
    id: resource.id,
    displayName: resource.attributes.displayName,
    accountType: resource.attributes.accountType,
    ownershipType: resource.attributes.ownershipType,
    balanceCents: resource.attributes.balance.valueInBaseUnits,
    openedAt: new Date(resource.attributes.createdAt),
  };
}

export interface NormalisedTransaction {
  id: string;
  status: TxStatus;
  accountId: string;
  description: string;
  rawText: string | null;
  message: string | null;
  amountCents: number;
  heldAmountCents: number | null;
  foreignAmountCents: number | null;
  foreignCurrency: string | null;
  roundUpCents: number | null;
  cashbackCents: number | null;
  isCategorizable: boolean;
  transactionType: string | null;
  cardSuffix: string | null;
  upCategoryId: string | null;
  upParentCategoryId: string | null;
  transferAccountId: string | null;
  isInternalTransfer: boolean;
  createdAt: Date;
  settledAt: Date | null;
  tags: string[];
}

/**
 * Normalise one transaction.
 *
 * `amountCents` is always the CURRENT amount. When a transaction settles, Up
 * replaces `amount` with the settled figure and moves the original into
 * `holdInfo.amount`. Because the transaction id does not change, an upsert on
 * that id updates the existing row in place and the held amount is preserved
 * alongside it. There is no path here that produces a second row for the same
 * purchase.
 */
export function normaliseTransaction(resource: UpTransactionResource): NormalisedTransaction {
  const a = resource.attributes;
  const r = resource.relationships;
  const transferAccountId = r.transferAccount?.data?.id ?? null;

  return {
    id: resource.id,
    status: a.status as TxStatus,
    accountId: r.account.data.id,
    description: a.description,
    rawText: a.rawText,
    message: a.message,
    amountCents: a.amount.valueInBaseUnits,
    heldAmountCents: a.holdInfo?.amount.valueInBaseUnits ?? null,
    foreignAmountCents: a.foreignAmount?.valueInBaseUnits ?? null,
    foreignCurrency: a.foreignAmount?.currencyCode ?? null,
    roundUpCents: a.roundUp?.amount.valueInBaseUnits ?? null,
    cashbackCents: a.cashback?.amount.valueInBaseUnits ?? null,
    isCategorizable: a.isCategorizable,
    transactionType: a.transactionType,
    cardSuffix: a.cardPurchaseMethod?.cardNumberSuffix ?? null,
    upCategoryId: r.category?.data?.id ?? null,
    upParentCategoryId: r.parentCategory?.data?.id ?? null,
    transferAccountId,
    // Up sets transferAccount only for movement between accounts I own, which
    // is precisely the signal the leakage detector needs.
    isInternalTransfer: transferAccountId !== null,
    createdAt: new Date(a.createdAt),
    settledAt: a.settledAt ? new Date(a.settledAt) : null,
    tags: r.tags?.data?.map((t) => t.id) ?? [],
  };
}

/**
 * Fields written on both create and update.
 *
 * Note what is absent: `role`, `roleSource`, `payCycleId`, `needsReview` and
 * `isSalary`. Those are the app's own decisions and a re-sync must not
 * overwrite a category I corrected by hand.
 */
export function toTransactionWrite(
  n: NormalisedTransaction,
): Omit<Prisma.TransactionUncheckedCreateInput, 'id'> {
  return {
    status: n.status,
    accountId: n.accountId,
    description: n.description,
    rawText: n.rawText,
    message: n.message,
    amountCents: n.amountCents,
    heldAmountCents: n.heldAmountCents,
    foreignAmountCents: n.foreignAmountCents,
    foreignCurrency: n.foreignCurrency,
    roundUpCents: n.roundUpCents,
    cashbackCents: n.cashbackCents,
    isCategorizable: n.isCategorizable,
    transactionType: n.transactionType,
    cardSuffix: n.cardSuffix,
    upCategoryId: n.upCategoryId,
    upParentCategoryId: n.upParentCategoryId,
    transferAccountId: n.transferAccountId,
    isInternalTransfer: n.isInternalTransfer,
    createdAt: n.createdAt,
    settledAt: n.settledAt,
    // A transaction reappearing in a sync after a delete event is undeleted.
    deletedAt: null,
  };
}

/**
 * Did this transaction change in a way worth recording?
 *
 * Used to keep sync statistics honest: a run that touched 400 transactions but
 * changed 2 should say so.
 */
export function hasMaterialChange(
  existing: {
    status: string;
    amountCents: number;
    settledAt: Date | null;
    description: string;
    upCategoryId: string | null;
    deletedAt: Date | null;
  },
  next: NormalisedTransaction,
): boolean {
  return (
    existing.status !== next.status ||
    existing.amountCents !== next.amountCents ||
    existing.description !== next.description ||
    existing.upCategoryId !== next.upCategoryId ||
    existing.deletedAt !== null ||
    (existing.settledAt?.getTime() ?? null) !== (next.settledAt?.getTime() ?? null)
  );
}

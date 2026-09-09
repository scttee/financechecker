import { describe, expect, it } from 'vitest';
import {
  hasMaterialChange,
  normaliseAccount,
  normaliseTransaction,
  toTransactionWrite,
} from '@/lib/up/normalise';
import type { UpAccountResource, UpTransactionResource } from '@/lib/up/types';

const TX_ID = 'e1c6d0ab-1234-4b0a-9c1d-4d2e3f5a6b7c';

/** A HELD transaction, as Up sends it when a card is tapped. */
function heldTransaction(): UpTransactionResource {
  return {
    type: 'transactions',
    id: TX_ID,
    attributes: {
      status: 'HELD',
      rawText: 'CONTINENTAL DELI NEWTOWN',
      description: 'Continental Deli',
      message: null,
      isCategorizable: true,
      holdInfo: {
        amount: { currencyCode: 'AUD', value: '-42.50', valueInBaseUnits: -4250 },
        foreignAmount: null,
      },
      roundUp: null,
      cashback: null,
      amount: { currencyCode: 'AUD', value: '-42.50', valueInBaseUnits: -4250 },
      foreignAmount: null,
      cardPurchaseMethod: { method: 'CONTACTLESS', cardNumberSuffix: '4321' },
      settledAt: null,
      createdAt: '2026-09-08T19:04:00+10:00',
      transactionType: 'Purchase',
      note: null,
      performingCustomer: null,
    },
    relationships: {
      account: { data: { type: 'accounts', id: 'acct-dining' } },
      transferAccount: { data: null },
      category: { data: { type: 'categories', id: 'restaurants-and-cafes' } },
      parentCategory: { data: { type: 'categories', id: 'good-life' } },
      tags: { data: [] },
      attachment: { data: null },
    },
  };
}

/** The SAME transaction once it settles, at a slightly different amount. */
function settledTransaction(): UpTransactionResource {
  const held = heldTransaction();
  return {
    ...held,
    attributes: {
      ...held.attributes,
      status: 'SETTLED',
      // Settled for more than held — a tip was added at the counter.
      amount: { currencyCode: 'AUD', value: '-45.00', valueInBaseUnits: -4500 },
      settledAt: '2026-09-09T04:12:00+10:00',
    },
  };
}

describe('account normalisation', () => {
  it('keeps the balance in cents and the Up id as the key', () => {
    const resource: UpAccountResource = {
      type: 'accounts',
      id: 'acct-emergency',
      attributes: {
        displayName: 'Rainy Day',
        accountType: 'SAVER',
        ownershipType: 'INDIVIDUAL',
        balance: { currencyCode: 'AUD', value: '11455.00', valueInBaseUnits: 1_145_500 },
        createdAt: '2024-01-01T00:00:00+11:00',
      },
      relationships: { transactions: {} },
    };

    const account = normaliseAccount(resource);
    expect(account.id).toBe('acct-emergency');
    expect(account.balanceCents).toBe(1_145_500);
    expect(account.displayName).toBe('Rainy Day');
  });
});

describe('transaction normalisation', () => {
  it('reads amounts from valueInBaseUnits rather than parsing the decimal string', () => {
    const held = normaliseTransaction(heldTransaction());
    expect(held.amountCents).toBe(-4250);
    expect(Number.isInteger(held.amountCents)).toBe(true);
  });

  it('marks a transaction with a transferAccount as an internal transfer', () => {
    const resource = heldTransaction();
    resource.relationships.transferAccount = { data: { type: 'accounts', id: 'acct-spending' } };

    const normalised = normaliseTransaction(resource);
    expect(normalised.isInternalTransfer).toBe(true);
    expect(normalised.transferAccountId).toBe('acct-spending');
  });

  it('does not mark an ordinary purchase as an internal transfer', () => {
    expect(normaliseTransaction(heldTransaction()).isInternalTransfer).toBe(false);
  });

  it('keeps the Up category ids for role resolution', () => {
    const normalised = normaliseTransaction(heldTransaction());
    expect(normalised.upCategoryId).toBe('restaurants-and-cafes');
    expect(normalised.upParentCategoryId).toBe('good-life');
  });
});

describe('HELD to SETTLED', () => {
  it('keeps the same id, so an upsert updates in place instead of duplicating', () => {
    const held = normaliseTransaction(heldTransaction());
    const settled = normaliseTransaction(settledTransaction());

    expect(held.id).toBe(settled.id);
    expect(held.id).toBe(TX_ID);
  });

  it('moves the amount to the settled figure and keeps the held one', () => {
    const settled = normaliseTransaction(settledTransaction());

    expect(settled.status).toBe('SETTLED');
    expect(settled.amountCents).toBe(-4500);
    expect(settled.heldAmountCents).toBe(-4250);
    expect(settled.settledAt).toEqual(new Date('2026-09-09T04:12:00+10:00'));
  });

  it('is recognised as a material change, so the sync counts it', () => {
    const held = normaliseTransaction(heldTransaction());
    const settled = normaliseTransaction(settledTransaction());

    const existing = {
      status: held.status,
      amountCents: held.amountCents,
      settledAt: held.settledAt,
      description: held.description,
      upCategoryId: held.upCategoryId,
      deletedAt: null,
    };

    expect(hasMaterialChange(existing, settled)).toBe(true);
    // Re-syncing the identical held transaction is not a change.
    expect(hasMaterialChange(existing, held)).toBe(false);
  });

  it('does not overwrite the app\'s own decisions on re-sync', () => {
    // role, roleSource, payCycleId, isSalary and needsReview are the app's,
    // not Up's. A category I corrected by hand must survive every sync.
    const write = toTransactionWrite(normaliseTransaction(settledTransaction()));
    expect(write).not.toHaveProperty('role');
    expect(write).not.toHaveProperty('roleSource');
    expect(write).not.toHaveProperty('payCycleId');
    expect(write).not.toHaveProperty('isSalary');
    expect(write).not.toHaveProperty('needsReview');
  });

  it('undeletes a transaction that reappears in a sync', () => {
    const write = toTransactionWrite(normaliseTransaction(settledTransaction()));
    expect(write.deletedAt).toBeNull();
  });

  it('treats a delete followed by a create as a genuinely new transaction', () => {
    // Up warns that TRANSACTION_SETTLED occasionally does not fire, and sends
    // a delete plus a create instead. Those carry different ids, so the new
    // one is stored as new rather than merged into the old.
    const replacement = { ...settledTransaction(), id: 'a-different-id' };
    expect(normaliseTransaction(replacement).id).not.toBe(TX_ID);
  });
});

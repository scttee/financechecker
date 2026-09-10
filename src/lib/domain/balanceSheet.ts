/**
 * Balance sheet.
 *
 * Net Financial Assets = cash + investments + super + other − debt.
 * Accessible Financial Assets = the same, minus super — money that could
 * actually be reached without waiting for preservation age. Debt lines are
 * stored positive (amount owed) and subtracted here, never as a negative
 * balance sitting in the sum — that is exactly the kind of thing that gets
 * added instead of subtracted by accident.
 *
 * Ordinary personal belongings are never financial assets by default: this
 * function only ever sees what it is given, and nothing upstream feeds it
 * a car or a bike.
 */

import type { Cents } from '@/lib/money';

export interface AssetLine {
  kind: 'INVESTMENT' | 'SUPER' | 'DEBT' | 'OTHER';
  balanceCents: Cents;
}

export interface BalanceSheet {
  cashCents: Cents;
  investmentsCents: Cents;
  superCents: Cents;
  debtCents: Cents;
  otherCents: Cents;
  netFinancialAssetsCents: Cents;
  accessibleFinancialAssetsCents: Cents;
}

export function calculateBalanceSheet(input: {
  cashCents: Cents;
  assets: readonly AssetLine[];
}): BalanceSheet {
  const { cashCents, assets } = input;

  const sum = (kind: AssetLine['kind']) =>
    assets.filter((a) => a.kind === kind).reduce((acc, a) => acc + a.balanceCents, 0);

  const investmentsCents = sum('INVESTMENT');
  const superCents = sum('SUPER');
  const debtCents = sum('DEBT');
  const otherCents = sum('OTHER');

  const netFinancialAssetsCents = cashCents + investmentsCents + superCents + otherCents - debtCents;
  const accessibleFinancialAssetsCents = cashCents + investmentsCents + otherCents - debtCents;

  return {
    cashCents,
    investmentsCents,
    superCents,
    debtCents,
    otherCents,
    netFinancialAssetsCents,
    accessibleFinancialAssetsCents,
  };
}

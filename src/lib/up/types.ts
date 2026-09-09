/**
 * Up API types.
 *
 * Transcribed from the official OpenAPI specification published by Up at
 * https://github.com/up-banking/api (v1). Every field here exists in that
 * document. No endpoint or field has been invented.
 *
 * Base URL: https://api.up.com.au/api/v1
 * Auth: Bearer <personal access token>
 */

export const UP_BASE_URL = 'https://api.up.com.au/api/v1';

export interface UpMoneyObject {
  currencyCode: string;
  /** Decimal string, e.g. "10.56". Never parsed as a float in this app. */
  value: string;
  /** The amount in cents. This is what we actually use. */
  valueInBaseUnits: number;
}

export type UpAccountType = 'SAVER' | 'TRANSACTIONAL' | 'HOME_LOAN';
export type UpOwnershipType = 'INDIVIDUAL' | 'JOINT';
export type UpTransactionStatus = 'HELD' | 'SETTLED';
export type UpCardPurchaseMethod =
  | 'BAR_CODE'
  | 'OCR'
  | 'CARD_PIN'
  | 'CARD_DETAILS'
  | 'CARD_ON_FILE'
  | 'ECOMMERCE'
  | 'MAGNETIC_STRIPE'
  | 'CONTACTLESS';

export interface UpRelationshipData {
  type: string;
  id: string;
}

export interface UpAccountResource {
  type: 'accounts';
  id: string;
  attributes: {
    displayName: string;
    accountType: UpAccountType;
    ownershipType: UpOwnershipType;
    balance: UpMoneyObject;
    createdAt: string;
  };
  relationships: {
    transactions: { links?: { related: string } };
  };
  links?: { self: string };
}

export interface UpHoldInfoObject {
  amount: UpMoneyObject;
  foreignAmount: UpMoneyObject | null;
}

export interface UpRoundUpObject {
  amount: UpMoneyObject;
  boostPortion: UpMoneyObject | null;
}

export interface UpCashbackObject {
  description: string;
  amount: UpMoneyObject;
}

export interface UpCardPurchaseMethodObject {
  method: UpCardPurchaseMethod;
  cardNumberSuffix: string | null;
}

export interface UpNoteObject {
  text: string;
}

export interface UpCustomerObject {
  displayName: string;
}

export interface UpTransactionResource {
  type: 'transactions';
  id: string;
  attributes: {
    status: UpTransactionStatus;
    rawText: string | null;
    description: string;
    message: string | null;
    isCategorizable: boolean;
    holdInfo: UpHoldInfoObject | null;
    roundUp: UpRoundUpObject | null;
    cashback: UpCashbackObject | null;
    amount: UpMoneyObject;
    foreignAmount: UpMoneyObject | null;
    cardPurchaseMethod: UpCardPurchaseMethodObject | null;
    settledAt: string | null;
    createdAt: string;
    transactionType: string | null;
    note: UpNoteObject | null;
    performingCustomer: UpCustomerObject | null;
  };
  relationships: {
    account: { data: UpRelationshipData; links?: { related: string } };
    /**
     * Present and non-null when this transaction is a transfer between two of
     * my own accounts. This is what makes Saver leakage detection possible.
     */
    transferAccount: { data: UpRelationshipData | null; links?: { related: string } };
    category: { data: UpRelationshipData | null; links?: { self: string; related?: string } };
    parentCategory: { data: UpRelationshipData | null; links?: { related: string } };
    tags: { data: UpRelationshipData[]; links?: { self: string } };
    attachment: { data: UpRelationshipData | null; links?: { related: string } };
  };
  links?: { self: string };
}

export interface UpCategoryResource {
  type: 'categories';
  id: string;
  attributes: { name: string };
  relationships: {
    parent: { data: UpRelationshipData | null; links?: { related: string } };
    children: { data: UpRelationshipData[]; links?: { related: string } };
  };
  links?: { self: string };
}

export interface UpTagResource {
  type: 'tags';
  /** The tag label is the id. */
  id: string;
  relationships: { transactions: { links?: { related: string } } };
}

export interface UpWebhookResource {
  type: 'webhooks';
  id: string;
  attributes: {
    url: string;
    description: string | null;
    /**
     * Returned ONCE, on creation. This is the HMAC key for verifying
     * X-Up-Authenticity-Signature. It goes into the environment, never into
     * the database and never into a log line.
     */
    secretKey?: string;
    createdAt: string;
  };
  relationships: { logs: { links?: { related: string } } };
  links?: { self: string };
}

export type UpWebhookEventType =
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_SETTLED'
  | 'TRANSACTION_DELETED'
  | 'PING';

export interface UpWebhookEventResource {
  type: 'webhook-events';
  /** Constant across delivery retries, which is what makes dedupe possible. */
  id: string;
  attributes: {
    eventType: UpWebhookEventType;
    createdAt: string;
  };
  relationships: {
    webhook: { data: UpRelationshipData; links?: { related: string } };
    transaction?: { data: UpRelationshipData; links?: { related: string } };
  };
}

export interface UpWebhookEventCallback {
  data: UpWebhookEventResource;
}

export interface UpPaginationLinks {
  prev: string | null;
  next: string | null;
}

export interface UpListResponse<T> {
  data: T[];
  links: UpPaginationLinks;
}

export interface UpSingleResponse<T> {
  data: T;
}

export interface UpPingResponse {
  meta: {
    id: string;
    statusEmoji: string;
  };
}

export interface UpErrorObject {
  status: string;
  title: string;
  detail: string;
  source?: { parameter?: string; pointer?: string };
}

export interface UpErrorResponse {
  errors: UpErrorObject[];
}

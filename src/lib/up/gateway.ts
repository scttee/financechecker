/**
 * The bank gateway.
 *
 * One interface, two implementations: the real Up API and the mock bank. The
 * sync service, the setup flow and every screen talk to this and cannot tell
 * which is behind it. That is what makes mock mode a genuine development
 * environment rather than a set of fixtures that drift from reality.
 */

import 'server-only';

import { hasUpToken, upToken, useMockData } from '@/lib/env';
import { UpApiError, UpClient, type TransactionFilters } from './client';
import { generateMockData, generateSimulatedPayday, type MockDataset } from './mock';
import type {
  UpAccountResource,
  UpTagResource,
  UpTransactionResource,
  UpWebhookResource,
} from './types';

export interface BankGateway {
  readonly isMock: boolean;
  ping(): Promise<{ ok: true; customerId: string; emoji: string }>;
  listAccounts(): Promise<UpAccountResource[]>;
  listTransactions(
    filters?: TransactionFilters,
    options?: { maxPages?: number; onPage?: (page: number, count: number) => void },
  ): Promise<{ items: UpTransactionResource[]; pages: number; truncated: boolean }>;
  getTransaction(id: string): Promise<UpTransactionResource>;
  listTags(): Promise<UpTagResource[]>;
  addTags(transactionId: string, tags: readonly string[]): Promise<void>;
  listWebhooks(): Promise<UpWebhookResource[]>;
  createWebhook(url: string, description?: string): Promise<UpWebhookResource>;
  deleteWebhook(id: string): Promise<void>;
  pingWebhook(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real
// ---------------------------------------------------------------------------

class RealGateway implements BankGateway {
  readonly isMock = false;
  private readonly client: UpClient;

  constructor(token: string) {
    this.client = new UpClient({ token });
  }

  async ping() {
    const res = await this.client.ping();
    return { ok: true as const, customerId: res.meta.id, emoji: res.meta.statusEmoji };
  }

  listAccounts() {
    return this.client.listAccounts();
  }

  listTransactions(
    filters: TransactionFilters = {},
    options: { maxPages?: number; onPage?: (page: number, count: number) => void } = {},
  ) {
    return this.client.listTransactions(filters, options);
  }

  getTransaction(id: string) {
    return this.client.getTransaction(id);
  }

  listTags() {
    return this.client.listTags();
  }

  addTags(transactionId: string, tags: readonly string[]) {
    return this.client.addTags(transactionId, tags);
  }

  listWebhooks() {
    return this.client.listWebhooks();
  }

  createWebhook(url: string, description?: string) {
    return this.client.createWebhook(url, description);
  }

  deleteWebhook(id: string) {
    return this.client.deleteWebhook(id);
  }

  pingWebhook(id: string) {
    return this.client.pingWebhook(id);
  }
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

/**
 * The dataset is generated once per hour-long window and cached, so repeated
 * syncs inside a session return identical transaction ids and are therefore
 * idempotent in exactly the way real syncs are.
 */
let cachedDataset: { key: number; data: MockDataset } | null = null;
/** Transactions added by "simulate a payday", kept so re-syncs stay consistent. */
const simulatedExtras: UpTransactionResource[] = [];

function hourKey(now: Date): number {
  return Math.floor(now.getTime() / 3_600_000);
}

function mockDataset(): MockDataset {
  const now = new Date();
  const key = hourKey(now);
  if (!cachedDataset || cachedDataset.key !== key) {
    const anchored = new Date(key * 3_600_000);
    cachedDataset = { key, data: generateMockData({ now: anchored }) };
  }
  const base = cachedDataset.data;
  if (simulatedExtras.length === 0) return base;

  const balances = new Map<string, number>();
  for (const account of base.accounts) {
    balances.set(account.id, account.attributes.balance.valueInBaseUnits);
  }
  for (const tx of simulatedExtras) {
    const id = tx.relationships.account.data.id;
    balances.set(id, (balances.get(id) ?? 0) + tx.attributes.amount.valueInBaseUnits);
  }

  return {
    tags: base.tags,
    accounts: base.accounts.map((a) => ({
      ...a,
      attributes: {
        ...a.attributes,
        balance: {
          currencyCode: 'AUD',
          value: ((balances.get(a.id) ?? 0) / 100).toFixed(2),
          valueInBaseUnits: balances.get(a.id) ?? 0,
        },
      },
    })),
    transactions: [...simulatedExtras, ...base.transactions].sort(
      (a, b) =>
        new Date(b.attributes.createdAt).getTime() - new Date(a.attributes.createdAt).getTime(),
    ),
  };
}

class MockGateway implements BankGateway {
  readonly isMock = true;

  async ping() {
    return { ok: true as const, customerId: 'mock-customer', emoji: '⚡️' };
  }

  async listAccounts() {
    return mockDataset().accounts;
  }

  async listTransactions(
    filters: TransactionFilters = {},
    options: { maxPages?: number; onPage?: (page: number, count: number) => void } = {},
  ) {
    let items = mockDataset().transactions;

    if (filters.since) {
      const since = filters.since.getTime();
      items = items.filter((t) => new Date(t.attributes.createdAt).getTime() >= since);
    }
    if (filters.until) {
      const until = filters.until.getTime();
      items = items.filter((t) => new Date(t.attributes.createdAt).getTime() <= until);
    }
    if (filters.status) {
      items = items.filter((t) => t.attributes.status === filters.status);
    }

    // Report pages the way the real client does, so progress output matches.
    const pageSize = filters.pageSize ?? 100;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    for (let i = 0; i < pages; i += 1) {
      options.onPage?.(i + 1, Math.min(pageSize, items.length - i * pageSize));
    }

    return { items, pages, truncated: false };
  }

  async getTransaction(id: string) {
    const found = mockDataset().transactions.find((t) => t.id === id);
    if (!found) throw new UpApiError('NOT_FOUND', `No mock transaction ${id}`, { status: 404 });
    return found;
  }

  async listTags() {
    return mockDataset().tags;
  }

  async addTags() {
    // Mock mode never writes back to a bank. Nothing to do.
  }

  async listWebhooks(): Promise<UpWebhookResource[]> {
    return [];
  }

  async createWebhook(): Promise<UpWebhookResource> {
    throw new UpApiError(
      'NOT_CONFIGURED',
      'Webhooks cannot be created in mock mode. Set USE_MOCK_DATA=false and add a real token.',
    );
  }

  async deleteWebhook() {
    throw new UpApiError('NOT_CONFIGURED', 'Webhooks are not available in mock mode.');
  }

  async pingWebhook() {
    throw new UpApiError('NOT_CONFIGURED', 'Webhooks are not available in mock mode.');
  }
}

/** Add a simulated payday to the mock feed. Mock mode only. */
export function pushSimulatedPayday(
  input: Parameters<typeof generateSimulatedPayday>[0],
): UpTransactionResource[] {
  const generated = generateSimulatedPayday({
    ...input,
    startingIndex: 900_000 + simulatedExtras.length * 100,
  });
  simulatedExtras.unshift(...generated);
  return generated;
}

export function clearSimulatedPaydays(): void {
  simulatedExtras.length = 0;
}

export function hasSimulatedPaydays(): boolean {
  return simulatedExtras.length > 0;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * The gateway for this environment.
 *
 * Mock mode wins whenever it is on, even if a token happens to be present.
 * That ordering is deliberate: the setting that means "do not touch the real
 * bank" must be the one that decides.
 */
export function getGateway(): BankGateway {
  if (useMockData()) return new MockGateway();

  const token = upToken();
  if (!token) {
    throw new UpApiError(
      'NOT_CONFIGURED',
      'UP_API_TOKEN is not set and USE_MOCK_DATA is not true. Configure one of them.',
    );
  }
  return new RealGateway(token);
}

/** Whether a gateway can be built at all, for the setup screen. */
export function gatewayAvailable(): boolean {
  return useMockData() || hasUpToken();
}

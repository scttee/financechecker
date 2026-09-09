/**
 * Up API client.
 *
 * Server-side only. The token is read from the environment inside this module
 * and never leaves it. It is not returned by any function, not written to the
 * database, and not included in any error message or log line — see
 * `redact()` below, which every error path goes through.
 *
 * Endpoints implemented here all exist in the official Up OpenAPI
 * specification. Nothing has been invented.
 */

import 'server-only';

import {
  UP_BASE_URL,
  type UpAccountResource,
  type UpCategoryResource,
  type UpErrorResponse,
  type UpListResponse,
  type UpPingResponse,
  type UpSingleResponse,
  type UpTagResource,
  type UpTransactionResource,
  type UpTransactionStatus,
  type UpWebhookResource,
} from './types';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type UpErrorKind =
  | 'UNAUTHORISED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NOT_CONFIGURED';

export class UpApiError extends Error {
  readonly kind: UpErrorKind;
  readonly status: number | null;
  readonly detail: string | null;
  /** A sentence safe to show on screen. Never contains the token. */
  readonly userMessage: string;

  constructor(kind: UpErrorKind, message: string, options: { status?: number; detail?: string } = {}) {
    super(redact(message));
    this.name = 'UpApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.detail = options.detail ? redact(options.detail) : null;
    this.userMessage = USER_MESSAGES[kind];
  }
}

const USER_MESSAGES: Record<UpErrorKind, string> = {
  UNAUTHORISED:
    'Up rejected the access token. It may have expired or been revoked. Generate a new one and update UP_API_TOKEN.',
  RATE_LIMITED: 'Up is rate limiting requests right now. The sync will pick up where it left off.',
  NOT_FOUND: 'Up could not find that record. It may have been deleted.',
  BAD_REQUEST: 'Up rejected the request. This is a bug in the app rather than something you did.',
  SERVER_ERROR: 'Up had a problem at their end. Nothing is wrong with your data.',
  NETWORK: 'Could not reach Up. Check the connection and try again.',
  TIMEOUT: 'Up took too long to respond. The sync can be run again safely.',
  NOT_CONFIGURED: 'No Up access token is configured. Add UP_API_TOKEN, or turn on mock mode.',
};

/**
 * Strip anything that looks like an Up token out of a string before it reaches
 * a log, an error message or a screen. Up personal access tokens are prefixed
 * `up:yeah:`; the bearer header is caught as well for belt and braces.
 */
export function redact(text: string): string {
  return text
    .replace(/up:yeah:[A-Za-z0-9_-]+/g, 'up:yeah:[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._:-]+/gi, '$1[redacted]');
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface UpClientOptions {
  token: string;
  baseUrl?: string;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests, so backoff does not make the suite slow. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface TransactionFilters {
  pageSize?: number;
  status?: UpTransactionStatus;
  since?: Date;
  until?: Date;
  category?: string;
  tag?: string;
}

export interface PaginatedFetchOptions {
  /** Stop after this many pages. Guards against an unbounded first import. */
  maxPages?: number;
  /** Called after each page, for progress reporting. */
  onPage?: (pageNumber: number, count: number) => void;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
/** Up's documented page ceiling. */
const MAX_PAGE_SIZE = 100;

export class UpClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: UpClientOptions) {
    if (!options.token) {
      throw new UpApiError('NOT_CONFIGURED', 'No Up token supplied');
    }
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? UP_BASE_URL;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // --- Transport ---------------------------------------------------------

  /**
   * One request, with retries.
   *
   * 429 and 5xx are retried with exponential backoff plus jitter. When Up
   * sends Retry-After we honour it rather than guessing, because their number
   * is better than ours. 4xx other than 429 is never retried: the request is
   * wrong and repeating it will not fix it.
   */
  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    let lastError: UpApiError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
          },
          cache: 'no-store',
        });

        clearTimeout(timer);

        if (response.ok) {
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }

        const detail = await readErrorDetail(response);

        if (response.status === 401 || response.status === 403) {
          throw new UpApiError('UNAUTHORISED', `Up returned ${response.status}`, {
            status: response.status,
            detail,
          });
        }

        if (response.status === 404) {
          throw new UpApiError('NOT_FOUND', 'Up returned 404', { status: 404, detail });
        }

        if (response.status === 429) {
          lastError = new UpApiError('RATE_LIMITED', 'Up returned 429', { status: 429, detail });
          if (attempt < this.maxAttempts) {
            await this.sleepImpl(this.backoffMs(attempt, response.headers));
            continue;
          }
          throw lastError;
        }

        if (response.status >= 500) {
          lastError = new UpApiError('SERVER_ERROR', `Up returned ${response.status}`, {
            status: response.status,
            detail,
          });
          if (attempt < this.maxAttempts) {
            await this.sleepImpl(this.backoffMs(attempt, response.headers));
            continue;
          }
          throw lastError;
        }

        throw new UpApiError('BAD_REQUEST', `Up returned ${response.status}`, {
          status: response.status,
          detail,
        });
      } catch (error) {
        clearTimeout(timer);

        if (error instanceof UpApiError) throw error;

        const isAbort = error instanceof Error && error.name === 'AbortError';
        lastError = isAbort
          ? new UpApiError('TIMEOUT', 'Request to Up timed out')
          : new UpApiError('NETWORK', `Could not reach Up: ${String(error)}`);

        if (attempt < this.maxAttempts) {
          await this.sleepImpl(this.backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new UpApiError('NETWORK', 'Request to Up failed');
  }

  /**
   * Backoff for attempt n: 1s, 2s, 4s, 8s, capped at 30s, plus up to 30%
   * jitter so retries do not line up. A Retry-After header always wins.
   */
  private backoffMs(attempt: number, headers?: Headers): number {
    const retryAfter = headers?.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
      const asDate = Date.parse(retryAfter);
      if (!Number.isNaN(asDate)) return Math.min(Math.max(0, asDate - Date.now()), 60_000);
    }
    const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
    return Math.round(base * (1 + Math.random() * 0.3));
  }

  /** Walk `links.next` until it runs out. */
  private async paginate<T>(
    firstPath: string,
    options: PaginatedFetchOptions = {},
  ): Promise<{ items: T[]; pages: number; truncated: boolean }> {
    const { maxPages = 200, onPage } = options;
    const items: T[] = [];
    let url: string | null = firstPath;
    let pages = 0;

    while (url && pages < maxPages) {
      const page: UpListResponse<T> = await this.request<UpListResponse<T>>(url);
      items.push(...page.data);
      pages += 1;
      onPage?.(pages, page.data.length);
      url = page.links?.next ?? null;
    }

    return { items, pages, truncated: url !== null };
  }

  // --- Endpoints ---------------------------------------------------------

  /** GET /util/ping — confirms the token works. */
  async ping(): Promise<UpPingResponse> {
    return this.request<UpPingResponse>('/util/ping');
  }

  /** GET /accounts */
  async listAccounts(): Promise<UpAccountResource[]> {
    const { items } = await this.paginate<UpAccountResource>(`/accounts?page[size]=${MAX_PAGE_SIZE}`);
    return items;
  }

  /** GET /accounts/{id} */
  async getAccount(id: string): Promise<UpAccountResource> {
    const res = await this.request<UpSingleResponse<UpAccountResource>>(
      `/accounts/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /** GET /transactions */
  async listTransactions(
    filters: TransactionFilters = {},
    options: PaginatedFetchOptions = {},
  ): Promise<{ items: UpTransactionResource[]; pages: number; truncated: boolean }> {
    return this.paginate<UpTransactionResource>(
      `/transactions${buildTransactionQuery(filters)}`,
      options,
    );
  }

  /** GET /accounts/{accountId}/transactions */
  async listAccountTransactions(
    accountId: string,
    filters: TransactionFilters = {},
    options: PaginatedFetchOptions = {},
  ): Promise<{ items: UpTransactionResource[]; pages: number; truncated: boolean }> {
    return this.paginate<UpTransactionResource>(
      `/accounts/${encodeURIComponent(accountId)}/transactions${buildTransactionQuery(filters)}`,
      options,
    );
  }

  /** GET /transactions/{id} */
  async getTransaction(id: string): Promise<UpTransactionResource> {
    const res = await this.request<UpSingleResponse<UpTransactionResource>>(
      `/transactions/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /** GET /categories */
  async listCategories(parent?: string): Promise<UpCategoryResource[]> {
    const query = parent ? `?filter[parent]=${encodeURIComponent(parent)}` : '';
    const res = await this.request<UpListResponse<UpCategoryResource>>(`/categories${query}`);
    return res.data;
  }

  /** GET /tags */
  async listTags(): Promise<UpTagResource[]> {
    const { items } = await this.paginate<UpTagResource>(`/tags?page[size]=${MAX_PAGE_SIZE}`);
    return items;
  }

  /**
   * POST /transactions/{id}/relationships/tags
   *
   * Only ever called when auto-tagging has been explicitly turned on. The
   * default mode is dry run, which never reaches this method.
   */
  async addTags(transactionId: string, tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.request<void>(`/transactions/${encodeURIComponent(transactionId)}/relationships/tags`, {
      method: 'POST',
      body: JSON.stringify({ data: tags.map((id) => ({ type: 'tags', id })) }),
    });
  }

  /** DELETE /transactions/{id}/relationships/tags */
  async removeTags(transactionId: string, tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.request<void>(`/transactions/${encodeURIComponent(transactionId)}/relationships/tags`, {
      method: 'DELETE',
      body: JSON.stringify({ data: tags.map((id) => ({ type: 'tags', id })) }),
    });
  }

  /**
   * PATCH /transactions/{id}/relationships/category
   *
   * Behind an explicit opt-in. Changing Up's own categories without being
   * asked would be rude.
   */
  async setCategory(transactionId: string, categoryId: string | null): Promise<void> {
    await this.request<void>(
      `/transactions/${encodeURIComponent(transactionId)}/relationships/category`,
      {
        method: 'PATCH',
        body: JSON.stringify({ data: categoryId ? { type: 'categories', id: categoryId } : null }),
      },
    );
  }

  /** GET /webhooks */
  async listWebhooks(): Promise<UpWebhookResource[]> {
    const { items } = await this.paginate<UpWebhookResource>(`/webhooks?page[size]=${MAX_PAGE_SIZE}`);
    return items;
  }

  /**
   * POST /webhooks
   *
   * The response carries `secretKey` exactly once. The caller must show it to
   * the user for pasting into UP_WEBHOOK_SECRET and must not persist it.
   */
  async createWebhook(url: string, description?: string): Promise<UpWebhookResource> {
    const res = await this.request<UpSingleResponse<UpWebhookResource>>('/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        data: { attributes: { url, description: description ?? null } },
      }),
    });
    return res.data;
  }

  /** DELETE /webhooks/{id} */
  async deleteWebhook(id: string): Promise<void> {
    await this.request<void>(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** POST /webhooks/{id}/ping */
  async pingWebhook(id: string): Promise<void> {
    await this.request<void>(`/webhooks/${encodeURIComponent(id)}/ping`, { method: 'POST' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTransactionQuery(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  params.set('page[size]', String(Math.min(filters.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)));
  if (filters.status) params.set('filter[status]', filters.status);
  if (filters.since) params.set('filter[since]', filters.since.toISOString());
  if (filters.until) params.set('filter[until]', filters.until.toISOString());
  if (filters.category) params.set('filter[category]', filters.category);
  if (filters.tag) params.set('filter[tag]', filters.tag);
  return `?${params.toString()}`;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as UpErrorResponse;
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return body.errors.map((e) => `${e.title}: ${e.detail}`).join('; ');
    }
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return `HTTP ${response.status}`;
  }
}

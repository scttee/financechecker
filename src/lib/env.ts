/**
 * Environment.
 *
 * This module is server-only and is the single place secrets are read. Nothing
 * here is prefixed NEXT_PUBLIC_, so nothing here can be inlined into a client
 * bundle by Next.js.
 *
 * Validation is lazy and per-concern rather than one big parse at import time,
 * because the app must still boot and explain itself when Up or Notion are not
 * configured yet. A missing Notion token should not take down the dashboard.
 */

import 'server-only';
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  USE_MOCK_DATA: boolish,
  APP_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type BaseEnv = z.infer<typeof baseSchema>;

let cachedBase: BaseEnv | null = null;

export function env(): BaseEnv {
  if (cachedBase) return cachedBase;
  const parsed = baseSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Environment is not valid: ${issues}`);
  }
  cachedBase = parsed.data;
  return cachedBase;
}

/** True when the app should use the built-in mock bank instead of real Up. */
export function useMockData(): boolean {
  return env().USE_MOCK_DATA === true;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * The Up personal access token.
 *
 * Returns null rather than throwing when absent, so the setup flow can say
 * "not configured yet" instead of the app crashing. Callers must never put the
 * return value into a response body, a log, or the database.
 */
export function upToken(): string | null {
  const token = process.env.UP_API_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

/** True when a token is present. Safe to expose to the UI — it is a boolean. */
export function hasUpToken(): boolean {
  return upToken() !== null;
}

export function upWebhookSecret(): string | null {
  const secret = process.env.UP_WEBHOOK_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

export function notionConfig(): { token: string; pageId: string } | null {
  const token = process.env.NOTION_TOKEN?.trim();
  const pageId = process.env.NOTION_PAGE_ID?.trim();
  if (!token || !pageId) return null;
  return { token, pageId };
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Generate one with `npm run gen-secret` and put it in .env',
    );
  }
  return secret;
}

export function appPasswordHash(): string | null {
  const hash = process.env.APP_PASSWORD_HASH?.trim();
  return hash && hash.length > 0 ? hash : null;
}

/**
 * The Claude API key. Returns null rather than throwing when absent, so the
 * AI features can say "not configured" instead of the app crashing — same
 * pattern as the Up token and the Notion config.
 */
export function anthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function hasAnthropicApiKey(): boolean {
  return anthropicApiKey() !== null;
}

/**
 * A summary of what is and is not configured, safe to send to the browser.
 * Booleans only — no secret values, no lengths, no prefixes.
 */
export interface ConfigStatus {
  mockMode: boolean;
  upTokenConfigured: boolean;
  upWebhookSecretConfigured: boolean;
  notionConfigured: boolean;
  authConfigured: boolean;
  aiConfigured: boolean;
}

export function configStatus(): ConfigStatus {
  return {
    mockMode: useMockData(),
    upTokenConfigured: hasUpToken(),
    upWebhookSecretConfigured: upWebhookSecret() !== null,
    notionConfigured: notionConfig() !== null,
    authConfigured: appPasswordHash() !== null,
    aiConfigured: hasAnthropicApiKey(),
  };
}

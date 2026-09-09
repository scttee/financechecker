/**
 * Claude.
 *
 * Two calls only: a short headline for Today, and a short narrative for
 * Review. Both are triggered by a button, never by a sync or a schedule —
 * every call here costs real money, so nothing calls this file on its own.
 *
 * Same house style as the rest of the app, enforced in the system prompts
 * rather than left to chance: calm, flat, factual, never a warning, nothing
 * here is ever "bad" or "overspent". Every figure Claude is given is one this
 * app already trusts and already shows in full elsewhere — this is a second
 * voice reading the same numbers out loud, not a second opinion.
 */

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { anthropicApiKey } from '@/lib/env';

const MODEL = 'claude-opus-5';

export type AiErrorCode = 'NOT_CONFIGURED' | 'AUTH' | 'RATE_LIMIT' | 'BAD_RESPONSE' | 'UNKNOWN';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly userMessage: string;

  constructor(code: AiErrorCode, userMessage: string) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
  }
}

const USER_MESSAGE: Record<AiErrorCode, string> = {
  NOT_CONFIGURED: 'No Claude API key is configured. Add ANTHROPIC_API_KEY to turn this on.',
  AUTH: 'Claude rejected the API key. Check ANTHROPIC_API_KEY is current in the Anthropic console.',
  RATE_LIMIT: 'Claude is rate-limiting this key right now. Try again shortly.',
  BAD_RESPONSE: "Claude's response could not be read. Nothing was saved.",
  UNKNOWN: 'Could not reach Claude.',
};

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const key = anthropicApiKey();
  if (!key) throw new AiError('NOT_CONFIGURED', USER_MESSAGE.NOT_CONFIGURED);
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const TODAY_SYSTEM_PROMPT = `You write the single headline at the top of a personal finance app called Future Scotty, built for one person, from figures that app already trusts.

House style, followed exactly:
- Calm, flat, factual. Never a warning, never scolding, no exclamation marks.
- Discretionary spending (dining, fun, gear) is never described as a failing. Nothing is ever "overspent", "blown" or "bad" — "worth noticing" is as strong as this app gets.
- Second person, present tense, plain English, no jargon, no emoji.
- The headline is one short sentence, specific to what is actually in the JSON below — not generic encouragement, not a restatement of the tier label.
- The detail is at most one further short sentence, adding one concrete fact or number from the JSON that is not already in the headline.
- Never invent a number, a merchant, or a fact. Use only what is in the JSON.

Respond with exactly this JSON shape and nothing else — no markdown fences, no commentary:
{"headline": "...", "detail": "..."}`;

const REVIEW_SYSTEM_PROMPT = `You write a short narrative for the review screen of a personal finance app called Future Scotty, summarising a period of someone's own spending back to them.

House style, followed exactly:
- Calm, flat, factual — a considerate friend describing what happened, not a coach or an auditor.
- Never scold, never call anything overspent, blown, bad, or a mistake. "Worth noticing" is as strong as this app gets.
- Discretionary spending is never a failing.
- Two to four short sentences. Plain English, no jargon, no bullet points, no emoji, no exclamation marks.
- Ground every claim in the numbers and transaction descriptions provided — never invent a figure or a merchant.
- If nothing stands out, say so plainly rather than manufacturing a concern.

Respond with the narrative text only — no headline, no JSON, no markdown.`;

function extractText(response: Anthropic.Message): string {
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new AiError('BAD_RESPONSE', USER_MESSAGE.BAD_RESPONSE);
  return block.text.trim();
}

function parseHeadlineJson(text: string): { headline: string; detail: string } {
  // Claude was told not to fence the JSON, but strip fences defensively —
  // a broken card here is worse than a lenient parse.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AiError('BAD_RESPONSE', USER_MESSAGE.BAD_RESPONSE);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).headline !== 'string' ||
    typeof (parsed as Record<string, unknown>).detail !== 'string'
  ) {
    throw new AiError('BAD_RESPONSE', USER_MESSAGE.BAD_RESPONSE);
  }
  return parsed as { headline: string; detail: string };
}

async function callClaude(system: string, userContent: string, maxTokens: number): Promise<Anthropic.Message> {
  try {
    return await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiError('AUTH', USER_MESSAGE.AUTH);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError('RATE_LIMIT', USER_MESSAGE.RATE_LIMIT);
    }
    throw new AiError('UNKNOWN', USER_MESSAGE.UNKNOWN);
  }
}

export async function generateTodayHeadline(
  context: unknown,
): Promise<{ headline: string; detail: string } & AiUsage> {
  const response = await callClaude(TODAY_SYSTEM_PROMPT, JSON.stringify(context), 500);
  const { headline, detail } = parseHeadlineJson(extractText(response));
  return {
    headline,
    detail,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function generateReviewNarrative(
  context: unknown,
): Promise<{ narrative: string } & AiUsage> {
  const response = await callClaude(REVIEW_SYSTEM_PROMPT, JSON.stringify(context), 700);
  return {
    narrative: extractText(response),
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Opus 5 pricing: $5/MTok in, $25/MTok out. Rough estimate for display only. */
export function estimateCostCents(usage: AiUsage): number {
  return (usage.inputTokens * 5 + usage.outputTokens * 25) / 10_000;
}

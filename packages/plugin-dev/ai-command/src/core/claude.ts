// One non-streaming Messages API call through the host's request() (§ 6.2,
// § 6.6 of the plan). The host enforces the manifest's allowedHosts and the
// http permission; errors reach the plugin as plain messages only.

import { SYSTEM_PROMPT, TOOLS, userMessage } from './prompt';
import type { ModelContext, ToolCall } from './types';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';
// Under the iframe bridge's own 30 s call timeout (plugin-iframe.util.ts), so
// the host request ends first and its error is the one the user sees.
export const TIMEOUT_MS = 25_000;
const MAX_TOKENS = 4096;

export interface ModelOption {
  id: string;
  label: string;
}

export const MODELS: ModelOption[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5: fastest, cheapest' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5: balanced' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5: most careful, slowest' },
];
// shortcut: Sonnet until the eval (§ 10) picks the cheapest model that meets the bar.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export type RequestFn = (
  url: string,
  options: Record<string, unknown>,
) => Promise<unknown>;

export const requestBody = (
  model: string,
  ctx: ModelContext,
  input: { request: string; retryNote?: string },
): Record<string, unknown> => ({
  model,
  max_tokens: MAX_TOKENS,
  output_config: { effort: 'low' },
  system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  tools: TOOLS,
  tool_choice: { type: 'auto' },
  messages: [{ role: 'user', content: userMessage(ctx, input.request, input.retryNote) }],
});

export const requestHeaders = (apiKey: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': API_VERSION,
  // The key is the user's own and stays on their device; the call goes straight to Anthropic.
  'anthropic-dangerous-direct-browser-access': 'true',
});

export interface ModelAnswer {
  calls: ToolCall[];
  /** Plain text the model wrote outside the tools, if any. */
  text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads tool calls from a Messages API response. Throws a user-facing error when it can't be used. */
export const parseAnswer = (response: unknown): ModelAnswer => {
  if (!isRecord(response) || !Array.isArray(response.content)) {
    throw new Error('The AI service sent an answer this plugin cannot read.');
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request. Nothing was changed.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The answer was cut off. Try a smaller request.');
  }
  const blocks = response.content.filter(isRecord);
  return {
    calls: blocks
      .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
      .map((b) => ({ name: b.name as string, input: b.input })),
    text: blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => (b.text as string).trim())
      .filter(Boolean)
      .join(' '),
  };
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'The AI service rejected the request. Check the model in the settings and the credit on your Anthropic account.',
  401: 'The API key was not accepted. Check it in the settings.',
  403: 'This API key may not use this model. Check your Anthropic account.',
  404: 'The model was not found. Pick another one in the settings.',
  429: 'Too many requests or no credit left on your Anthropic account. Try again in a minute.',
  529: 'The AI service is busy. Try again in a minute.',
};

/** A plain sentence for any failure of the call itself. Nothing was changed in every case. */
export const errorMessage = (err: unknown, isOnline: boolean): string => {
  const msg = err instanceof Error ? err.message : String(err);
  const status = Number(/status (\d{3})/.exec(msg)?.[1]);
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return 'The AI service had a problem. Try again in a minute.';
  if (/timed out|timeout/i.test(msg))
    return 'The AI service took too long to answer. Try again.';
  if (!isOnline) return 'You are offline. Nothing was sent.';
  if (/^\[PluginHttp\] request failed/.test(msg)) {
    return 'Could not reach the AI service. Check your connection.';
  }
  return (
    msg.replace(/^\[PluginHttp\]\s*/, '') || 'Something went wrong. Nothing was changed.'
  );
};

/** One call. `request` is the host's PluginAPI.request. */
export const askModel = async (
  request: RequestFn,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<ModelAnswer> =>
  parseAnswer(
    await request(API_URL, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body,
      timeout: TIMEOUT_MS,
    }),
  );

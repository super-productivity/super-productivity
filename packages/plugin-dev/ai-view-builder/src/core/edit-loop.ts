import {
  applyStep,
  finalizeSpec,
  findDanglingRefs,
  isReadOnlySpec,
  StepResult,
  ViewSpec,
} from './spec';
import { buildUserText, SYSTEM_PROMPT, TOOLS } from './prompt';

// One request = one edit: stream the model's tool calls, apply each one to a
// working copy as soon as it is complete, answer them, and repeat for a few
// rounds if the model wants to fix something. The caller saves the result once.
//
// Raw HTTP: the plugin runs without a module loader for the SDK, and fetch is
// injected so tests and the eval harness can drive the same loop.

export const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ModelChoice {
  id: string;
  label: string;
  hasFallback: boolean;
}

export const MODELS: ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best results)', hasFallback: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)', hasFallback: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)', hasFallback: false },
];
export const DEFAULT_MODEL = MODELS[0].id;

export type Effort = 'low' | 'medium' | 'high';

export interface StepEvent {
  name: string;
  input: unknown;
  result: StepResult;
  spec: ViewSpec;
}

export interface EditOptions {
  fetchFn: typeof fetch;
  apiKey: string;
  model: string;
  /** Defaults: low for a change, medium for a new view. */
  effort?: Effort;
  spec: ViewSpec;
  selectedId?: string | null;
  request: string;
  signal?: AbortSignal;
  onStep?: (event: StepEvent) => void;
  maxRounds?: number;
  now?: () => number;
}

export interface EditResult {
  spec: ViewSpec;
  say: string | null;
  text: string;
  steps: number;
  rejectedSteps: number;
  rounds: number;
  firstStepMs: number | null;
  totalMs: number;
}

export class EditError extends Error {}

type Block = Record<string, unknown> & { type: string };

// ---------- SSE ----------

/** Server-sent events: blank-line separated blocks of `event:` / `data:` lines. */
export const createSseParser = (
  onEvent: (event: Record<string, unknown>) => void,
): { push: (chunk: string) => void; end: () => void } => {
  let buffer = '';
  const flush = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    try {
      onEvent(JSON.parse(data));
    } catch {
      // A malformed event is skipped; the stream's end decides the outcome.
    }
  };
  return {
    push: (chunk) => {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        flush(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    end: () => {
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
  };
};

/**
 * Rebuilds the assistant message's content blocks from stream events, so they
 * can be sent back unchanged (thinking blocks included), and reports each
 * tool_use block once its input is complete.
 */
export const createMessageAssembler = (
  onToolUse: (block: Block) => void,
): {
  onEvent: (event: Record<string, unknown>) => void;
  blocks: Block[];
  state: { stopReason: string | null; error: string | null };
} => {
  const blocks: Block[] = [];
  const partialJson = new Map<number, string>();
  const state = { stopReason: null as string | null, error: null as string | null };
  const onEvent = (event: Record<string, unknown>): void => {
    const index = typeof event.index === 'number' ? event.index : -1;
    switch (event.type) {
      case 'content_block_start': {
        const block = { ...(event.content_block as Block) };
        blocks[index] = block;
        if (block.type === 'tool_use') partialJson.set(index, '');
        break;
      }
      case 'content_block_delta': {
        const block = blocks[index];
        const delta = event.delta as Record<string, unknown>;
        if (!block || !delta) break;
        if (delta.type === 'text_delta') {
          block.text = String(block.text ?? '') + String(delta.text ?? '');
        } else if (delta.type === 'thinking_delta') {
          block.thinking = String(block.thinking ?? '') + String(delta.thinking ?? '');
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature;
        } else if (delta.type === 'input_json_delta') {
          partialJson.set(
            index,
            (partialJson.get(index) ?? '') + String(delta.partial_json ?? ''),
          );
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks[index];
        if (block?.type === 'tool_use') {
          const json = partialJson.get(index) ?? '';
          try {
            block.input = json ? JSON.parse(json) : {};
          } catch {
            block.input = { __invalidJson: json.slice(0, 200) };
          }
          onToolUse(block);
        }
        break;
      }
      case 'message_delta': {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason) state.stopReason = String(delta.stop_reason);
        break;
      }
      case 'error': {
        const err = event.error as Record<string, unknown> | undefined;
        state.error = String(err?.message ?? 'The API reported an error');
        break;
      }
    }
  };
  return { onEvent, blocks, state };
};

// ---------- request ----------

export const describeApiError = (status: number, bodyText: string): string => {
  let message = '';
  try {
    message = JSON.parse(bodyText)?.error?.message ?? '';
  } catch {
    message = '';
  }
  if (status === 401) return 'The API key was rejected. Check it in Settings.';
  if (status === 403)
    return `This API key cannot use the selected model. ${message}`.trim();
  if (status === 429) return 'Rate limited by the API. Wait a moment and try again.';
  if (status >= 500) return 'The API is overloaded or unavailable. Try again shortly.';
  return message || `The API request failed (HTTP ${status}).`;
};

export const buildRequest = (
  opts: Pick<EditOptions, 'apiKey' | 'model' | 'effort' | 'spec'>,
  messages: unknown[],
): { headers: Record<string, string>; body: Record<string, unknown> } => {
  const model = MODELS.find((m) => m.id === opts.model) ?? MODELS[0];
  const isNewView = !opts.spec.root;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': opts.apiKey,
    'anthropic-version': API_VERSION,
    // Required for CORS. The key is the user's own and stays on their device.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body: Record<string, unknown> = {
    model: model.id,
    max_tokens: 16000,
    stream: true,
    output_config: { effort: opts.effort ?? (isNewView ? 'medium' : 'low') },
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (model.hasFallback) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { headers, body };
};

// ---------- loop ----------

const readStream = async (
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> => {
  const parser = createSseParser(onEvent);
  if (!response.body) {
    parser.push(await response.text());
    parser.end();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
};

export const runEdit = async (opts: EditOptions): Promise<EditResult> => {
  if (isReadOnlySpec(opts.spec)) {
    throw new EditError(
      'This view was made by a newer version of the plugin. Update to change it.',
    );
  }
  const now = opts.now ?? Date.now;
  const started = now();
  const maxRounds = opts.maxRounds ?? 4;
  let spec = opts.spec;
  let say: string | null = null;
  let text = '';
  let steps = 0;
  let rejectedSteps = 0;
  let firstStepMs: number | null = null;
  let rounds = 0;
  const messages: unknown[] = [
    {
      role: 'user',
      content: buildUserText(opts.spec, opts.request, opts.selectedId ?? null),
    },
  ];

  while (rounds < maxRounds) {
    rounds++;
    const toolResults: {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[] = [];
    let roundHadError = false;
    let roundSaid = false;
    const assembler = createMessageAssembler((block) => {
      const name = String(block.name);
      const result = applyStep(spec, name, block.input);
      steps++;
      if (firstStepMs === null && name !== 'say') firstStepMs = now() - started;
      if (result.error) {
        rejectedSteps++;
        roundHadError = true;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: String(block.id),
          content: result.error,
          is_error: true,
        });
      } else {
        spec = result.spec;
        if (result.say) {
          say = result.say;
          roundSaid = true;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: String(block.id),
          content: 'ok',
        });
      }
      opts.onStep?.({ name, input: block.input, result, spec });
    });

    const { headers, body } = buildRequest(opts, messages);
    const response = await opts.fetchFn(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!response.ok) {
      throw new EditError(describeApiError(response.status, await response.text()));
    }
    await readStream(response, assembler.onEvent);

    const { stopReason, error } = assembler.state;
    if (error) throw new EditError(error);
    if (stopReason === 'refusal') {
      throw new EditError('Claude declined this request. Try describing it differently.');
    }
    if (stopReason === 'max_tokens') {
      throw new EditError('The answer got too long. Try a smaller change.');
    }
    for (const block of assembler.blocks) {
      if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
    }
    const usedTools = toolResults.length > 0;
    // Checked per round, not per call: a later call in the same batch often
    // defines what an earlier one referred to.
    const dangling = findDanglingRefs(spec);
    const isClean = !roundHadError && dangling.length === 0;
    // Done when the model stopped on its own, or said its sentence with nothing to fix.
    if (stopReason !== 'tool_use' || !usedTools || (roundSaid && isClean)) {
      break;
    }
    if (dangling.length) {
      const last = toolResults[toolResults.length - 1];
      last.content += `\nThe view still refers to missing parts: ${dangling.join('; ')}.`;
    }
    messages.push({ role: 'assistant', content: assembler.blocks.filter(Boolean) });
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    spec: finalizeSpec(spec),
    say,
    text: text.trim(),
    steps,
    rejectedSteps,
    rounds,
    firstStepMs,
    totalMs: now() - started,
  };
};

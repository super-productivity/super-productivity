// One request end to end, shared by the panel and the eval: build the
// context, call the model, validate, and retry once on a schema failure.

import { askModel, requestBody, type ModelAnswer, type RequestFn } from './claude';
import { buildContext } from './context';
import { validateCalls } from './validate';
import type { Context, Proposal, Snapshot } from './types';

export interface AskDeps {
  request: RequestFn;
  apiKey: string;
  model: string;
}

export interface AskResult {
  ctx: Context;
  proposal: Proposal;
  /** Model calls made: 1, or 2 after a retry. */
  calls: number;
}

const NO_ANSWER = 'There were no tool calls and no text.';
const UNREADABLE = 'Part of the answer could not be read and was left out.';

const isEmpty = (a: ModelAnswer): boolean => !a.calls.length && !a.text;

const withText = (proposal: Proposal, answer: ModelAnswer): Proposal =>
  // Plain text without tools is a sentence to the user, like say.
  proposal.say || !answer.text ? proposal : { ...proposal, say: answer.text };

export const ask = async (
  deps: AskDeps,
  snapshot: Snapshot,
  request: string,
): Promise<AskResult> => {
  const ctx = buildContext(snapshot, request);
  const call = (retryNote?: string): Promise<ModelAnswer> =>
    askModel(
      deps.request,
      deps.apiKey,
      requestBody(deps.model, ctx.sent, { request, retryNote }),
    );
  let answer = await call();
  let result = validateCalls(ctx, answer.calls);
  const problems = isEmpty(answer) ? [NO_ANSWER] : result.errors;
  if (!problems.length)
    return { ctx, proposal: withText(result.proposal, answer), calls: 1 };
  answer = await call(problems.join(' '));
  result = validateCalls(ctx, answer.calls);
  const proposal = withText(result.proposal, answer);
  if (result.errors.length) proposal.dropped = [...proposal.dropped, UNREADABLE];
  return { ctx, proposal, calls: 2 };
};

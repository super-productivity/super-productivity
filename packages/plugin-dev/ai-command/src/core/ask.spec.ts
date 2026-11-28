import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask } from './ask';
import { snapshot } from './test-fixtures';

const answers = (...list: unknown[][]) => {
  const bodies: Record<string, unknown>[] = [];
  const request = async (
    _url: string,
    options: Record<string, unknown>,
  ): Promise<unknown> => {
    bodies.push(options.body as Record<string, unknown>);
    return { stop_reason: 'tool_use', content: list[bodies.length - 1] };
  };
  return { deps: { request, apiKey: 'k', model: 'm' }, bodies };
};
const use = (name: string, input: unknown) => ({ type: 'tool_use', name, input });
const lastUserText = (body: Record<string, unknown>): string =>
  (body.messages as { content: string }[])[0].content;

test('one call when the answer is valid', async () => {
  const { deps, bodies } = answers([use('add_task', { ref: 'n1', title: 'Milk' })]);
  const result = await ask(deps, snapshot([]), 'add milk');
  assert.equal(result.calls, 1);
  assert.equal(result.proposal.changes.length, 1);
  assert.equal(bodies.length, 1);
});

test('retries once with the schema errors, then shows what is valid', async () => {
  const { deps, bodies } = answers(
    [use('add_task', { title: 'no ref' })],
    [use('add_task', { ref: 'n1', title: 'Milk' }), use('add_task', { bad: 1 })],
  );
  const result = await ask(deps, snapshot([]), 'add milk');
  assert.equal(result.calls, 2);
  assert.match(lastUserText(bodies[1]), /ref is missing/);
  assert.equal(result.proposal.changes.length, 1);
  assert.match(result.proposal.dropped.join(), /could not be read/);
});

test('plain text becomes the sentence; an empty answer is retried', async () => {
  const text = answers([{ type: 'text', text: 'Nothing matches.' }]);
  assert.equal(
    (await ask(text.deps, snapshot([]), 'x')).proposal.say,
    'Nothing matches.',
  );
  const empty = answers([], [use('say', { text: 'Ok.' })]);
  const result = await ask(empty.deps, snapshot([]), 'x');
  assert.equal(result.calls, 2);
  assert.equal(result.proposal.say, 'Ok.');
});

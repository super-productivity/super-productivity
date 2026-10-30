import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMessageAssembler,
  createSseParser,
  EditError,
  runEdit,
  StepEvent,
} from './edit-loop';
import { emptySpec } from './spec';

// A recorded-style stream: thinking, then tool calls whose JSON arrives in pieces.
type ToolCall = { id: string; name: string; input: unknown };

const sse = (events: Record<string, unknown>[]): string =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

const turn = (calls: ToolCall[], stopReason = 'tool_use', text?: string): string => {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { id: 'msg', role: 'assistant', content: [] } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'plan' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig' },
    },
    { type: 'content_block_stop', index: 0 },
  ];
  let index = 1;
  if (text) {
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index },
    );
    index++;
  }
  for (const call of calls) {
    const json = JSON.stringify(call.input);
    events.push({
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
    });
    for (let i = 0; i < json.length; i += 7) {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 7) },
      });
    }
    events.push({ type: 'content_block_stop', index });
    index++;
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: stopReason } },
    { type: 'message_stop' },
  );
  return sse(events);
};

const fakeFetch = (bodies: string[], requests: Record<string, unknown>[]): typeof fetch =>
  (async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const body = bodies.shift();
    if (body === undefined) throw new Error('unexpected request');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

const SAY: ToolCall = { id: 's1', name: 'say', input: { text: 'Done.' } };

const BOARD_STEPS: ToolCall[] = [
  { id: 't1', name: 'put_query', input: { id: 'open', props: { scope: '@current' } } },
  {
    id: 't2',
    name: 'put_component',
    input: {
      id: 'board',
      props: {
        type: 'board',
        query: 'open',
        columns: [
          { id: 'todo', title: 'To do', notTags: ['Doing'] },
          { id: 'doing', title: 'Doing', tags: ['Doing'] },
        ],
      },
    },
  },
  { id: 't3', name: 'say', input: { text: 'Made a board.' } },
];

test('the SSE parser handles events split across chunks and CRLF', () => {
  const seen: unknown[] = [];
  const parser = createSseParser((e) => seen.push(e));
  const stream = 'event: a\r\ndata: {"n":1}\r\n\r\nevent: b\ndata: {"n":2}\n\n';
  for (const ch of stream) parser.push(ch);
  parser.end();
  assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
});

test('the assembler keeps thinking blocks intact for the next round', () => {
  const tools: unknown[] = [];
  const asm = createMessageAssembler((b) => tools.push(b));
  createSseParser(asm.onEvent).push(turn([BOARD_STEPS[0]]));
  assert.deepEqual(asm.blocks[0], {
    type: 'thinking',
    thinking: 'plan',
    signature: 'sig',
  });
  assert.deepEqual(tools, [
    {
      type: 'tool_use',
      id: 't1',
      name: 'put_query',
      input: { id: 'open', props: { scope: '@current' } },
    },
  ]);
  assert.equal(asm.state.stopReason, 'tool_use');
});

test('steps apply one by one as they stream, and say ends the edit', async () => {
  const requests: Record<string, unknown>[] = [];
  const seen: StepEvent[] = [];
  const result = await runEdit({
    fetchFn: fakeFetch([turn(BOARD_STEPS)], requests),
    apiKey: 'k',
    model: 'claude-opus-5-5',
    spec: emptySpec(),
    request: 'A kanban board',
    onStep: (e) => seen.push(e),
  });
  assert.deepEqual(
    seen.map((e) => e.name),
    ['put_query', 'put_component', 'say'],
  );
  // After the first step the board is not there yet; after the second it is.
  assert.equal(seen[0].spec.root, null);
  assert.equal(seen[1].spec.root, 'board');
  assert.equal(result.say, 'Made a board.');
  assert.equal(result.rounds, 1);
  assert.equal(requests.length, 1);
  assert.equal((requests[0].output_config as { effort: string }).effort, 'medium');
});

test('a rejected step goes back to the model, which fixes it in the next round', async () => {
  const requests: Record<string, unknown>[] = [];
  const bad: ToolCall = {
    id: 'x1',
    name: 'put_query',
    input: { id: 'open', props: { due: 'soon' } },
  };
  const fixed: ToolCall = {
    id: 'x2',
    name: 'put_query',
    input: { id: 'open', props: { due: 'today' } },
  };
  const say: ToolCall = { id: 'x3', name: 'say', input: { text: 'Fixed.' } };
  const result = await runEdit({
    fetchFn: fakeFetch([turn([bad]), turn([fixed, say])], requests),
    apiKey: 'k',
    model: 'claude-sonnet-5-5',
    spec: emptySpec(),
    request: 'due today',
  });
  assert.equal(result.rejectedSteps, 1);
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.spec.queries.open, { due: 'today' });
  const second = requests[1].messages as { role: string; content: unknown }[];
  // Assistant turn sent back unchanged (thinking first), then the tool error.
  assert.equal((second[1].content as { type: string }[])[0].type, 'thinking');
  const results = second[2].content as {
    tool_use_id: string;
    is_error?: boolean;
    content: string;
  }[];
  assert.equal(results[0].tool_use_id, 'x1');
  assert.equal(results[0].is_error, true);
  assert.match(results[0].content, /due must be one of/);
});

test('changing an existing view uses low effort and sends the spec, never task data', async () => {
  const requests: Record<string, unknown>[] = [];
  const base = {
    ...emptySpec('Mine'),
    root: 'x',
    components: { x: { type: 'text', text: 'Hi' } },
  };
  await runEdit({
    fetchFn: fakeFetch(
      [turn([{ id: 's', name: 'say', input: { text: 'ok' } }], 'end_turn')],
      requests,
    ),
    apiKey: 'k',
    model: 'claude-haiku-5-5',
    spec: base,
    selectedId: 'x',
    request: 'make it bigger',
  });
  const body = requests[0];
  assert.equal((body.output_config as { effort: string }).effort, 'low');
  assert.equal('fallbacks' in body, false);
  const user = (body.messages as { content: string }[])[0].content;
  assert.match(user, /<current_view>\n\{"specVersion":1/);
  assert.match(user, /<selected_component>x<\/selected_component>/);
  assert.match(user, /<request>\nmake it bigger\n<\/request>/);
  for (const field of ['temperature', 'top_p', 'top_k']) {
    assert.equal(field in body, false);
  }
});

test('refusals and HTTP errors surface as readable errors', async () => {
  await assert.rejects(
    runEdit({
      fetchFn: fakeFetch([turn([], 'refusal')], []),
      apiKey: 'k',
      model: 'claude-opus-5-5',
      spec: emptySpec(),
      request: 'x',
    }),
    (e: Error) => e instanceof EditError && /declined/.test(e.message),
  );
  const unauthorized = (async () =>
    new Response('{"error":{"message":"bad key"}}', {
      status: 401,
    })) as unknown as typeof fetch;
  await assert.rejects(
    runEdit({
      fetchFn: unauthorized,
      apiKey: 'k',
      model: 'claude-opus-5-5',
      spec: emptySpec(),
      request: 'x',
    }),
    /API key was rejected/,
  );
});

test('a newer view cannot be edited by this version', async () => {
  await assert.rejects(
    runEdit({
      fetchFn: fakeFetch([], []),
      apiKey: 'k',
      model: 'claude-opus-5-5',
      spec: { ...emptySpec(), specVersion: 99 },
      request: 'x',
    }),
    /newer version/,
  );
});

test('a recipe call builds the whole view and answers with the ids it made', async () => {
  const requests: Record<string, unknown>[] = [];
  const recipe: ToolCall = { id: 'r1', name: 'use_recipe', input: { name: 'kanban' } };
  const tweak: ToolCall = {
    id: 'r2',
    name: 'put_component',
    input: { id: 'board', props: { columnsPerRow: 2 } },
  };
  const result = await runEdit({
    fetchFn: fakeFetch([turn([recipe]), turn([tweak, SAY])], requests),
    apiKey: 'k',
    model: 'claude-sonnet-5-5',
    spec: emptySpec(),
    request: 'A kanban board in a grid',
  });
  assert.equal(result.rejectedSteps, 0);
  assert.equal(result.rounds, 2);
  assert.equal(result.spec.components.board.columnsPerRow, 2);
  assert.equal(result.spec.title, 'Kanban board');
  const second = requests[1].messages as { content: { content?: string }[] }[];
  assert.match(second[2].content[0].content ?? '', /^ok\. .*board \(board\)/);
});

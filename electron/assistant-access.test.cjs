const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');
const http = require('node:http');

// Built .js siblings must never shadow the sources being tested.
require('ts-node').register({ transpileOnly: true, preferTsExts: true });

test('the HTTP harness loads current TypeScript even after an Electron build', () => {
  for (const dependency of [
    'simple-store',
    'secure-file',
    'mcp/assistant-access',
    'mcp/mcp-http',
    'mcp/mcp-tools',
    'mcp/mcp-tool-kit',
    'mcp/mcp-protocol',
  ]) {
    assert.equal(path.extname(require.resolve(`./${dependency}`)), '.ts');
  }
});

// Pure modules first: the protocol core and the tool layer need no Electron.
const protocol = require('./mcp/mcp-protocol.ts');
const tools = require('./mcp/mcp-tools.ts');

const noTools = {
  serverVersion: '1.2.3',
  listTools: () => [],
  hasTool: () => false,
  callTool: async () => {
    throw new Error('not reachable');
  },
};

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

// --- protocol ------------------------------------------------------------------

test('initialize echoes a supported version and advertises tools only', async () => {
  const reply = await protocol.handleMcpMessage(
    rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} }),
    {},
    noTools,
  );
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.result, {
    protocolVersion: '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: {
      name: 'super-productivity',
      title: 'Super Productivity',
      version: '1.2.3',
      websiteUrl: 'https://super-productivity.com',
    },
  });
});

test('initialize answers the latest version for one it does not speak', async () => {
  const reply = await protocol.handleMcpMessage(
    rpc('initialize', { protocolVersion: '2099-01-01' }),
    {},
    noTools,
  );
  assert.equal(reply.body.result.protocolVersion, '2025-11-25');
});

test('notifications and responses get an empty 202', async () => {
  const notification = { jsonrpc: '2.0', method: 'notifications/initialized' };
  assert.deepEqual(await protocol.handleMcpMessage(notification, {}, noTools), {
    status: 202,
  });
  const response = { jsonrpc: '2.0', id: 5, result: {} };
  assert.deepEqual(await protocol.handleMcpMessage(response, {}, noTools), {
    status: 202,
  });
});

test('batches and malformed messages are rejected', async () => {
  const batch = await protocol.handleMcpMessage([rpc('ping')], {}, noTools);
  assert.equal(batch.status, 400);
  assert.equal(batch.body.error.code, protocol.INVALID_REQUEST);

  const noVersion = await protocol.handleMcpMessage(
    { id: 1, method: 'ping' },
    {},
    noTools,
  );
  assert.equal(noVersion.status, 400);

  const badId = await protocol.handleMcpMessage(
    { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' },
    {},
    noTools,
  );
  assert.equal(badId.status, 400);
});

// A 2026-07-28 client probes with a modern request and falls back to
// `initialize` on a 400 that is not a recognised modern error. Emitting a
// modern-only code would make it retry instead, so assert neither appears.
test('modern-era requests get a plain 400 so dual-era clients fall back', async () => {
  const discover = await protocol.handleMcpMessage(rpc('server/discover'), {}, noTools);
  const withMeta = await protocol.handleMcpMessage(
    rpc('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    }),
    {},
    noTools,
  );
  const withHeader = await protocol.handleMcpMessage(
    rpc('tools/list'),
    { mcpMethod: 'tools/list' },
    noTools,
  );
  for (const reply of [discover, withMeta, withHeader]) {
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error.code, protocol.INVALID_REQUEST);
    assert.ok(![-32020, -32022].includes(reply.body.error.code));
  }
});

test('ids are echoed exactly and unknown methods are JSON-RPC errors', async () => {
  const ping = await protocol.handleMcpMessage(
    rpc('ping', undefined, 'abc'),
    {},
    noTools,
  );
  assert.deepEqual(ping.body, { jsonrpc: '2.0', id: 'abc', result: {} });

  const unknown = await protocol.handleMcpMessage(
    rpc('resources/list', {}, 7),
    {},
    noTools,
  );
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.id, 7);
  assert.equal(unknown.body.error.code, protocol.METHOD_NOT_FOUND);
});

test('a tool that is not granted is indistinguishable from one that does not exist', async () => {
  const reply = await protocol.handleMcpMessage(
    rpc('tools/call', { name: 'list_tasks', arguments: {} }),
    {},
    noTools,
  );
  assert.equal(reply.body.error.code, protocol.INVALID_PARAMS);
  assert.equal(reply.body.error.message, 'Unknown tool');
});

test('the protocol header may be absent but must be supported when present', () => {
  assert.equal(protocol.isAcceptedProtocolHeader(undefined), true);
  assert.equal(protocol.isAcceptedProtocolHeader('2025-03-26'), true);
  assert.equal(protocol.isAcceptedProtocolHeader('2026-07-28'), false);
});

// --- tools -----------------------------------------------------------------------

const TASKS = [
  {
    id: 't1',
    title: 'Write report',
    notes: 'SECRET NOTES',
    isDone: false,
    projectId: 'p1',
    tagIds: ['tg1'],
    subTaskIds: ['t2'],
    timeSpentOnDay: { '2026-09-22': 1000 },
    attachments: [{ id: 'a' }],
    issueId: 'JIRA-1',
  },
  { id: 't2', title: 'Sub', notes: '', isDone: true, parentId: 't1', tagIds: [] },
];

const fakeForward = (overrides = {}) => {
  const calls = [];
  const forward = async (request) => {
    calls.push(request);
    if (overrides[request.path]) {
      return overrides[request.path](request);
    }
    if (request.path === '/tasks') {
      return { status: 200, body: { ok: true, data: TASKS } };
    }
    if (request.path === '/tasks/t1') {
      return { status: 200, body: { ok: true, data: TASKS[0] } };
    }
    return {
      status: 404,
      body: {
        ok: false,
        error: { code: 'TASK_NOT_FOUND', message: 'echo: ' + request.path },
      },
    };
  };
  return { forward, calls };
};

const READ = ['tasks:read'];
const READ_TOOLS = [
  'get_status',
  'list_tasks',
  'get_task',
  'list_projects',
  'list_tags',
  'get_current_task',
  'get_focus',
  'list_repeat_configs',
  'get_repeat_config',
];
const ALL_SCOPES = [
  'tasks:read',
  'tasks:read_notes',
  'tasks:read_archive',
  'tasks:capture',
  'tasks:edit',
  'tasks:delete',
  'notes:read',
  'notes:edit',
  'counters:read',
  'counters:edit',
];

test('only granted tools are listed', () => {
  const names = (scopes) => tools.listGrantedTools(scopes).map((t) => t.name);
  assert.deepEqual(names([]), ['get_status']);
  assert.deepEqual(names(['tasks:capture']), ['get_status', 'create_task']);
  assert.deepEqual(names(READ), READ_TOOLS);
  assert.deepEqual(names([...READ, 'tasks:edit']), [
    ...READ_TOOLS,
    'update_task',
    'add_subtask',
    'start_task',
    'stop_tracking',
    'log_time',
    'archive_task',
    'restore_task',
    'create_repeat_config',
    'update_repeat_config',
  ]);
  assert.deepEqual(names(['tasks:delete']), [
    'get_status',
    'delete_task',
    'delete_repeat_config',
  ]);
  assert.deepEqual(names(['notes:read', 'notes:edit', 'counters:read', 'counters:edit']), [
    'get_status',
    'list_notes',
    'get_note',
    'create_note',
    'update_note',
    'delete_note',
    'list_counters',
    'get_counter',
    'set_counter',
    'increment_counter',
  ]);
  for (const tool of tools.listGrantedTools(ALL_SCOPES)) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('every tool has a title and explicit behaviour hints', () => {
  const all = tools.listGrantedTools(ALL_SCOPES);
  for (const tool of all) {
    assert.ok(tool.title, `${tool.name} needs a title`);
    assert.equal(tool.annotations.title, tool.title);
    for (const hint of [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ]) {
      assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name}.${hint}`);
    }
    assert.equal(tool.annotations.openWorldHint, false);
    if (tool.annotations.readOnlyHint) {
      assert.equal(tool.annotations.destructiveHint, false);
    }
  }
  const readOnly = all.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(readOnly, [
    ...READ_TOOLS,
    'list_notes',
    'get_note',
    'list_counters',
    'get_counter',
  ]);
  const capture = all.find((t) => t.name === 'create_task');
  assert.equal(capture.annotations.destructiveHint, false);
  assert.equal(capture.annotations.idempotentHint, false);
  // Only what removes something is destructive, and every delete is.
  const destructive = all.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
  assert.deepEqual(destructive, ['delete_task', 'delete_repeat_config', 'delete_note']);
});

test('list_tasks returns summaries only and forwards filters', async () => {
  const { forward, calls } = fakeForward();
  const result = await tools.runTool(
    'list_tasks',
    { query: 'report', tagId: 'TODAY', limit: 1 },
    () => READ,
    forward,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    tasks: [
      {
        id: 't1',
        title: 'Write report',
        isDone: false,
        projectId: 'p1',
        tagIds: ['tg1'],
      },
    ],
    truncated: true,
  });
  assert.doesNotMatch(result.content[0].text, /SECRET|JIRA|attachments/);
  assert.deepEqual(calls[0].query, {
    source: 'active',
    includeDone: 'false',
    query: 'report',
    tagId: 'TODAY',
  });
});

test('arguments are validated strictly', async () => {
  const { forward, calls } = fakeForward();
  const unknownArg = await tools.runTool('list_tasks', { foo: 1 }, () => READ, forward);
  assert.equal(unknownArg.isError, true);
  const badLimit = await tools.runTool('list_tasks', { limit: 101 }, () => READ, forward);
  assert.equal(badLimit.isError, true);
  const badId = await tools.runTool('get_task', { id: '../status' }, () => READ, forward);
  assert.equal(badId.isError, true);
  assert.equal(calls.length, 0, 'nothing invalid may reach the renderer');
});

test('get_task only returns notes with the notes scope', async () => {
  const { forward } = fakeForward();
  const denied = await tools.runTool(
    'get_task',
    { id: 't1', includeNotes: true },
    () => READ,
    forward,
  );
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /^NOTES_NOT_PERMITTED/);

  const withoutNotes = await tools.runTool('get_task', { id: 't1' }, () => READ, forward);
  assert.equal(withoutNotes.structuredContent.task.notes, undefined);
  assert.deepEqual(withoutNotes.structuredContent.task.subTaskIds, ['t2']);

  const withNotes = await tools.runTool(
    'get_task',
    { id: 't1', includeNotes: true },
    () => [...READ, 'tasks:read_notes'],
    forward,
  );
  assert.equal(withNotes.structuredContent.task.notes, 'SECRET NOTES');
  assert.equal(withNotes.structuredContent.task.notesTruncated, false);
});

test('get_task asks the renderer to hide tasks of archived projects', async () => {
  // The renderer answers TASK_NOT_FOUND for those, as list_tasks leaves them out.
  const { forward, calls } = fakeForward();
  await tools.runTool('get_task', { id: 't1' }, () => READ, forward);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].query, { source: 'active' });
});

test('renderer errors never leak their message', async () => {
  const { forward } = fakeForward();
  const result = await tools.runTool('get_task', { id: 'missing' }, () => READ, forward);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^TASK_NOT_FOUND/);
  assert.doesNotMatch(result.content[0].text, /echo/);
});

test('a scope revoked before the call runs is honoured', async () => {
  const { forward, calls } = fakeForward();
  const result = await tools.runTool('list_tasks', {}, () => [], forward);
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test('a grant revoked while the renderer answers is honoured', async () => {
  let scopes = [...READ, 'tasks:read_notes'];
  const revokingForward = async (request) => {
    const reply = await fakeForward().forward(request);
    scopes = ['tasks:read'];
    return reply;
  };
  const notes = await tools.runTool(
    'get_task',
    { id: 't1', includeNotes: true },
    () => scopes,
    revokingForward,
  );
  assert.equal(notes.isError, true);
  assert.doesNotMatch(JSON.stringify(notes), /SECRET/);

  scopes = [...READ];
  const offForward = async (request) => {
    const reply = await fakeForward().forward(request);
    scopes = [];
    return reply;
  };
  const list = await tools.runTool('list_tasks', {}, () => scopes, offForward);
  assert.equal(list.isError, true);
  assert.match(list.content[0].text, /^NOT_PERMITTED/);
});

test('create_task forwards a literal capture and reports the outcome', async () => {
  const { forward, calls } = fakeForward({
    '/assistant/capture': () => ({
      status: 200,
      body: { ok: true, data: { status: 'created', id: 'new1' } },
    }),
  });
  const result = await tools.runTool(
    'create_task',
    { title: 'Buy milk #shop', notes: 'n' },
    () => ['tasks:capture'],
    forward,
  );
  assert.deepEqual(result.structuredContent, { id: 'new1', status: 'created' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].source, 'mcp');
  assert.deepEqual(calls[0].body, { title: 'Buy milk #shop', notes: 'n' });
});

test('create_task forwards dueDate, dueTime and repeat', async () => {
  const { forward, calls } = fakeForward({
    '/assistant/capture': () => ({
      status: 200,
      body: { ok: true, data: { status: 'created', id: 'new1' } },
    }),
  });
  const args = {
    title: 'Standup',
    dueDate: '2026-11-02',
    dueTime: '09:30',
    repeat: { cycle: 'weekly', every: 2, weekdays: ['mon', 'thu'] },
  };
  const result = await tools.runTool(
    'create_task',
    args,
    () => ['tasks:capture'],
    forward,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0].body, args);
});

test('create_task rejects invalid dates and repeats before forwarding', async () => {
  const cases = [
    [{ dueTime: '09:00' }, 'dueTime requires dueDate'],
    [{ dueDate: '2026-02-30' }, 'dueDate must be a calendar day as YYYY-MM-DD'],
    [{ dueDate: '0999-01-01' }, 'dueDate must be a calendar day as YYYY-MM-DD'],
    [
      { dueDate: '2026-11-02', dueTime: '24:00' },
      'dueTime must be a 24-hour time as HH:MM',
    ],
    [{ repeat: 'daily' }, 'repeat must be an object'],
    [{ repeat: { cycle: 'daily', at: 1 } }, 'Unknown argument: repeat.at'],
    [
      { repeat: { cycle: 'hourly' } },
      'repeat.cycle must be one of daily, weekly, monthly, yearly',
    ],
    [
      { repeat: { cycle: 'daily', every: 0 } },
      'repeat.every must be a whole number from 1 to 99',
    ],
    [
      { repeat: { cycle: 'daily', weekdays: ['mon'] } },
      'repeat.weekdays needs cycle weekly',
    ],
    [
      { repeat: { cycle: 'weekly', weekdays: ['mon', 'mon'] } },
      'repeat.weekdays must be distinct days out of mon, tue, wed, thu, fri, sat, sun',
    ],
  ];
  for (const [extra, message] of cases) {
    const { forward, calls } = fakeForward();
    const result = await tools.runTool(
      'create_task',
      { title: 'x', ...extra },
      () => ['tasks:capture'],
      forward,
    );
    assert.equal(result.content[0].text, `INVALID_ARGUMENTS: ${message}`, message);
    assert.equal(calls.length, 0);
  }
});

test('create_task forwards deadlineDate, deadlineTime and estimateMinutes', async () => {
  const { forward, calls } = fakeForward({
    '/assistant/capture': () => ({
      status: 200,
      body: { ok: true, data: { status: 'created', id: 'new1' } },
    }),
  });
  const args = {
    title: 'Lab report',
    dueDate: '2026-11-04',
    deadlineDate: '2026-11-06',
    deadlineTime: '08:00',
    estimateMinutes: 60,
  };
  const result = await tools.runTool(
    'create_task',
    args,
    () => ['tasks:capture'],
    forward,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0].body, args);
});

test('create_task rejects invalid deadlines and estimates before forwarding', async () => {
  const cases = [
    [{ deadlineTime: '08:00' }, 'deadlineTime requires deadlineDate'],
    [{ deadlineDate: '2026-02-30' }, 'deadlineDate must be a calendar day as YYYY-MM-DD'],
    [
      { deadlineDate: '2026-11-06', deadlineTime: '8:00' },
      'deadlineTime must be a 24-hour time as HH:MM',
    ],
    [
      { deadlineDate: '2026-11-06', repeat: { cycle: 'weekly' } },
      'deadlineDate cannot be combined with repeat',
    ],
    [{ estimateMinutes: 0 }, 'estimateMinutes must be a whole number from 1 to 10080'],
    [
      { estimateMinutes: 10081 },
      'estimateMinutes must be a whole number from 1 to 10080',
    ],
    [{ estimateMinutes: 2.5 }, 'estimateMinutes must be a whole number from 1 to 10080'],
    [{ estimateMinutes: '30' }, 'estimateMinutes must be a whole number from 1 to 10080'],
  ];
  for (const [extra, message] of cases) {
    const { forward, calls } = fakeForward();
    const result = await tools.runTool(
      'create_task',
      { title: 'x', ...extra },
      () => ['tasks:capture'],
      forward,
    );
    assert.equal(result.content[0].text, `INVALID_ARGUMENTS: ${message}`, message);
    assert.equal(calls.length, 0);
  }
});

test('create_task never claims nothing happened when the outcome is unknown', async () => {
  const timeout = async () => {
    throw new tools.RendererTimeoutError();
  };
  const result = await tools.runTool(
    'create_task',
    { title: 'x' },
    () => ['tasks:capture'],
    timeout,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^OUTCOME_UNKNOWN/);

  const { forward } = fakeForward({
    '/assistant/capture': () => ({
      status: 200,
      body: { ok: true, data: { status: 'APP_BUSY' } },
    }),
  });
  const busy = await tools.runTool(
    'create_task',
    { title: 'x' },
    () => ['tasks:capture'],
    forward,
  );
  assert.match(busy.content[0].text, /^APP_BUSY/);
});

// --- editing, deleting, notes and counters ---------------------------------------

const EDIT = [...READ, 'tasks:edit'];
const okReply = (data) => ({ status: 200, body: { ok: true, data } });

test('update_task turns dates, deadlines and estimates into task fields', async () => {
  const { forward, calls } = fakeForward({ '/tasks/t1': () => okReply(TASKS[0]) });
  const result = await tools.runTool(
    'update_task',
    {
      id: 't1',
      isDone: true,
      dueDate: '2026-11-20',
      deadlineDate: '2026-11-21',
      deadlineTime: '08:00',
      estimateMinutes: 90,
      tagIds: ['tg1', 'tg1'],
    },
    () => EDIT,
    forward,
  );
  assert.equal(result.isError, undefined);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].path, '/tasks/t1');
  assert.deepEqual(calls[0].body, {
    isDone: true,
    dueDay: '2026-11-20',
    dueWithTime: null,
    deadlineWithTime: new Date(2026, 10, 21, 8, 0).getTime(),
    timeEstimate: 90 * 60000,
    tagIds: ['tg1'],
    isIgnoreShortSyntax: true,
  });
  // The answer is a summary, never notes or other fields.
  assert.equal(result.structuredContent.task.id, 't1');
  assert.doesNotMatch(result.content[0].text, /SECRET|JIRA|attachments/);
});

test('update_task plans a start time and clears dates with null', async () => {
  const { forward, calls } = fakeForward({ '/tasks/t1': () => okReply(TASKS[0]) });
  await tools.runTool(
    'update_task',
    { id: 't1', dueDate: '2026-11-20', dueTime: '15:30', deadlineDate: null },
    () => EDIT,
    forward,
  );
  assert.deepEqual(calls[0].body, {
    dueWithTime: new Date(2026, 10, 20, 15, 30).getTime(),
    deadlineDay: null,
    deadlineWithTime: null,
    isIgnoreShortSyntax: true,
  });
  await tools.runTool('update_task', { id: 't1', dueDate: null }, () => EDIT, forward);
  assert.deepEqual(calls[1].body, {
    dueDay: null,
    dueWithTime: null,
    isIgnoreShortSyntax: true,
  });
});

test('update_task rejects what the route would, before forwarding', async () => {
  const { forward, calls } = fakeForward();
  for (const args of [
    { id: 't1' },
    { id: 't1', dueTime: '10:00' },
    { id: 't1', deadlineTime: '10:00' },
    { id: 't1', dueDate: '2026-02-30' },
    { id: 't1', title: '   ' },
    { id: 't1', estimateMinutes: -1 },
    { id: 't1', tagIds: ['../x'] },
    { id: 't1', parentId: 't2' },
    { id: '../status', isDone: true },
  ]) {
    const result = await tools.runTool('update_task', args, () => EDIT, forward);
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});

test('task actions use the matching routes', async () => {
  const { forward, calls } = fakeForward({
    '/tasks': () => okReply({ ...TASKS[1], id: 't3' }),
    '/tasks/t1/start': () => okReply(TASKS[0]),
    '/tasks/t1/archive': () => okReply(TASKS[0]),
    '/tasks/t1/restore': () => okReply(TASKS[0]),
    '/tasks/t1/time': () => okReply(TASKS[0]),
    '/task-control/stop': () => okReply({ currentTaskId: null }),
    '/tasks/t1': () => okReply({ deleted: true, id: 't1' }),
  });
  const all = () => [...EDIT, 'tasks:delete'];
  await tools.runTool('start_task', { id: 't1' }, all, forward);
  await tools.runTool('stop_tracking', {}, all, forward);
  await tools.runTool('archive_task', { id: 't1' }, all, forward);
  await tools.runTool('restore_task', { id: 't1' }, all, forward);
  await tools.runTool(
    'log_time',
    { id: 't1', minutes: 25, date: '2026-11-12' },
    all,
    forward,
  );
  await tools.runTool(
    'log_time',
    { id: 't1', minutes: 0, date: '2026-11-12', mode: 'set' },
    all,
    forward,
  );
  await tools.runTool(
    'add_subtask',
    { parentId: 't1', title: '#notatag sub', estimateMinutes: 10 },
    all,
    forward,
  );
  const deleted = await tools.runTool('delete_task', { id: 't1' }, all, forward);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [
      'POST /tasks/t1/start',
      'POST /task-control/stop',
      'POST /tasks/t1/archive',
      'POST /tasks/t1/restore',
      'POST /tasks/t1/time',
      'PUT /tasks/t1/time',
      'POST /tasks',
      'DELETE /tasks/t1',
    ],
  );
  assert.deepEqual(calls[4].body, { date: '2026-11-12', duration: 25 * 60000 });
  assert.deepEqual(calls[5].body, { date: '2026-11-12', duration: 0 });
  assert.deepEqual(calls[6].body, {
    title: '#notatag sub',
    parentId: 't1',
    isIgnoreShortSyntax: true,
    timeEstimate: 10 * 60000,
  });
  assert.deepEqual(deleted.structuredContent, { id: 't1', deleted: true });
});

test('deleting needs its own permission', async () => {
  const { forward, calls } = fakeForward();
  const result = await tools.runTool('delete_task', { id: 't1' }, () => EDIT, forward);
  assert.match(result.content[0].text, /^NOT_PERMITTED/);
  assert.equal(calls.length, 0);
});

test('a write that ran is reported even if the grant was revoked meanwhile', async () => {
  let scopes = EDIT;
  const { forward: inner } = fakeForward({ '/tasks/t1': () => okReply(TASKS[0]) });
  const revoking = async (request) => {
    const reply = await inner(request);
    scopes = [];
    return reply;
  };
  const result = await tools.runTool(
    'update_task',
    { id: 't1', isDone: true },
    () => scopes,
    revoking,
  );
  assert.equal(result.isError, undefined);
});

test('a write whose reply is lost has an unknown outcome, not a failure', async () => {
  const timeout = async () => {
    throw new tools.RendererTimeoutError();
  };
  const result = await tools.runTool('archive_task', { id: 't1' }, () => EDIT, timeout);
  assert.match(result.content[0].text, /^OUTCOME_UNKNOWN/);
});

test('archived tasks need the archive permission', async () => {
  const { forward, calls } = fakeForward();
  const denied = await tools.runTool(
    'list_tasks',
    { includeArchived: true },
    () => READ,
    forward,
  );
  assert.match(denied.content[0].text, /^ARCHIVE_NOT_PERMITTED/);
  assert.equal(calls.length, 0);
  await tools.runTool(
    'list_tasks',
    { includeArchived: true },
    () => [...READ, 'tasks:read_archive'],
    forward,
  );
  assert.equal(calls[0].query.source, 'all');
  await tools.runTool(
    'get_task',
    { id: 't1', includeArchived: true },
    () => [...READ, 'tasks:read_archive'],
    forward,
  );
  assert.equal(calls[1].query, undefined, 'tasks of archived projects are not hidden');
});

test('repeat configs use the custom schedule and come back in repeat terms', async () => {
  const stored = {
    id: 'r1',
    title: 'Practice',
    projectId: 'p1',
    tagIds: [],
    repeatCycle: 'WEEKLY',
    repeatEvery: 2,
    monday: true,
    wednesday: true,
    isPaused: false,
    notes: 'SECRET NOTES',
  };
  const { forward, calls } = fakeForward({
    '/task-repeat-cfgs': () => okReply(stored),
    '/task-repeat-cfgs/r1': () => okReply(stored),
  });
  const created = await tools.runTool(
    'create_repeat_config',
    { taskId: 't1', cycle: 'weekly', every: 2, weekdays: ['mon', 'wed'] },
    () => EDIT,
    forward,
  );
  assert.deepEqual(calls[0].body, {
    taskId: 't1',
    repeatCycle: 'WEEKLY',
    monday: true,
    tuesday: false,
    wednesday: true,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    repeatEvery: 2,
    quickSetting: 'CUSTOM',
  });
  assert.deepEqual(created.structuredContent.repeatConfig, {
    id: 'r1',
    title: 'Practice',
    projectId: 'p1',
    tagIds: [],
    repeatEvery: 2,
    isPaused: false,
    cycle: 'weekly',
    weekdays: ['mon', 'wed'],
  });
  await tools.runTool('update_repeat_config', { id: 'r1', isPaused: true }, () => EDIT, forward);
  assert.deepEqual(calls[1].body, { isPaused: true }, 'pausing is not a schedule change');
  await tools.runTool(
    'create_repeat_config',
    { taskId: 't1', startDate: '2026-12-01' },
    () => EDIT,
    forward,
  );
  assert.deepEqual(calls[2].body, {
    taskId: 't1',
    startDate: '2026-12-01',
    quickSetting: 'CUSTOM',
    repeatCycle: 'DAILY',
  });
});

test('notes and counters need their own permissions and are projected', async () => {
  const note = { id: 'n1', content: 'x'.repeat(9000), projectId: 'p1', backgroundColor: '#f00' };
  const counter = {
    id: 'c1',
    title: 'Water',
    type: 'ClickCounter',
    isEnabled: true,
    countOnDay: Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, i]),
    ),
  };
  const { forward, calls } = fakeForward({
    '/notes': () => okReply([note]),
    '/simple-counters/c1/increment': () => okReply(counter),
  });
  const denied = await tools.runTool('list_notes', {}, () => READ, forward);
  assert.match(denied.content[0].text, /^NOT_PERMITTED/);

  const notes = await tools.runTool('list_notes', {}, () => ['notes:read'], forward);
  const [listed] = notes.structuredContent.notes;
  assert.equal(listed.content.length, 8192);
  assert.equal(listed.contentTruncated, true);
  assert.equal(listed.backgroundColor, undefined);

  const noTarget = await tools.runTool(
    'create_note',
    { content: 'Hi' },
    () => ['notes:read', 'notes:edit'],
    forward,
  );
  assert.equal(noTarget.isError, true);

  const counted = await tools.runTool(
    'increment_counter',
    { id: 'c1', by: 2 },
    () => ['counters:read', 'counters:edit'],
    forward,
  );
  assert.deepEqual(calls.at(-1).body, { by: 2 });
  assert.equal(Object.keys(counted.structuredContent.counter.countOnDay).length, 31);
});

// --- HTTP, through the real listener ---------------------------------------------

const originalModuleLoad = Module._load;
const localRestApiModulePath = path.resolve(__dirname, 'local-rest-api.ts');
const PORT = 3901;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-assistant-test-'));
const handleHandlers = new Map();
const onHandlers = new Map();
const rendererCalls = [];
// One-shot probe fired from getIsAppReady(), which the REST path calls right
// after its token check and before it starts reading the body.
let onAppReadyCheck = null;
let onRendererResponse = null;

const win = {
  webContents: {
    send: (_channel, payload) => {
      rendererCalls.push(payload);
      setTimeout(() => {
        const data =
          payload.path === '/tasks'
            ? TASKS
            : payload.path === '/assistant/capture'
              ? { status: 'created', id: 'new1' }
              : { anything: true };
        const respond = () =>
          onHandlers.get('LOCAL_REST_API_RESPONSE')(
            {},
            { requestId: payload.requestId, status: 200, body: { ok: true, data } },
          );
        const intercept = onRendererResponse;
        onRendererResponse = null;
        if (intercept) intercept(respond);
        else respond();
      }, 1);
    },
  },
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => userDataDir,
        getVersion: () => '9.9.9',
        whenReady: () => Promise.resolve(),
      },
      ipcMain: {
        on: (name, handler) => onHandlers.set(name, handler),
        handle: (name, handler) => handleHandlers.set(name, handler),
      },
    };
  }
  if (request === 'electron-log/main') {
    return { log: () => {}, warn: () => {} };
  }
  if (request.endsWith('main-window') || request.endsWith('main-window.ts')) {
    return {
      getIsAppReady: () => {
        const probe = onAppReadyCheck;
        onAppReadyCheck = null;
        probe?.();
        return true;
      },
      getWin: () => win,
    };
  }
  if (
    request.endsWith('local-rest-api.model') ||
    request.endsWith('local-rest-api.model.ts')
  ) {
    return { ...originalModuleLoad(request, parent, isMain), LOCAL_REST_API_PORT: PORT };
  }
  return originalModuleLoad(request, parent, isMain);
};
const api = require(localRestApiModulePath);
Module._load = originalModuleLoad;

const ipc = (name, ...args) => handleHandlers.get(name)({}, ...args);

const post = (body, headers = {}, method = 'POST', urlPath = '/mcp') =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path: urlPath,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : undefined,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

let credential;
const auth = () => ({ Authorization: `Bearer ${credential}` });

test.before(async () => {
  api.initLocalRestApi();
  // Let the startup reads of the (empty) settings finish.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

test.after(() => {
  api.applyLocalRestApiEnabled(false);
  return ipc('ASSISTANT_ACCESS_SET_ENABLED', false).then(() =>
    fs.rmSync(userDataDir, { recursive: true, force: true }),
  );
});

test('assistant access starts off and nothing listens', async () => {
  const state = await ipc('ASSISTANT_ACCESS_GET_STATE');
  assert.deepEqual(state, {
    isEnabled: false,
    scopes: [],
    hasCredential: false,
    isListening: false,
  });
});

test('enabling assistant access alone brings the listener up, REST stays off', async () => {
  const state = await ipc('ASSISTANT_ACCESS_SET_ENABLED', true);
  assert.equal(state.isEnabled, true);
  assert.equal(state.isListening, true);

  const rest = await post(undefined, {}, 'GET', '/tasks');
  assert.equal(rest.status, 503);
  assert.equal(rest.body.error.code, 'API_DISABLED');
});

test('without a credential every call is unauthorized, with a bare Bearer challenge', async () => {
  const res = await post(rpc('initialize', { protocolVersion: '2025-11-25' }));
  assert.equal(res.status, 401);
  assert.equal(res.headers['www-authenticate'], 'Bearer');
});

test('the credential is shown once and only a 0600 verifier is stored', async () => {
  const result = await ipc('ASSISTANT_ACCESS_ROTATE_CREDENTIAL');
  credential = result.credential;
  assert.match(credential, /^sp_mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(result.state.hasCredential, true);

  const verifierPath = path.join(userDataDir, 'assistant-access-verifier');
  const stored = fs.readFileSync(verifierPath, 'utf8');
  assert.match(stored, /^[a-f0-9]{64}$/);
  assert.ok(!stored.includes(credential));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(verifierPath).mode & 0o777, 0o600);
  }
  const settings = fs.readFileSync(path.join(userDataDir, 'simpleSettings'), 'utf8');
  assert.ok(!settings.includes(credential));
});

test('a valid credential can initialize and sees only get_status without grants', async () => {
  const init = await post(rpc('initialize', { protocolVersion: '2025-11-25' }), auth());
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.version, '9.9.9');

  const list = await post(rpc('tools/list'), auth());
  assert.deepEqual(
    list.body.result.tools.map((t) => t.name),
    ['get_status'],
  );
});

test('browsers, other methods and unsupported versions are refused', async () => {
  const nullOrigin = await post(rpc('ping'), { ...auth(), Origin: 'null' });
  assert.equal(nullOrigin.status, 403);
  const webOrigin = await post(rpc('ping'), { ...auth(), Origin: 'https://evil.test' });
  assert.equal(webOrigin.status, 403);
  const get = await post(undefined, auth(), 'GET');
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, 'POST');
  const badHost = await post(rpc('ping'), { ...auth(), Host: 'evil.test:3901' });
  assert.equal(badHost.status, 403);
  const version = await post(rpc('ping'), {
    ...auth(),
    'MCP-Protocol-Version': '2026-07-28',
  });
  assert.equal(version.status, 400);
  const parse = await new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method: 'POST', path: '/mcp', headers: auth() },
      (res) => resolve(res.statusCode),
    );
    req.end('{not json');
  });
  assert.equal(parse, 400);
});

test('the REST token does not open /mcp, and the MCP credential does not open REST', async () => {
  api.applyLocalRestApiEnabled(true);
  try {
    const restToken = await ipc('LOCAL_REST_API_GET_TOKEN');
    const withRestToken = await post(rpc('ping'), {
      Authorization: `Bearer ${restToken}`,
    });
    assert.equal(withRestToken.status, 401);
    const restWithMcp = await post(undefined, auth(), 'GET', '/tasks');
    assert.equal(restWithMcp.status, 401);
  } finally {
    api.applyLocalRestApiEnabled(false);
  }
  // Turning REST off must not take the assistant endpoint down with it.
  const stillUp = await post(rpc('ping'), auth());
  assert.equal(stillUp.status, 200);
});

test('granted read scope serves projected tasks through the renderer routes', async () => {
  await ipc('ASSISTANT_ACCESS_SET_SCOPES', ['tasks:read']);
  const res = await post(
    rpc('tools/call', { name: 'list_tasks', arguments: {} }),
    auth(),
  );
  assert.equal(res.status, 200);
  const { tasks } = res.body.result.structuredContent;
  assert.equal(tasks.length, 2);
  assert.ok(!JSON.stringify(res.body).includes('SECRET NOTES'));
  const call = rendererCalls[rendererCalls.length - 1];
  assert.equal(call.path, '/tasks');
  assert.equal(call.source, undefined);
});

test('scopes are normalized: dependent scopes need theirs, unknown ones are dropped', async () => {
  const state = await ipc('ASSISTANT_ACCESS_SET_SCOPES', [
    'tasks:read_notes',
    'tasks:read_archive',
    'tasks:edit',
    'tasks:delete',
    'notes:edit',
    'counters:edit',
    'tasks:capture',
    'admin',
  ]);
  assert.deepEqual(state.scopes, ['tasks:capture']);
  const granted = await ipc('ASSISTANT_ACCESS_SET_SCOPES', [
    'counters:edit',
    'counters:read',
    'tasks:edit',
    'tasks:read',
  ]);
  assert.deepEqual(granted.scopes, [
    'tasks:read',
    'tasks:edit',
    'counters:read',
    'counters:edit',
  ]);  // The next test expects the capture-only grant from above.
  await ipc('ASSISTANT_ACCESS_SET_SCOPES', ['tasks:capture']);
});

test('capture-only access cannot read and captures with the mcp source', async () => {
  const list = await post(rpc('tools/list'), auth());
  assert.deepEqual(
    list.body.result.tools.map((t) => t.name),
    ['get_status', 'create_task'],
  );
  const read = await post(
    rpc('tools/call', { name: 'list_tasks', arguments: {} }),
    auth(),
  );
  assert.equal(read.body.error.code, protocol.INVALID_PARAMS);

  const created = await post(
    rpc('tools/call', { name: 'create_task', arguments: { title: 'Call Bob' } }),
    auth(),
  );
  assert.deepEqual(created.body.result.structuredContent, {
    id: 'new1',
    status: 'created',
  });
  const call = rendererCalls[rendererCalls.length - 1];
  assert.equal(call.path, '/assistant/capture');
  assert.equal(call.source, 'mcp');
});

// Overlapping changes must not persist a stale snapshot: here the scope write
// would otherwise carry isEnabled: true after the switch went off, and access
// would come back at the next launch.
test('overlapping settings changes persist the latest state', async () => {
  await Promise.all([
    ipc('ASSISTANT_ACCESS_SET_ENABLED', false),
    ipc('ASSISTANT_ACCESS_SET_SCOPES', ['tasks:capture']),
  ]);
  const settings = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'simpleSettings'), 'utf8'),
  );
  assert.deepEqual(settings.assistantAccess, {
    isEnabled: false,
    scopes: ['tasks:capture'],
  });
  const state = await ipc('ASSISTANT_ACCESS_SET_ENABLED', true);
  assert.equal(state.isListening, true);
});

test('rotating the credential revokes the old one immediately', async () => {
  const old = credential;
  credential = (await ipc('ASSISTANT_ACCESS_ROTATE_CREDENTIAL')).credential;
  const withOld = await post(rpc('ping'), { Authorization: `Bearer ${old}` });
  assert.equal(withOld.status, 401);
  const withNew = await post(rpc('ping'), auth());
  assert.equal(withNew.status, 200);
});

test('rotating the credential withholds a read already awaiting the renderer', async () => {
  await ipc('ASSISTANT_ACCESS_SET_SCOPES', ['tasks:read']);
  const rendererWaiting = new Promise((resolve) => (onRendererResponse = resolve));
  const response = post(rpc('tools/call', { name: 'list_tasks', arguments: {} }), auth());
  const respond = await rendererWaiting;
  credential = (await ipc('ASSISTANT_ACCESS_ROTATE_CREDENTIAL')).credential;
  respond();

  const res = await response;
  assert.equal(res.body.result.isError, true);
  assert.doesNotMatch(JSON.stringify(res.body), /Write report|SECRET NOTES/);
  await ipc('ASSISTANT_ACCESS_SET_SCOPES', ['tasks:capture']);
});

// A rejection escaping the listener's handler reaches start-app's
// uncaughtException handler, which exits the app. Recorded here instead so the
// tests below can assert that none escaped.
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

test('a malformed request target is answered, not thrown out of the handler', async () => {
  const res = await post(undefined, {}, 'GET', '//');
  assert.equal(res.status, 400);
  await settle();
  assert.deepEqual(unhandled, []);
});

test('a client that disconnects mid-upload does not escape the handler', async () => {
  await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: '/mcp',
      headers: { ...auth(), 'Content-Type': 'application/json', 'Content-Length': 1000 },
    });
    req.on('error', () => undefined);
    req.write('{"jsonrpc":');
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 20);
  });
  await settle();
  assert.deepEqual(unhandled, []);
  const stillUp = await post(rpc('ping'), auth());
  assert.equal(stillUp.status, 200);
});

// The assistant endpoint keeps the listener up after REST is switched off, so
// the off switch has to hold for a REST request that was already reading its body.
test('switching REST off stops a request whose body was still arriving', async () => {
  api.applyLocalRestApiEnabled(true);
  const restToken = await ipc('LOCAL_REST_API_GET_TOKEN');
  const callsBefore = rendererCalls.length;
  const payload = JSON.stringify({ title: 'late' });
  const authenticated = new Promise((resolve) => (onAppReadyCheck = resolve));
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method: 'POST',
        path: '/tasks',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      },
    );
    req.on('error', reject);
    req.write(payload.slice(0, 1));
    finish = () => req.end(payload.slice(1));
  });

  await authenticated;
  api.applyLocalRestApiEnabled(false);
  finish();

  const res = await response;
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'API_DISABLED');
  assert.equal(rendererCalls.length, callsBefore);
});

const { spawn } = require('node:child_process');

/** Runs the Claude Desktop stdio bridge against this listener. */
const runBridge = (accessKey, lines, expectedReplies) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(__dirname, '../tools/mcpb/server/index.js')],
      {
        env: {
          ...process.env,
          SP_MCP_URL: `http://127.0.0.1:${PORT}/mcp`,
          SP_ACCESS_KEY: accessKey,
        },
      },
    );
    const replies = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        if (replies.length === expectedReplies) {
          child.kill();
          resolve(replies);
        }
      }
    });
    child.on('error', reject);
    setTimeout(() => {
      child.kill();
      reject(new Error(`bridge answered ${replies.length}/${expectedReplies}`));
    }, 5000);
    for (const line of lines) {
      child.stdin.write(JSON.stringify(line) + '\n');
    }
  });

test('the Claude Desktop stdio bridge relays a full session', async () => {
  const replies = await runBridge(
    credential,
    [
      rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} }, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc('tools/list', {}, 2),
    ],
    2,
  );
  assert.equal(replies[0].id, 1);
  assert.equal(replies[0].result.protocolVersion, '2025-06-18');
  assert.equal(replies[1].id, 2);
  assert.deepEqual(
    replies[1].result.tools.map((t) => t.name),
    ['get_status', 'create_task'],
  );
});

test('the bridge answers a rejected key with an error for the pending request', async () => {
  const [reply] = await runBridge('sp_mcp_wrong', [rpc('tools/list', {}, 'x')], 1);
  assert.equal(reply.id, 'x');
  assert.match(reply.error.message, /access key/);
});

test('disabling assistant access refuses calls and stops the listener', async () => {
  const state = await ipc('ASSISTANT_ACCESS_SET_ENABLED', false);
  assert.equal(state.isListening, false);
  // A pooled keep-alive socket sees the close as a hang-up, a new one as refused.
  await assert.rejects(
    post(rpc('ping'), auth()),
    /ECONNREFUSED|ECONNRESET|socket hang up/,
  );
  const settings = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'simpleSettings'), 'utf8'),
  );
  assert.deepEqual(settings.assistantAccess, {
    isEnabled: false,
    scopes: ['tasks:capture'],
  });
});

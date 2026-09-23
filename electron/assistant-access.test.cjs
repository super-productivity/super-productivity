const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');
const http = require('node:http');

require('ts-node/register/transpile-only');

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
    serverInfo: { name: 'super-productivity', version: '1.2.3' },
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

test('only granted tools are listed', () => {
  const names = (scopes) => tools.listGrantedTools(scopes).map((t) => t.name);
  assert.deepEqual(names([]), ['get_status']);
  assert.deepEqual(names(['tasks:capture']), ['get_status', 'create_task']);
  assert.deepEqual(names(READ), [
    'get_status',
    'list_tasks',
    'get_task',
    'list_projects',
    'list_tags',
  ]);
  for (const tool of tools.listGrantedTools([...READ, 'tasks:capture'])) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
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
        onHandlers.get('LOCAL_REST_API_RESPONSE')(
          {},
          { requestId: payload.requestId, status: 200, body: { ok: true, data } },
        );
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

test('scopes are normalized: notes require read, unknown scopes are dropped', async () => {
  const state = await ipc('ASSISTANT_ACCESS_SET_SCOPES', [
    'tasks:read_notes',
    'tasks:capture',
    'admin',
  ]);
  assert.deepEqual(state.scopes, ['tasks:capture']);
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

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const handlers = new Map();
const jiraImageAuth = require(path.resolve(__dirname, 'jira-image-auth.ts'));
const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
        on: () => undefined,
      },
    };
  }
  if (request === '../jira-image-auth') {
    return jiraImageAuth;
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { initJiraIpc } = require(path.resolve(__dirname, 'ipc-handlers/jira.ts'));
const { IPC } = require(
  path.resolve(__dirname, 'shared-with-frontend/ipc-events.const.ts'),
);
const { applyJiraImageAuth, setupRequestHeadersForImages } = jiraImageAuth;
Module._load = originalModuleLoad;

initJiraIpc();

test('Jira IPC issues a capability only to the main renderer frame', () => {
  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  const register = handlers.get(IPC.JIRA_REGISTER_CAPABILITY);

  const token = register(event);
  assert.equal(typeof token, 'string');
  // Re-registering (e.g. after a renderer reload) rotates the token instead of
  // locking the frame out.
  const rotated = register(event);
  assert.equal(typeof rotated, 'string');
  assert.notEqual(rotated, token);

  const subFrame = {};
  assert.equal(register({ senderFrame: subFrame, sender: { mainFrame } }), null);
});

test('Jira IPC rejects a request without the document capability', () => {
  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  const register = handlers.get(IPC.JIRA_REGISTER_CAPABILITY);
  const makeRequest = handlers.get(IPC.JIRA_MAKE_REQUEST_EVENT);
  register(event);

  assert.throws(
    () =>
      makeRequest(event, {
        capabilityToken: 'forged-token',
        payload: { requestId: 'request-1' },
      }),
    /unauthorized/i,
  );
});

test('Jira IPC unwraps an authorized request before validation', async () => {
  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  const register = handlers.get(IPC.JIRA_REGISTER_CAPABILITY);
  const makeRequest = handlers.get(IPC.JIRA_MAKE_REQUEST_EVENT);
  const token = register(event);

  const result = await makeRequest(event, {
    capabilityToken: token,
    payload: { requestId: 'request-1' },
  });

  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'Invalid Jira URL' },
  });
});

test('issuing a capability to a new renderer document revokes stale image auth', () => {
  setupRequestHeadersForImages({
    host: 'https://jira.example.com/jira',
    userName: 'user',
    password: 'pass',
    usePAT: false,
  });

  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  const register = handlers.get(IPC.JIRA_REGISTER_CAPABILITY);
  assert.equal(typeof register(event), 'string');

  const requestHeaders = {};
  applyJiraImageAuth(
    'https://jira.example.com/jira/image.png',
    requestHeaders,
    'image',
  );
  assert.deepEqual(requestHeaders, {});
});

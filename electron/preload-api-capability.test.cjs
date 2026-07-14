const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { IPC } = require(
  path.resolve(__dirname, 'shared-with-frontend/ipc-events.const.ts'),
);
const {
  createJiraPreloadApiConsumer,
  toPayloadOnlyIpcListener,
} = require(path.resolve(__dirname, 'shared-with-frontend/preload-api.ts'));

test('renderer listeners receive payloads without the Electron event object', () => {
  const received = [];
  const listener = toPayloadOnlyIpcListener((...args) => received.push(args));
  const rawEvent = {
    sender: {
      invoke: () => {
        throw new Error('must not be exposed');
      },
    },
  };

  listener(rawEvent, { safe: true }, 'payload');

  assert.deepEqual(received, [[{ safe: true }, 'payload']]);
  assert.notEqual(received[0][0], rawEvent);
});

test('Jira preload capability registers eagerly and can only be consumed once', async () => {
  const invocations = [];
  const invoke = async (channel, ...args) => {
    invocations.push([channel, ...args]);
    if (channel === IPC.JIRA_REGISTER_CAPABILITY) {
      return 'main-issued-token';
    }
    return { requestId: 'request-1', response: { ok: true } };
  };

  const consume = createJiraPreloadApiConsumer(invoke);
  assert.deepEqual(invocations, [[IPC.JIRA_REGISTER_CAPABILITY]]);

  const api = consume();
  assert.ok(api);
  assert.equal(consume(), null);
  assert.equal(consume(), null);

  const request = {
    requestId: 'request-1',
    url: 'https://jira.example.com/rest/api/latest/myself',
    requestInit: { method: 'GET', headers: {} },
    allowSelfSignedCertificate: false,
  };
  await api.makeRequest(request);
  await api.clearImgHeaders();

  assert.deepEqual(invocations[1], [
    IPC.JIRA_MAKE_REQUEST_EVENT,
    {
      capabilityToken: 'main-issued-token',
      payload: request,
    },
  ]);
  assert.deepEqual(invocations[2], [
    IPC.JIRA_CLEAR_IMG_HEADERS,
    {
      capabilityToken: 'main-issued-token',
      payload: null,
    },
  ]);
});

test('Jira preload API refuses calls when main does not issue a capability', async () => {
  const invocations = [];
  const invoke = async (channel, ...args) => {
    invocations.push([channel, ...args]);
    return null;
  };
  const api = createJiraPreloadApiConsumer(invoke)();

  await assert.rejects(
    () =>
      api.makeRequest({
        requestId: 'request-1',
        url: 'https://jira.example.com',
        requestInit: { method: 'GET', headers: {} },
        allowSelfSignedCertificate: false,
      }),
    /unavailable/i,
  );
  assert.deepEqual(invocations, [[IPC.JIRA_REGISTER_CAPABILITY]]);
});

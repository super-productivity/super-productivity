const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

let imageHeaderFilter;
let imageHeaderListener;
const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      session: {
        defaultSession: {
          webRequest: {
            onBeforeSendHeaders: (filter, listener) => {
              imageHeaderFilter = filter;
              imageHeaderListener = listener;
            },
          },
        },
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { executeJiraRequest, setupRequestHeadersForImages } = require(
  path.resolve(__dirname, 'jira.ts'),
);
Module._load = originalModuleLoad;

const makeRequest = (overrides = {}) => ({
  requestId: 'request-1',
  url: 'https://jira.example.com/rest/api/latest/myself',
  requestInit: {
    method: 'GET',
    headers: {
      authorization: 'Basic secret',
      'Content-Type': 'application/json',
    },
  },
  allowSelfSignedCertificate: false,
  ...overrides,
});

test('allows Jira hosted on localhost and applies non-overridable fetch limits', async () => {
  let fetchedUrl;
  let fetchedInit;
  const fetchStub = async (url, init) => {
    fetchedUrl = url;
    fetchedInit = init;
    return {
      ok: true,
      text: async () => '{"ok":true}',
    };
  };

  const result = await executeJiraRequest(
    makeRequest({
      url: 'http://127.0.0.1:8080/jira/rest/api/latest/myself',
      requestInit: {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        body: '{"query":"test"}',
        redirect: 'follow',
        timeout: 0,
        size: 0,
      },
    }),
    fetchStub,
    () => undefined,
  );

  assert.equal(fetchedUrl, 'http://127.0.0.1:8080/jira/rest/api/latest/myself');
  assert.deepEqual(
    {
      method: fetchedInit.method,
      headers: fetchedInit.headers,
      body: fetchedInit.body,
      redirect: fetchedInit.redirect,
      timeout: fetchedInit.timeout,
      size: fetchedInit.size,
    },
    {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: '{"query":"test"}',
      redirect: 'error',
      timeout: 20_000,
      size: 25 * 1024 * 1024,
    },
  );
  assert.deepEqual(result, {
    requestId: 'request-1',
    response: { ok: true },
  });
});

test('rejects non-HTTP Jira URLs before fetch', async () => {
  let fetchCalled = false;
  const result = await executeJiraRequest(
    makeRequest({ url: 'file:///etc/passwd' }),
    async () => {
      fetchCalled = true;
      throw new Error('must not run');
    },
    () => undefined,
  );

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'Jira URL must use HTTP or HTTPS' },
  });
});

test('rejects methods outside the Jira API contract', async () => {
  let fetchCalled = false;
  const result = await executeJiraRequest(
    makeRequest({ requestInit: { method: 'DELETE', headers: {} } }),
    async () => {
      fetchCalled = true;
      throw new Error('must not run');
    },
    () => undefined,
  );

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'Invalid Jira request method' },
  });
});

test('returns a sanitized HTTP error with its status', async () => {
  const result = await executeJiraRequest(
    makeRequest(),
    async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Access denied',
    }),
    () => undefined,
  );

  assert.deepEqual(result, {
    requestId: 'request-1',
    error: {
      message: 'Access denied',
      status: 401,
    },
  });
  assert.equal('stack' in result.error, false);
});

test('does not expose thrown error details beyond the message', async () => {
  const thrown = Object.assign(new Error('network failed'), {
    secret: 'do not return',
  });
  const result = await executeJiraRequest(
    makeRequest(),
    async () => {
      throw thrown;
    },
    () => undefined,
  );

  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'network failed' },
  });
});

test('scopes image authentication to a custom Jira origin with port and base path', () => {
  setupRequestHeadersForImages({
    host: 'http://localhost:8080/jira',
    userName: 'user',
    password: 'pass',
    usePAT: false,
  });

  assert.deepEqual(imageHeaderFilter, { urls: ['http://localhost:8080/*'] });

  let callbackResult;
  const details = { requestHeaders: { accept: 'image/png' } };
  imageHeaderListener(details, (result) => {
    callbackResult = result;
  });
  assert.deepEqual(callbackResult, {
    requestHeaders: {
      accept: 'image/png',
      authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
    },
  });
});

test('rejects a non-HTTP Jira image authentication origin', () => {
  assert.throws(
    () =>
      setupRequestHeadersForImages({
        host: 'file:///tmp/jira',
        userName: 'user',
        password: 'pass',
        usePAT: false,
      }),
    /HTTP or HTTPS/,
  );
});

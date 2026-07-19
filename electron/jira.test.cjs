const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const {
  executeJiraRequest,
} = require(
  path.resolve(__dirname, 'jira.ts'),
);
const {
  applyJiraImageAuth,
  clearRequestHeadersForImages,
  setupRequestHeadersForImages,
} = require(path.resolve(__dirname, 'jira-image-auth.ts'));

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
      redirect: 'manual',
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

test('returns an HTTP error without copying the remote response body', async () => {
  let responseBodyDestroyed = false;
  const result = await executeJiraRequest(
    makeRequest(),
    async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: { destroy: () => (responseBodyDestroyed = true) },
      text: async () => 'Access denied',
    }),
    () => undefined,
  );

  assert.deepEqual(result, {
    requestId: 'request-1',
    error: {
      message: 'HTTP 401',
      status: 401,
    },
  });
  assert.equal(responseBodyDestroyed, true);
  assert.equal('stack' in result.error, false);
});

test('treats a missing legacy certificate setting as false', async () => {
  let allowSelfSignedCertificate;
  const request = makeRequest();
  delete request.allowSelfSignedCertificate;

  const result = await executeJiraRequest(
    request,
    async () => ({
      ok: true,
      text: async () => '{"ok":true}',
    }),
    (_url, allowSelfSigned) => {
      allowSelfSignedCertificate = allowSelfSigned;
      return undefined;
    },
  );

  assert.equal(allowSelfSignedCertificate, false);
  assert.deepEqual(result.response, { ok: true });
});

test('follows a same-origin Jira redirect', async () => {
  const fetchedUrls = [];
  let redirectBodyDestroyed = false;
  const result = await executeJiraRequest(
    makeRequest(),
    async (url) => {
      fetchedUrls.push(url);
      if (fetchedUrls.length === 1) {
        return {
          ok: false,
          status: 302,
          statusText: 'Found',
          body: { destroy: () => (redirectBodyDestroyed = true) },
          headers: { get: (name) => (name === 'location' ? '/jira/login' : null) },
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{"redirected":true}',
      };
    },
    () => undefined,
  );

  assert.deepEqual(fetchedUrls, [
    'https://jira.example.com/rest/api/latest/myself',
    'https://jira.example.com/jira/login',
  ]);
  assert.deepEqual(result.response, { redirected: true });
  assert.equal(redirectBodyDestroyed, true);
});

test('allows an HTTP to HTTPS redirect on the configured Jira hostname', async () => {
  const fetchedUrls = [];
  const result = await executeJiraRequest(
    makeRequest({ url: 'http://jira.example.com:8080/rest/api/latest/myself' }),
    async (url) => {
      fetchedUrls.push(url);
      if (fetchedUrls.length === 1) {
        return {
          ok: false,
          status: 308,
          statusText: 'Permanent Redirect',
          headers: {
            get: (name) =>
              name === 'location'
                ? 'https://jira.example.com:8443/rest/api/latest/myself'
                : null,
          },
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{"upgraded":true}',
      };
    },
    () => undefined,
  );

  assert.deepEqual(fetchedUrls, [
    'http://jira.example.com:8080/rest/api/latest/myself',
    'https://jira.example.com:8443/rest/api/latest/myself',
  ]);
  assert.deepEqual(result.response, { upgraded: true });
});

test('rejects redirects to a different hostname', async () => {
  const fetchedUrls = [];
  const result = await executeJiraRequest(
    makeRequest(),
    async (url) => {
      fetchedUrls.push(url);
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: {
          get: (name) =>
            name === 'location' ? 'https://internal.example.test/secret' : null,
        },
        text: async () => '',
      };
    },
    () => undefined,
  );

  assert.deepEqual(fetchedUrls, [
    'https://jira.example.com/rest/api/latest/myself',
  ]);
  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'Unsafe Jira redirect blocked' },
  });
});

test('stops after five safe Jira redirects', async () => {
  let fetchCalls = 0;
  const result = await executeJiraRequest(
    makeRequest(),
    async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: { get: () => `/redirect-${fetchCalls}` },
        text: async () => '',
      };
    },
    () => undefined,
  );

  assert.equal(fetchCalls, 6);
  assert.deepEqual(result, {
    requestId: 'request-1',
    error: { message: 'Too many Jira redirects' },
  });
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

  const matchingHeaders = { accept: 'image/png' };
  applyJiraImageAuth(
    'http://localhost:8080/jira/secure/attachment/1/image.png',
    matchingHeaders,
    'image',
  );
  assert.deepEqual(matchingHeaders, {
    accept: 'image/png',
    authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
  });

  const outsidePathHeaders = {};
  applyJiraImageAuth(
    'http://localhost:8080/other/image.png',
    outsidePathHeaders,
    'image',
  );
  assert.deepEqual(outsidePathHeaders, {});

  const prefixCollisionHeaders = {};
  applyJiraImageAuth(
    'http://localhost:8080/jira-evil/image.png',
    prefixCollisionHeaders,
    'image',
  );
  assert.deepEqual(prefixCollisionHeaders, {});

  const xhrHeaders = {};
  applyJiraImageAuth('http://localhost:8080/jira/rest/api/latest/issue/1', xhrHeaders, 'xhr');
  assert.deepEqual(xhrHeaders, {});
});

test('treats a missing legacy PAT setting as basic authentication', () => {
  setupRequestHeadersForImages({
    host: 'https://jira.example.com/jira/',
    userName: 'user',
    password: 'pass',
  });

  const requestHeaders = {};
  applyJiraImageAuth(
    'https://jira.example.com/jira/image.png',
    requestHeaders,
    'image',
  );
  assert.equal(
    requestHeaders.authorization,
    `Basic ${Buffer.from('user:pass').toString('base64')}`,
  );
});

test('clears Jira image authentication when it is no longer needed', () => {
  clearRequestHeadersForImages();

  const requestHeaders = {};
  applyJiraImageAuth(
    'https://jira.example.com/jira/image.png',
    requestHeaders,
    'image',
  );
  assert.deepEqual(requestHeaders, {});
});

test('clears previous image authentication when replacement config is invalid', () => {
  setupRequestHeadersForImages({
    host: 'https://jira-a.example.com/jira',
    userName: 'user',
    password: 'pass',
    usePAT: false,
  });

  assert.throws(
    () =>
      setupRequestHeadersForImages({
        host: null,
        userName: 'other-user',
        password: 'other-pass',
        usePAT: false,
      }),
    /Invalid Jira image authentication config/,
  );

  const requestHeaders = {};
  applyJiraImageAuth(
    'https://jira-a.example.com/jira/image.png',
    requestHeaders,
    'image',
  );
  assert.deepEqual(requestHeaders, {});
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

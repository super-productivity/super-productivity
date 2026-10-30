const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

require('ts-node/register/transpile-only');

const { isGitLabApiUrl } = require(path.resolve(__dirname, 'api-user-agent.ts'));
const { createWebDavCookieJar } = require(
  path.resolve(__dirname, 'webdav-cookie-jar.ts'),
);

const readRepoFile = (relative) =>
  fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

// The marker header is a contract between two separate build targets: the
// renderer-side WebDavHttpAdapter emits it, this main-process hook consumes it.
// Neither can import the other, so read the producer's constant here — renaming
// it on one side must fail loudly instead of silently disabling the #9985 fix.
const MARKER = /ELECTRON_WEBDAV_HEADER = '([^']+)'/.exec(
  readRepoFile('packages/sync-providers/src/file-based/webdav/webdav-http-adapter.ts'),
)?.[1];
assert.ok(MARKER, 'WebDavHttpAdapter must define ELECTRON_WEBDAV_HEADER');

// Execute the real request hook and its header helpers without booting Electron.
const source = ts.createSourceFile(
  'main-window.ts',
  readRepoFile('electron/main-window.ts'),
  ts.ScriptTarget.Latest,
  true,
);
let hook;
let responseHook;
const helpers = [];
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'onBeforeSendHeaders'
  ) {
    hook = node.arguments[0].getText(source);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'onHeadersReceived'
  ) {
    responseHook = node.arguments[0].getText(source);
  }
  if (
    ts.isVariableDeclaration(node) &&
    ['removeKeyInAnyCase', 'upsertKeyValue'].includes(node.name.getText(source))
  ) {
    helpers.push(`const ${node.getText(source)};`);
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(hook, 'main-window must register its request hook');
assert.ok(responseHook, 'main-window must register its response hook');
const webDavCookieJar = createWebDavCookieJar();
const [beforeSendHeaders, headersReceived] = vm.runInNewContext(
  ts.transpile(`${helpers.join('\n')}\n[${hook}, ${responseHook}];`),
  {
    URL,
    applyJiraImageAuth() {},
    isGitLabApiUrl,
    apiUserAgent: 'SuperProductivity/test',
    webDavCookieJar,
  },
);
const headersFor = (method, host, requestHeaders = {}) => {
  let result;
  beforeSendHeaders(
    { method, url: `https://${host}/sync-data.json`, requestHeaders },
    (response) => (result = response.requestHeaders),
  );
  return result;
};

test('the hook recognises the exact marker the adapter emits (#9985)', () => {
  // Guards the cross-target string contract in both directions: the hook must
  // act on the producer's constant, and must not forward it to the server.
  const headers = headersFor('PUT', 'dav.example.com', { [MARKER]: '1' });
  assert.equal(headers.Connection, 'close');
  assert.equal(Object.keys(headers).length, 1);
});

test('preserves connection reuse for unmarked requests, including other integrations PUTs', () => {
  for (const [method, host] of [
    ['GET', 'dav.example.com'],
    ['PROPFIND', 'dav.example.com'],
    ['GET', 'another-dav.example.com'],
    ['POST', 'api.example.com'],
    ['PUT', 'api.example.com'],
    ['PUT', 'dav.example.com'],
  ]) {
    assert.equal(headersFor(method, host).Connection, undefined);
  }
});

test('replaces an existing Connection header regardless of casing', () => {
  const headers = headersFor('PUT', 'dav.example.com', {
    connection: 'keep-alive',
    'x-superproductivity-webdav': '1',
  });
  assert.equal(headers.Connection, 'close');
  assert.equal(Object.keys(headers).length, 1);
});

test('consumes the WebDAV marker without forwarding it on non-PUT requests', () => {
  const headers = headersFor('GET', 'dav.example.com', {
    'X-SuperProductivity-WebDAV': '1',
  });
  assert.equal(Object.keys(headers).length, 0);
});

test('resends a WebDAV session cookie only on marked requests (#10839)', () => {
  const host = 'cookie-dav.example.com';
  // The first marked request registers the origin as WebDAV.
  assert.equal(headersFor('PROPFIND', host, { [MARKER]: '1' }).Cookie, undefined);
  headersReceived(
    {
      method: 'PROPFIND',
      url: `https://${host}/sync-data.json`,
      responseHeaders: { 'set-cookie': ['session=s1; Path=/; HttpOnly'] },
    },
    () => {},
  );
  assert.equal(headersFor('GET', host, { [MARKER]: '1' }).Cookie, 'session=s1');
  // Renderer-sent cookies stay stripped and other requests get none.
  assert.equal(headersFor('GET', host, { Cookie: 'injected=1' }).Cookie, undefined);
  assert.equal(
    headersFor('GET', host, { [MARKER]: '1', Cookie: 'injected=1' }).Cookie,
    'session=s1',
  );
  // A different account on the same origin must not inherit the session.
  assert.equal(
    headersFor('GET', host, { [MARKER]: '1', authorization: 'Basic other' }).Cookie,
    undefined,
  );
});

test('GitLab API requests get a non-browser User-Agent (#10650)', () => {
  const browserUa = { 'user-agent': 'Mozilla/5.0 Electron/43.2.0' };
  let result;
  beforeSendHeaders(
    {
      method: 'GET',
      url: 'https://git.example.org/api/v4/projects/1/issues',
      requestHeaders: { ...browserUa },
    },
    (response) => (result = response.requestHeaders),
  );
  assert.deepEqual(result, { 'User-Agent': 'SuperProductivity/test' });
  assert.deepEqual(headersFor('GET', 'example.com', { ...browserUa }), browserUa);
});

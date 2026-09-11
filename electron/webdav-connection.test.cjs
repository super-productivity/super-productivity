const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const readRepoFile = (relative) =>
  fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

// The marker header is a contract between two separate build targets: the
// renderer-side WebDavHttpAdapter emits it, this main-process hook consumes it.
// Neither can import the other, so read the producer's constant here — renaming
// it on one side must fail loudly instead of silently disabling the #9985 fix.
const MARKER = /ELECTRON_UPLOAD_HEADER = '([^']+)'/.exec(
  readRepoFile('packages/sync-providers/src/file-based/webdav/webdav-http-adapter.ts'),
)?.[1];
assert.ok(MARKER, 'WebDavHttpAdapter must define ELECTRON_UPLOAD_HEADER');

// Execute the real request hook and its header helpers without booting Electron.
const source = ts.createSourceFile(
  'main-window.ts',
  readRepoFile('electron/main-window.ts'),
  ts.ScriptTarget.Latest,
  true,
);
let hook;
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
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === 'removeKeyInAnyCase'
  ) {
    helpers.push(`const ${node.getText(source)};`);
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(hook, 'main-window must register its request hook');
const beforeSendHeaders = vm.runInNewContext(
  ts.transpile(`${helpers.join('\n')}\n(${hook});`),
  { URL, applyJiraImageAuth() {} },
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
    'x-superproductivity-webdav-upload': '1',
  });
  assert.equal(headers.Connection, 'close');
  assert.equal(Object.keys(headers).length, 1);
});

test('consumes the WebDAV marker without forwarding it on non-PUT requests', () => {
  const headers = headersFor('GET', 'dav.example.com', {
    'X-SuperProductivity-WebDAV-Upload': '1',
  });
  assert.equal(Object.keys(headers).length, 0);
});

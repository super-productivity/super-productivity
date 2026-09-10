const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');

// Execute the real request hook and its header helpers without booting Electron.
const source = ts.createSourceFile(
  'main-window.ts',
  fs.readFileSync(path.join(__dirname, 'main-window.ts'), 'utf8'),
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

test('upload verification escapes a connection holding the old file (#9985)', async (t) => {
  let stored = '{"version":1}';
  const snapshots = new Map();
  const sockets = [];
  const receivedMarkers = [];
  const server = http.createServer((req, res) => {
    receivedMarkers.push(req.headers['x-superproductivity-webdav-upload']);
    if (!snapshots.has(req.socket)) snapshots.set(req.socket, stored);
    sockets.push(req.socket);
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        stored = body;
        res.writeHead(204);
        res.end();
      });
    } else {
      res.end(snapshots.get(req.socket));
    }
  });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => {
    agent.destroy();
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (method, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          method,
          agent,
          headers: headersFor(
            method,
            'dav.example.com',
            method === 'PUT' ? { 'X-SuperProductivity-WebDAV-Upload': '1' } : {},
          ),
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(body);
    });

  assert.equal(await request('GET'), '{"version":1}');
  await request('PUT', '{"version":2}');
  assert.deepEqual(receivedMarkers, [undefined, undefined]);
  assert.equal(stored, '{"version":2}', 'the upload itself succeeded');
  assert.equal(await request('GET'), stored, 'verification must see the new file');
  assert.equal(sockets[0], sockets[1], 'reproduce PUT on a reused connection');
  assert.notEqual(sockets[1], sockets[2], 'verification needs a fresh connection');
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

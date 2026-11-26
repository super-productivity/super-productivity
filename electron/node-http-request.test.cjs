const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

require('ts-node/register/transpile-only');

const { nodeHttpRequest } = require(path.resolve(__dirname, 'node-http-request.ts'));

const LIMITS = { redirect: 'manual', timeout: 2_000, size: 1024 };

const withServer = async (handler, run) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });

test('sends method, headers and body with the node-fetch v2 defaults', async () => {
  let received;
  await withServer(
    async (req, res) => {
      received = { method: req.method, headers: req.headers, body: await readBody(req) };
      res.end('{"ok":true}');
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(`${baseUrl}/rest`, {
        ...LIMITS,
        method: 'POST',
        headers: { Authorization: 'Basic abc', 'User-Agent': 'custom-agent' },
        body: '{"q":"ü"}',
      });
      assert.equal(response.ok, true);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '{"ok":true}');
    },
  );

  assert.equal(received.method, 'POST');
  assert.equal(received.body, '{"q":"ü"}');
  assert.equal(received.headers.authorization, 'Basic abc');
  assert.equal(received.headers['user-agent'], 'custom-agent');
  assert.equal(received.headers.accept, '*/*');
  assert.equal(received.headers['accept-encoding'], 'gzip,deflate');
  assert.equal(received.headers['content-type'], 'text/plain;charset=UTF-8');
  assert.equal(received.headers['content-length'], '10');
  assert.equal(received.headers.connection, 'close');
});

test('returns redirects unfollowed with their location header', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { Location: '/login' });
      res.end();
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      assert.equal(response.ok, false);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('Location'), '/login');
      assert.equal(response.headers.get('x-missing'), null);
      response.body.destroy();
    },
  );
});

test('reports non-2xx responses as not ok', async () => {
  await withServer(
    (req, res) => {
      res.statusCode = 500;
      res.end('internal details');
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      assert.equal(response.ok, false);
      assert.equal(response.status, 500);
      response.body.destroy();
    },
  );
});

test('decompresses gzip responses', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync('{"zipped":true}'));
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      assert.equal(await response.text(), '{"zipped":true}');
    },
  );
});

test('rejects a response body over the size limit', async () => {
  await withServer(
    (req, res) => res.end('x'.repeat(2048)),
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      await assert.rejects(response.text(), /over limit: 1024/);
    },
  );
});

test('times out when the server does not answer', async () => {
  await withServer(
    () => {
      // never respond
    },
    async (baseUrl) => {
      await assert.rejects(
        nodeHttpRequest(baseUrl, {
          ...LIMITS,
          timeout: 50,
          method: 'GET',
          headers: {},
        }),
        /network timeout at:/,
      );
    },
  );
});

test('uses the supplied agent for the connection', async () => {
  const agent = new http.Agent();
  let agentUsed = false;
  const originalAddRequest = agent.addRequest;
  agent.addRequest = function (...args) {
    agentUsed = true;
    return originalAddRequest.apply(this, args);
  };

  await withServer(
    (req, res) => res.end('ok'),
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
        agent,
      });
      assert.equal(await response.text(), 'ok');
    },
  );
  agent.destroy();
  assert.equal(agentUsed, true);
});

test('wraps connection errors like node-fetch did', async () => {
  await assert.rejects(
    nodeHttpRequest('http://127.0.0.1:1/', { ...LIMITS, method: 'GET', headers: {} }),
    /request to http:\/\/127\.0\.0\.1:1\/ failed, reason:/,
  );
});

test('decodes raw and zlib-wrapped deflate responses', async () => {
  for (const encode of [zlib.deflateRawSync, zlib.deflateSync]) {
    await withServer(
      (req, res) => {
        res.writeHead(200, { 'Content-Encoding': 'deflate' });
        res.end(encode('{"deflated":true}'));
      },
      async (baseUrl) => {
        const response = await nodeHttpRequest(baseUrl, {
          ...LIMITS,
          method: 'GET',
          headers: {},
        });
        assert.equal(await response.text(), '{"deflated":true}');
      },
    );
  }
});

test('closes the connection when a compressed body stalls past the timeout', async () => {
  let socketClosed;
  await withServer(
    (req, res) => {
      socketClosed = new Promise((resolve) => req.socket.on('close', resolve));
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.write(zlib.gzipSync('x').subarray(0, 5));
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        timeout: 100,
        method: 'GET',
        headers: {},
      });
      await assert.rejects(response.text(), /Response timeout/);
      await socketClosed;
    },
  );
});

test('reports a compressed body aborted before it is read instead of crashing', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' });
      res.write(zlib.gzipSync('x').subarray(0, 5), () => req.socket.destroy());
    },
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await assert.rejects(response.text(), /Invalid response body/);
    },
  );
});

test('rejects reading the body twice', async () => {
  await withServer(
    (req, res) => res.end('once'),
    async (baseUrl) => {
      const response = await nodeHttpRequest(baseUrl, {
        ...LIMITS,
        method: 'GET',
        headers: {},
      });
      assert.equal(await response.text(), 'once');
      await assert.rejects(response.text(), /body used already/);
    },
  );
});

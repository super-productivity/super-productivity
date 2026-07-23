const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');
const http = require('node:http');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const localRestApiModulePath = path.resolve(__dirname, 'local-rest-api.ts');

// Isolated userData dir so the persisted token file never touches a real profile.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-test-'));
const tokenFilePath = path.join(userDataDir, 'local-rest-api-token');
// Repointed by tests that need writes to fail, or that need a pristine profile.
let currentUserDataDir = userDataDir;

const ipcMainOnHandlers = new Map();
const ipcMainHandleHandlers = new Map();
let isAppReadyValue = true;
const mockWin = {
  webContents: {
    send: (channel, payload) => {
      // Simulate the renderer responding back with a successful IPC response.
      setTimeout(() => {
        const responseHandler = ipcMainOnHandlers.get('LOCAL_REST_API_RESPONSE');
        if (responseHandler) {
          responseHandler(
            {},
            {
              requestId: payload.requestId,
              status: 200,
              body: { ok: true, data: 'mock_renderer_data' },
            },
          );
        }
      }, 5);
    },
  },
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => currentUserDataDir,
        },
        ipcMain: {
          on: (eventName, handler) => {
            ipcMainOnHandlers.set(eventName, handler);
          },
          handle: (eventName, handler) => {
            ipcMainHandleHandlers.set(eventName, handler);
          },
        },
      };
    }

    if (request === 'electron-log/main') {
      return {
        log: () => {},
        warn: () => {},
      };
    }

    if (request.endsWith('main-window') || request.endsWith('main-window.ts')) {
      return {
        getIsAppReady: () => isAppReadyValue,
        getWin: () => mockWin,
      };
    }

    if (
      request.endsWith('local-rest-api.model') ||
      request.endsWith('local-rest-api.model.ts')
    ) {
      const actual = originalModuleLoad(request, parent, isMain);
      return {
        ...actual,
        LOCAL_REST_API_PORT: 3879, // Non-colliding port for testing.
      };
    }

    return originalModuleLoad(request, parent, isMain);
  };
};

const uninstallMocks = () => {
  Module._load = originalModuleLoad;
};

installMocks();
const { initLocalRestApi, updateLocalRestApiConfig } = require(localRestApiModulePath);
uninstallMocks();

// A second, independent copy of the module with its own in-memory token, for
// the cases that can only be observed on a cold start (what a fresh app does
// with whatever happens to be in the token file). It never gets initLocalRestApi(),
// so it registers no IPC handlers and starts no server on the shared test port.
const loadColdModule = () => {
  const resolved = require.resolve(localRestApiModulePath);
  installMocks();
  delete require.cache[resolved];
  const coldModule = require(localRestApiModulePath);
  delete require.cache[resolved];
  uninstallMocks();
  return coldModule;
};

const enableApi = () =>
  updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });
const disableApi = () =>
  updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
const getToken = () => ipcMainHandleHandlers.get('LOCAL_REST_API_GET_TOKEN')();
const regenerateToken = () =>
  ipcMainHandleHandlers.get('LOCAL_REST_API_REGENERATE_TOKEN')();

const makeRequest = (options, body) => {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3879, ...options }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
      });
    });
    req.on('error', (err) => reject(err));
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

test.before(() => {
  initLocalRestApi();
});

// MUST run before anything else touches getToken(): that IPC handler calls
// ensureToken() itself, so a test that mints through the getter would pass even
// if enabling minted nothing. This one reads the credential off disk instead,
// which is the only way it fails when the mint is removed from
// updateLocalRestApiConfig() — the round-2 blocker it guards.
test('enabling the API alone mints a live, persisted token', async () => {
  enableApi();
  assert.ok(fs.existsSync(tokenFilePath), 'no token file after enableApi()');

  const fromDisk = fs.readFileSync(tokenFilePath, 'utf8').trim();
  assert.match(fromDisk, /^[A-Za-z0-9]{32}$/);

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${fromDisk}` },
  });
  assert.equal(res.status, 200, 'server did not accept the on-disk token');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data, 'mock_renderer_data');
});

test('enabling the API registers get/regenerate IPC handlers', () => {
  enableApi();
  assert.ok(ipcMainHandleHandlers.has('LOCAL_REST_API_GET_TOKEN'));
  assert.ok(ipcMainHandleHandlers.has('LOCAL_REST_API_REGENERATE_TOKEN'));
});

test('getToken returns the same token that was minted on enable', () => {
  enableApi();
  assert.equal(getToken(), fs.readFileSync(tokenFilePath, 'utf8').trim());
});

test('the token is persisted to a 0600 file under userData', () => {
  enableApi();
  const token = getToken();
  assert.ok(fs.existsSync(tokenFilePath));
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), token);
  if (process.platform !== 'win32') {
    // Owner read/write only.
    assert.equal(fs.statSync(tokenFilePath).mode & 0o777, 0o600);
  }
});

test('GET /health needs no token', async () => {
  enableApi();
  const res = await makeRequest({ method: 'GET', path: '/health' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.server, 'up');
});

// RFC 7235 requires a challenge on every 401, and the message is the only
// guidance a script written against the pre-token API ever sees.
const assertUnauthorized = (res, messagePrefix) => {
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.headers['www-authenticate'], 'Bearer');
  assert.match(res.body.error.message, messagePrefix);
  assert.match(res.body.error.message, /Settings → Misc → Access Token/);
};

test('request without Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({ method: 'GET', path: '/tasks' });
  assertUnauthorized(res, /^Authorization token required/);
});

test('request with malformed Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  });
  assertUnauthorized(res, /^Authorization token required/);
});

test('request with wrong token returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Bearer wrong_token' },
  });
  assertUnauthorized(res, /^Invalid authorization token/);
});

test('the Bearer scheme is case-insensitive (RFC 7235)', async () => {
  enableApi();
  const token = getToken();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('regenerating invalidates the previous token immediately', async () => {
  enableApi();
  const oldToken = getToken();
  const newToken = regenerateToken();
  assert.notEqual(oldToken, newToken);
  assert.match(newToken, /^[A-Za-z0-9]{32}$/);
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), newToken);

  const oldRes = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  assert.equal(oldRes.status, 401);

  const newRes = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${newToken}` },
  });
  assert.equal(newRes.status, 200);
});

test('a failed persist leaves the old token live instead of silently un-revoking it', async () => {
  enableApi();
  const liveToken = getToken();
  const onDiskBefore = fs.readFileSync(tokenFilePath, 'utf8').trim();

  // Stand in for any write failure — disk full, EACCES, read-only mount, AV
  // lock — by pointing userData at a directory that does not exist.
  currentUserDataDir = path.join(userDataDir, 'nope');
  let regenerateThrew = false;
  try {
    regenerateToken();
  } catch {
    regenerateThrew = true;
  } finally {
    currentUserDataDir = userDataDir;
  }
  assert.ok(
    regenerateThrew,
    'regenerateToken() reported success even though the token was never stored',
  );

  // The old token is still the one on disk *and* the one in memory, so nothing
  // was revoked and nothing comes back to life on the next launch.
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), onDiskBefore);
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${liveToken}` },
  });
  assert.equal(res.status, 200, 'the un-rotated token should still work');
});

test('a corrupted token file is replaced instead of becoming the credential', () => {
  // Cold start against a truncated file, e.g. a write interrupted by a crash.
  const coldProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-cold-'));
  const coldTokenFilePath = path.join(coldProfileDir, 'local-rest-api-token');
  fs.writeFileSync(coldTokenFilePath, 'trunc', { mode: 0o600 });

  currentUserDataDir = coldProfileDir;
  try {
    loadColdModule().updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });
    assert.match(fs.readFileSync(coldTokenFilePath, 'utf8').trim(), /^[A-Za-z0-9]{32}$/);
  } finally {
    currentUserDataDir = userDataDir;
    fs.rmSync(coldProfileDir, { recursive: true, force: true });
  }
});

test('the persisted file is left at 0600 even if it already existed as 0644', () => {
  if (process.platform === 'win32') {
    return;
  }
  enableApi();
  getToken();
  fs.chmodSync(tokenFilePath, 0o644);

  const rotated = regenerateToken();
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), rotated);
  assert.equal(fs.statSync(tokenFilePath).mode & 0o777, 0o600);
});

test('SP_FORCE_LOCAL_REST_API can use an explicit dev token', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalForce = process.env.SP_FORCE_LOCAL_REST_API;
  const originalForceToken = process.env.SP_FORCE_LOCAL_REST_API_TOKEN;

  process.env.NODE_ENV = 'DEV';
  process.env.SP_FORCE_LOCAL_REST_API = '1';
  process.env.SP_FORCE_LOCAL_REST_API_TOKEN = 'forced_dev_token_123';

  try {
    // Persisted setting disabled: the forced-dev override must still yield a
    // usable credential, and getToken must report it.
    disableApi();
    assert.equal(getToken(), 'forced_dev_token_123');

    const res = await makeRequest({
      method: 'GET',
      path: '/tasks',
      headers: { Authorization: 'Bearer forced_dev_token_123' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // Regenerating must not mint a token the getter will never return, and must
    // leave the real profile's token file alone.
    const persistedBefore = fs.readFileSync(tokenFilePath, 'utf8').trim();
    assert.equal(regenerateToken(), 'forced_dev_token_123');
    assert.equal(getToken(), 'forced_dev_token_123');
    assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), persistedBefore);
  } finally {
    const restore = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('NODE_ENV', originalNodeEnv);
    restore('SP_FORCE_LOCAL_REST_API', originalForce);
    restore('SP_FORCE_LOCAL_REST_API_TOKEN', originalForceToken);
    disableApi();
  }
});

test.after(() => {
  disableApi();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

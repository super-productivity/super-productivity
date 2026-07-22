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
          getPath: () => userDataDir,
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

test('enabling the API registers get/regenerate IPC handlers', () => {
  enableApi();
  assert.ok(ipcMainHandleHandlers.has('LOCAL_REST_API_GET_TOKEN'));
  assert.ok(ipcMainHandleHandlers.has('LOCAL_REST_API_REGENERATE_TOKEN'));
});

test('enabling the API mints a working 32-char alphanumeric token', async () => {
  // Regression for the round-2 blocker: enabling must not start an unreachable
  // server with an undefined token. The token is minted in the main process, so
  // a request carrying it succeeds immediately with no renderer round-trip for
  // the credential.
  enableApi();
  const token = getToken();
  assert.match(token, /^[A-Za-z0-9]{32}$/);

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data, 'mock_renderer_data');
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

test('request without Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({ method: 'GET', path: '/tasks' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Authorization token required');
});

test('request with malformed Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Authorization token required');
});

test('request with wrong token returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Bearer wrong_token' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Invalid authorization token');
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

test('SP_FORCE_LOCAL_REST_API can use an explicit dev token on a clean profile', async () => {
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

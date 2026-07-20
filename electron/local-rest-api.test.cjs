const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const http = require('node:http');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const localRestApiModulePath = path.resolve(__dirname, 'local-rest-api.ts');

let ipcMainOnHandlers = new Map();
let isAppReadyValue = true;
let mockWin = {
  webContents: {
    send: (channel, payload) => {
      // Simulate renderer responding back with successful IPC response
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
        ipcMain: {
          on: (eventName, handler) => {
            ipcMainOnHandlers.set(eventName, handler);
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
        LOCAL_REST_API_PORT: 3879, // Use a non-colliding port for testing
      };
    }

    return originalModuleLoad(request, parent, isMain);
  };
};

const uninstallMocks = () => {
  Module._load = originalModuleLoad;
};

// Install mocks and import the module via computed path
installMocks();
const { initLocalRestApi, updateLocalRestApiConfig } = require(localRestApiModulePath);
uninstallMocks();

// Helper to make HTTP request in tests
const makeRequest = (options, body) => {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 3879,
        ...options,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data),
          });
        });
      },
    );

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

test('GET /health without token returns 200', async () => {
  // Enable the API server with a token
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: 'my_super_secret_token_123',
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/health',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.server, 'up');
});

test('Request without Authorization header returns 401', async () => {
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: 'my_super_secret_token_123',
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Authorization token required');
});

test('Request with malformed Authorization header returns 401', async () => {
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: 'my_super_secret_token_123',
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: {
      Authorization: 'Basic dXNlcjpwYXNz',
    },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Authorization token required');
});

test('Request with wrong token returns 401', async () => {
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: 'my_super_secret_token_123',
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: {
      Authorization: 'Bearer wrong_token',
    },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.body.error.message, 'Invalid authorization token');
});

test('Request with correct token passes to renderer and returns 200', async () => {
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: 'my_super_secret_token_123',
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: {
      Authorization: 'Bearer my_super_secret_token_123',
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data, 'mock_renderer_data');
});

test('Request is rejected while no token is configured yet', async () => {
  // The token lives in renderer config and only reaches the main process via
  // updateLocalRestApiConfig. Until it arrives, the API must fail closed rather
  // than serve every request unauthenticated.
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: true,
      localRestApiToken: undefined,
    },
  });

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: {
      Authorization: 'Bearer my_super_secret_token_123',
    },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('SP_FORCE_LOCAL_REST_API can use an explicit development token on a clean profile', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalForce = process.env.SP_FORCE_LOCAL_REST_API;
  const originalForceToken = process.env.SP_FORCE_LOCAL_REST_API_TOKEN;

  process.env.NODE_ENV = 'DEV';
  process.env.SP_FORCE_LOCAL_REST_API = '1';
  process.env.SP_FORCE_LOCAL_REST_API_TOKEN = 'forced_dev_token_123';

  try {
    updateLocalRestApiConfig({
      misc: {
        isLocalRestApiEnabled: false,
        localRestApiToken: undefined,
      },
    });

    const res = await makeRequest({
      method: 'GET',
      path: '/tasks',
      headers: {
        Authorization: 'Bearer forced_dev_token_123',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalForce === undefined) {
      delete process.env.SP_FORCE_LOCAL_REST_API;
    } else {
      process.env.SP_FORCE_LOCAL_REST_API = originalForce;
    }
    if (originalForceToken === undefined) {
      delete process.env.SP_FORCE_LOCAL_REST_API_TOKEN;
    } else {
      process.env.SP_FORCE_LOCAL_REST_API_TOKEN = originalForceToken;
    }

    updateLocalRestApiConfig({
      misc: {
        isLocalRestApiEnabled: false,
      },
    });
  }
});

test.after(() => {
  // Disable API to shut down server
  updateLocalRestApiConfig({
    misc: {
      isLocalRestApiEnabled: false,
    },
  });
});

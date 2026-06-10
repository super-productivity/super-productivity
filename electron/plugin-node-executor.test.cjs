const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const pluginNodeExecutorModulePath = path.resolve(__dirname, 'plugin-node-executor.ts');

// The executor verifies grants against the on-disk built-in plugin manifest.
// That manifest is a build artifact (only present after the frontend/plugin build),
// so the unit test stubs the manifest read instead of depending on built assets.
const BUILT_IN_PLUGIN_MANIFEST = {
  id: 'sync-md',
  name: 'Sync.md',
  version: '1.0.0',
  permissions: ['nodeExecution'],
};

const isBuiltInManifestPath = (filePath) =>
  typeof filePath === 'string' &&
  filePath.replace(/\\/g, '/').endsWith(`${BUILT_IN_PLUGIN_MANIFEST.id}/manifest.json`);

let ipcHandlers;
let dialogCalls;
let nextDialogResult;
let nextDialogPromise;

class FakeWebContents extends EventEmitter {
  constructor(id, url = 'app://index.html') {
    super();
    this.id = id;
    this._url = url;
    this._isDestroyed = false;
    this.window = { id: `window-${id}` };
  }

  getURL() {
    return this._url;
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  navigate(url) {
    this._url = url;
    this.emit('will-navigate', {}, url);
    this.emit('did-navigate', {}, url);
  }

  startNavigation(url, isInPlace = false, isMainFrame = true) {
    this._url = url;
    this.emit('did-start-navigation', {}, url, isInPlace, isMainFrame);
  }

  destroy() {
    this._isDestroyed = true;
    this.emit('destroyed');
  }
}

const resetModule = () => {
  for (const key of Object.keys(require.cache)) {
    if (
      key === pluginNodeExecutorModulePath ||
      key.endsWith('/electron/plugin-node-executor.ts') ||
      key.endsWith('/electron/plugin-node-executor.js')
    ) {
      delete require.cache[key];
    }
  }
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    // Stub the built-in plugin manifest read, scoped to the executor module so
    // every other `require('fs')` (ts-node, node:test, ...) keeps the real fs.
    if (
      request === 'fs' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('plugin-node-executor.ts')
    ) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        existsSync: (filePath) =>
          isBuiltInManifestPath(filePath) ? true : realFs.existsSync(filePath),
        readFileSync: (filePath, ...rest) =>
          isBuiltInManifestPath(filePath)
            ? JSON.stringify(BUILT_IN_PLUGIN_MANIFEST)
            : realFs.readFileSync(filePath, ...rest),
      };
    }

    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
        },
        BrowserWindow: {
          fromWebContents: (webContents) => webContents.window,
        },
        dialog: {
          showMessageBox: async (...args) => {
            dialogCalls.push(args);
            if (nextDialogPromise) {
              return nextDialogPromise;
            }
            return nextDialogResult;
          },
        },
        ipcMain: {
          handle: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  resetModule();
  return require(pluginNodeExecutorModulePath);
};

const callIpc = (channel, sender, ...args) => {
  const handler = ipcHandlers.get(channel);
  assert.equal(typeof handler, 'function');
  return handler({ sender }, ...args);
};

test.beforeEach(() => {
  ipcHandlers = new Map();
  dialogCalls = [];
  nextDialogResult = { response: 0 };
  nextDialogPromise = undefined;
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  resetModule();
});

test('issues a main-owned token and reuses it for the same webContents', async () => {
  loadModule();
  const webContents = new FakeWebContents(1);

  const firstGrant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  const secondGrant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );

  assert.equal(typeof firstGrant.token, 'string');
  assert.equal(secondGrant.token, firstGrant.token);
  assert.equal(dialogCalls.length, 1);
});

test('requires the issuing webContents and token for script execution', async () => {
  loadModule();
  const webContents = new FakeWebContents(2);
  const otherWebContents = new FakeWebContents(3);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  const result = await callIpc(
    'PLUGIN_EXEC_NODE_SCRIPT',
    webContents,
    'sync-md',
    grant.token,
    { script: 'return args[0] + 1;', args: [1] },
  );

  assert.equal(result.success, true);
  assert.equal(result.result, 2);
  assert.equal(typeof result.executionTime, 'number');
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', otherWebContents, 'sync-md', grant.token, {
        script: 'return true;',
      }),
    /not authorized/,
  );
});

test('does not mint a token when the sender navigates while consent is pending', async () => {
  loadModule();
  const webContents = new FakeWebContents(5);
  let resolveDialog;
  nextDialogPromise = new Promise((resolve) => {
    resolveDialog = resolve;
  });

  const grantPromise = callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  assert.equal(dialogCalls.length, 1);

  webContents.navigate('http://localhost:4200/after-navigation');
  resolveDialog({ response: 0 });

  await assert.doesNotReject(grantPromise);
  assert.equal(await grantPromise, null);
});

test('revoke requires the issuing webContents and token', async () => {
  loadModule();
  const webContents = new FakeWebContents(6);
  const otherWebContents = new FakeWebContents(7);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  await callIpc(
    'PLUGIN_REVOKE_NODE_EXECUTION_GRANT',
    otherWebContents,
    'sync-md',
    grant.token,
  );
  await callIpc('PLUGIN_EXEC_NODE_SCRIPT', webContents, 'sync-md', grant.token, {
    script: 'return true;',
  });

  await callIpc(
    'PLUGIN_REVOKE_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
    grant.token,
  );
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', webContents, 'sync-md', grant.token, {
        script: 'return true;',
      }),
    /not authorized/,
  );
});

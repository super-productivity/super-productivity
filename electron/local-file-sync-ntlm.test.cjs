const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const modulePath = path.resolve(__dirname, 'local-file-sync.ts');

let handlers;
let statCalls;
let readFileCalls;

const resetModule = () => {
  delete require.cache[modulePath];
};

// Mock everything EXCEPT the real `is-external-url-allowed` guard and node `url`,
// so the test exercises the actual UNC / remote-file:// gate end-to-end.
const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        dialog: {},
        app: { getPath: () => '/nonexistent-userdata' },
      };
    }
    if (request === 'electron-log/main') {
      return { error: () => {}, log: () => {} };
    }
    if (request === './main-window') {
      return { getWin: () => ({}) };
    }
    if (/[/\\]file-path-guard$/.test(request)) {
      // Stub the userData-containment guard: this suite verifies only the
      // UNC / remote-file:// gate. Containment is covered by local-file-sync.test.cjs.
      return { assertPathOutside: () => {} };
    }
    if (request === './shared-with-frontend/ipc-events.const') {
      // Any IPC.X resolves to the string 'X'.
      return { IPC: new Proxy({}, { get: (_t, prop) => prop }) };
    }
    if (request === 'fs') {
      const noop = () => undefined;
      return {
        readdirSync: noop,
        readFileSync: noop,
        renameSync: noop,
        statSync: noop,
        writeFileSync: noop,
        unlinkSync: noop,
        promises: {
          stat: async (p) => {
            statCalls.push(p);
            return { size: 4 };
          },
          readFile: async (p) => {
            readFileCalls.push(p);
            return Buffer.from('test');
          },
        },
      };
    }
    return originalModuleLoad.apply(this, [request, parent, isMain]);
  };
};

const loadHandler = () => {
  handlers = new Map();
  statCalls = [];
  readFileCalls = [];
  resetModule();
  installMocks();
  // Mocks stay active through the handler call: the handler resolves `fs` lazily
  // via `await import('fs')`, so it must hit the mock at invocation time too.
  // afterEach restores the original loader.
  require(modulePath).initLocalFileSyncAdapter();
  return handlers.get('READ_LOCAL_IMAGE_AS_DATA_URL');
};

test.afterEach(() => {
  Module._load = originalModuleLoad;
});

test('READ_LOCAL_IMAGE_AS_DATA_URL blocks UNC / remote file:// before any fs access (GHSA-hr87-735w-hfq3)', async () => {
  const handler = loadHandler();
  const blocked = [
    '\\\\host\\share\\x.png',
    '//host/share/x.png',
    'file://host/share/x.png',
    'file://192.168.1.100/share/x.png',
    'file:////host/share/x.png',
  ];
  for (const input of blocked) {
    const result = await handler(null, input);
    assert.equal(result, null, `expected null for ${input}`);
  }
  // The security property: the filesystem was never touched for any blocked path.
  assert.equal(statCalls.length, 0, 'fs.promises.stat must not be called');
  assert.equal(readFileCalls.length, 0, 'fs.promises.readFile must not be called');
});

test('READ_LOCAL_IMAGE_AS_DATA_URL still reads local paths and local file:// URLs', async () => {
  const handler = loadHandler();
  const okPng = await handler(null, '/home/user/img.png');
  assert.ok(okPng.startsWith('data:image/png;base64,'), 'local path should be read');
  assert.equal(statCalls.length, 1);

  const okFileUrl = await handler(null, 'file:///home/user/img.png');
  assert.ok(
    okFileUrl.startsWith('data:image/png;base64,'),
    'local file:// should be read',
  );
});

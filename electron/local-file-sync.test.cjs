/**
 * Security tests for the local file-sync IPC path guards.
 * The handlers must refuse paths inside the app's private dir (userData) — which
 * holds settings/grants/db — while still serving user-chosen sync folders.
 * Run with: npm run test:electron
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modPath = path.resolve(__dirname, 'local-file-sync.ts');
const originalModuleLoad = Module._load;

let handlers = {};
let userDataDir;
let externalDir;

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        app: { getPath: () => userDataDir },
        dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      };
    }
    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }
    if (/[/\\]main-window$/.test(request)) {
      return { getWin: () => ({}) };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const load = () => {
  delete require.cache[modPath];
  handlers = {};
  require(modPath).initLocalFileSyncAdapter();
};

test.beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ud-'));
  externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-'));
  installMocks();
  load();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete require.cache[modPath];
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(externalDir, { recursive: true, force: true });
});

test('FILE_SYNC_SAVE refuses to write inside userData (grant-file forgery guard)', () => {
  const target = path.join(userDataDir, 'simpleSettings');
  const result = handlers['FILE_SYNC_SAVE'](
    {},
    { filePath: target, dataStr: '{"pwn":true}', localRev: null },
  );
  assert.ok(result instanceof Error, 'returns a safe error');
  assert.equal(fs.existsSync(target), false, 'nothing written into userData');
});

test('FILE_SYNC_SAVE still writes to a user-chosen folder outside userData', () => {
  const target = path.join(externalDir, 'main.json');
  const result = handlers['FILE_SYNC_SAVE'](
    {},
    { filePath: target, dataStr: '{"ok":1}', localRev: null },
  );
  assert.ok(!(result instanceof Error), 'no error');
  assert.equal(typeof result, 'string', 'returns a revision string');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":1}');
});

test('FILE_SYNC_SAVE rejects a `..` traversal back into userData', () => {
  const target = path.join(
    externalDir,
    '..',
    path.basename(userDataDir),
    'simpleSettings',
  );
  const result = handlers['FILE_SYNC_SAVE'](
    {},
    { filePath: target, dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
  assert.equal(fs.existsSync(path.join(userDataDir, 'simpleSettings')), false);
});

test('FILE_SYNC_LOAD refuses to read inside userData', () => {
  fs.writeFileSync(path.join(userDataDir, 'secret'), 'topsecret');
  const result = handlers['FILE_SYNC_LOAD'](
    {},
    { filePath: path.join(userDataDir, 'secret'), localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_LOAD reads a user-chosen folder outside userData', () => {
  fs.writeFileSync(path.join(externalDir, 'main.json'), 'hello');
  const result = handlers['FILE_SYNC_LOAD'](
    {},
    { filePath: path.join(externalDir, 'main.json'), localRev: null },
  );
  assert.equal(result.dataStr, 'hello');
});

test('FILE_SYNC_REMOVE refuses to delete inside userData', () => {
  const target = path.join(userDataDir, 'simpleSettings');
  fs.writeFileSync(target, 'keep me');
  const result = handlers['FILE_SYNC_REMOVE']({}, { filePath: target });
  assert.ok(result instanceof Error);
  assert.equal(fs.existsSync(target), true, 'file inside userData not deleted');
});

test('CHECK_DIR_EXISTS refuses a userData path', () => {
  const result = handlers['CHECK_DIR_EXISTS']({}, { dirPath: userDataDir });
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_LIST_FILES refuses a userData path', () => {
  const result = handlers['FILE_SYNC_LIST_FILES']({}, { dirPath: userDataDir });
  assert.ok(result instanceof Error);
});

test('READ_LOCAL_IMAGE_AS_DATA_URL refuses an image inside userData', async () => {
  fs.writeFileSync(path.join(userDataDir, 'secret.png'), 'not-really-png');
  const result = await handlers['READ_LOCAL_IMAGE_AS_DATA_URL'](
    {},
    path.join(userDataDir, 'secret.png'),
  );
  assert.equal(result, null);
});

test('READ_LOCAL_IMAGE_AS_DATA_URL inlines a user image outside userData', async () => {
  fs.writeFileSync(path.join(externalDir, 'bg.png'), 'pngbytes');
  const result = await handlers['READ_LOCAL_IMAGE_AS_DATA_URL'](
    {},
    path.join(externalDir, 'bg.png'),
  );
  assert.match(result, /^data:image\/png;base64,/);
});

test('TO_FILE_URL refuses a path inside userData (no laundering into file://)', () => {
  // toFileUrl is a pure string conversion, but the result is persisted as
  // background-image config and later fed to READ_LOCAL_IMAGE_AS_DATA_URL.
  // Refusing userData paths here keeps the two layers consistent.
  assert.throws(
    () => handlers['TO_FILE_URL']({}, path.join(userDataDir, 'simpleSettings')),
    /protected directory/,
  );
});

test('TO_FILE_URL converts a path outside userData', () => {
  const p = path.join(externalDir, 'bg.png');
  const result = handlers['TO_FILE_URL']({}, p);
  assert.ok(result.startsWith('file://'));
  assert.ok(result.endsWith('/bg.png'));
});

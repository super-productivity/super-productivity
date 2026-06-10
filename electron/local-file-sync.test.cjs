/**
 * Security tests for the local file-sync IPC handlers.
 *
 * Post-issue-#8228 the handlers only accept a `relativePath`; the renderer
 * never supplies an absolute path. The sync folder is owned and persisted
 * main-side (the cache lives at the top of `local-file-sync.ts`) and the
 * relative path is resolved against it via `sync-path-resolver`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modPath = path.resolve(__dirname, 'local-file-sync.ts');
const simpleStorePath = path.resolve(__dirname, 'simple-store.ts');
const syncPathResolverPath = path.resolve(__dirname, 'sync-path-resolver.ts');
const originalModuleLoad = Module._load;

let handlers = {};
let userDataDir;
let externalDir;
let nextDialogResult = { canceled: true, filePaths: [] };

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        app: { getPath: () => userDataDir },
        dialog: {
          showOpenDialog: async () => nextDialogResult,
        },
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

const resetCaches = () => {
  delete require.cache[modPath];
  delete require.cache[simpleStorePath];
  delete require.cache[syncPathResolverPath];
  handlers = {};
};

const load = () => {
  resetCaches();
  require(modPath).initLocalFileSyncAdapter();
};

const configureSyncFolder = async (folder) => {
  // Drive the real PICK_DIRECTORY path so the test exercises the same
  // canonicalize-and-persist code production uses.
  nextDialogResult = { canceled: false, filePaths: [folder] };
  const result = await handlers['PICK_DIRECTORY']({});
  if (result instanceof Error) throw result;
  return result;
};

test.beforeEach(() => {
  userDataDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ud-')));
  externalDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-')));
  installMocks();
  load();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  resetCaches();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(externalDir, { recursive: true, force: true });
});

test('FILE_SYNC_SAVE writes to a user-chosen folder via relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'main.json', dataStr: '{"ok":1}', localRev: null },
  );
  assert.ok(!(result instanceof Error), 'no error');
  assert.equal(typeof result, 'string', 'returns a revision string');
  assert.equal(fs.readFileSync(path.join(externalDir, 'main.json'), 'utf8'), '{"ok":1}');
});

test('FILE_SYNC_SAVE rejects when no sync folder is configured', async () => {
  // No configureSyncFolder() call.
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'main.json', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_SAVE rejects a `..` traversal in the relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: '../escape.json', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
  assert.equal(
    fs.existsSync(path.join(externalDir, '..', 'escape.json')),
    false,
    'nothing written outside the sync folder',
  );
});

test('FILE_SYNC_SAVE rejects an absolute renderer-supplied relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: '/etc/passwd', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_SAVE rejects the sync root and does not create a sibling temp file', async () => {
  await configureSyncFolder(externalDir);
  const siblingTemp = `${externalDir}.tmp`;
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: '', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
  assert.equal(fs.existsSync(siblingTemp), false, 'must not write outside sync root');
});

test('FILE_SYNC_SAVE does not write through a predictable .tmp symlink', async () => {
  await configureSyncFolder(externalDir);
  const outside = path.join(userDataDir, 'outside-target');
  fs.writeFileSync(outside, 'keep');
  try {
    fs.symlinkSync(outside, path.join(externalDir, 'main.json.tmp'), 'file');
  } catch (e) {
    if (process.platform === 'win32') {
      return;
    }
    throw e;
  }

  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'main.json', dataStr: '{"ok":1}', localRev: null },
  );

  assert.ok(!(result instanceof Error), 'normal save should still work');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(externalDir, 'main.json'), 'utf8'), '{"ok":1}');
});

test('PICK_DIRECTORY rejects a folder inside userData', async () => {
  // A folder equal to (or inside) userData is rejected at pick time so the
  // user never ends up with a "configured" folder that resolveSyncPath then
  // denies on every sync op (safe but confusing). Nothing is persisted.
  nextDialogResult = { canceled: false, filePaths: [userDataDir] };
  const result = await handlers['PICK_DIRECTORY']({});
  assert.ok(result instanceof Error);
  assert.equal(
    await handlers['GET_SYNC_FOLDER_PATH']({}),
    null,
    'a userData folder is never persisted',
  );
});

test('FILE_SYNC_SAVE rejects a poisoned userData sync folder (grant-file forgery)', async () => {
  // Belt-and-braces: even if the persisted value ever did collide with
  // userData (bypassing the pick-time guard above), resolveSyncPath refuses
  // any root that equals or lives under userData at every IPC call. Simulate
  // a poisoned store by writing simpleSettings directly BEFORE load() reads
  // it, then assert the attacker payload never lands.
  fs.writeFileSync(
    path.join(userDataDir, 'simpleSettings'),
    JSON.stringify({ syncFolderPath: userDataDir }),
  );
  load(); // re-register handlers so the poisoned store is read fresh

  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'simpleSettings', dataStr: '{"pwn":true}', localRev: null },
  );
  assert.ok(result instanceof Error);
  const stored = fs.readFileSync(path.join(userDataDir, 'simpleSettings'), 'utf8');
  assert.ok(!stored.includes('"pwn":true'), 'attacker payload did not land');
});

test('FILE_SYNC_LOAD reads from the configured sync folder', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(externalDir, 'main.json'), 'hello');
  const result = await handlers['FILE_SYNC_LOAD'](
    {},
    { relativePath: 'main.json', localRev: null },
  );
  assert.equal(result.dataStr, 'hello');
});

test('FILE_SYNC_LOAD rejects an absolute renderer-supplied relativePath', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(userDataDir, 'secret'), 'topsecret');
  const result = await handlers['FILE_SYNC_LOAD'](
    {},
    { relativePath: path.join(userDataDir, 'secret'), localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_REMOVE deletes a file inside the sync folder', async () => {
  await configureSyncFolder(externalDir);
  const target = path.join(externalDir, 'gone.json');
  fs.writeFileSync(target, '{}');
  const result = await handlers['FILE_SYNC_REMOVE']({}, { relativePath: 'gone.json' });
  assert.ok(!(result instanceof Error));
  assert.equal(fs.existsSync(target), false);
});

test('FILE_SYNC_REMOVE rejects traversal outside the sync folder', async () => {
  await configureSyncFolder(externalDir);
  const outside = path.join(externalDir, '..', 'keep');
  fs.writeFileSync(outside, 'do not delete');
  const result = await handlers['FILE_SYNC_REMOVE']({}, { relativePath: '../keep' });
  assert.ok(result instanceof Error);
  assert.equal(fs.existsSync(outside), true);
});

test('CHECK_DIR_EXISTS defaults to the sync root', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['CHECK_DIR_EXISTS']({}, {});
  assert.equal(result, true);
});

test('CHECK_DIR_EXISTS rejects when no sync folder is configured', async () => {
  const result = await handlers['CHECK_DIR_EXISTS']({}, {});
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_LIST_FILES lists the sync root', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(externalDir, 'a.json'), '{}');
  fs.writeFileSync(path.join(externalDir, 'b.json'), '{}');
  const result = await handlers['FILE_SYNC_LIST_FILES']({}, {});
  assert.ok(Array.isArray(result));
  assert.deepEqual(result.sort(), ['a.json', 'b.json']);
});

test('FILE_SYNC_LIST_FILES rejects a subdirectory that escapes the root', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_LIST_FILES']({}, { relativePath: '..' });
  assert.ok(result instanceof Error);
});

test('GET_SYNC_FOLDER_PATH returns null when unconfigured, then the configured path', async () => {
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), null);
  await configureSyncFolder(externalDir);
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), externalDir);
});

test('PICK_DIRECTORY persists the selection main-side', async () => {
  nextDialogResult = { canceled: false, filePaths: [externalDir] };
  const returned = await handlers['PICK_DIRECTORY']({});
  assert.equal(returned, externalDir);
  assert.equal(
    await handlers['GET_SYNC_FOLDER_PATH']({}),
    externalDir,
    'main-side store is updated; renderer does not have to echo back',
  );
});

test('PICK_DIRECTORY surfaces a safe error when persistence fails', async () => {
  // Picker returns a path that no longer exists on disk → realpath throws
  // → PICK_DIRECTORY must return a distinct Error, not undefined, so the
  // renderer doesn't confuse persist-failure with user-cancel.
  const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-gone-'));
  fs.rmSync(gone, { recursive: true, force: true });
  nextDialogResult = { canceled: false, filePaths: [gone] };
  const result = await handlers['PICK_DIRECTORY']({});
  assert.ok(result instanceof Error);
  // Cache must not be poisoned with a non-existent path.
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), null);
});

test('PICK_DIRECTORY returns undefined on user-cancel (distinct from error)', async () => {
  nextDialogResult = { canceled: true, filePaths: [] };
  const result = await handlers['PICK_DIRECTORY']({});
  assert.equal(result, undefined);
});

test('legacy READ_LOCAL_IMAGE_AS_DATA_URL handler is no longer registered', () => {
  // Phase 4: removed entirely. A compromised renderer that still tries this
  // IPC must not find a handler — Electron will reject with "no handler
  // registered for channel" which surfaces to the renderer as a rejection.
  assert.equal(handlers['READ_LOCAL_IMAGE_AS_DATA_URL'], undefined);
});

test('legacy TO_FILE_URL handler is no longer registered', () => {
  assert.equal(handlers['TO_FILE_URL'], undefined);
});

test('legacy IMAGE_CACHE_IMPORT handler is no longer registered', () => {
  // Phase 5: dialog + import are atomic in IMAGE_PICK_AND_IMPORT now.
  // The renderer cannot trigger an image read without a real dialog click.
  assert.equal(handlers['IMAGE_CACHE_IMPORT'], undefined);
});

test('IMAGE_PICK_AND_IMPORT opens dialog, imports the chosen file, returns an id', async () => {
  const picked = path.join(externalDir, 'bg.png');
  fs.writeFileSync(picked, 'pngbytes');
  nextDialogResult = { canceled: false, filePaths: [picked] };

  const imported = await handlers['IMAGE_PICK_AND_IMPORT']({}, undefined);
  assert.ok(imported);
  assert.match(imported.id, /^[a-f0-9]{32}$/);
  const url = await handlers['IMAGE_CACHE_GET_DATA_URL']({}, imported.id);
  assert.match(url, /^data:image\/png;base64,/);
});

test('IMAGE_PICK_AND_IMPORT returns null when the user cancels', async () => {
  nextDialogResult = { canceled: true, filePaths: [] };
  const result = await handlers['IMAGE_PICK_AND_IMPORT']({}, undefined);
  assert.equal(result, null);
});

test('IMAGE_PICK_AND_IMPORT returns a safe Error when validation fails (no path leak)', async () => {
  // File inside userData → importImage returns null → handler returns a
  // safe Error so the renderer can show a snack (vs a silent null for cancel).
  // The error message must not echo back the renderer-picked path.
  const planted = path.join(userDataDir, 'planted.png');
  fs.writeFileSync(planted, 'fake');
  nextDialogResult = { canceled: false, filePaths: [planted] };
  const result = await handlers['IMAGE_PICK_AND_IMPORT']({}, undefined);
  assert.ok(result instanceof Error);
  assert.ok(!String(result.message).includes(planted), 'no path in message');
  assert.equal(result.stack, undefined, 'stack stripped, no main-bundle paths');
});

test('IMAGE_PICK_AND_IMPORT does not delete the prior cached image during replace', async () => {
  const oldPicked = path.join(externalDir, 'old.png');
  fs.writeFileSync(oldPicked, 'oldbytes');
  nextDialogResult = { canceled: false, filePaths: [oldPicked] };
  const oldImport = await handlers['IMAGE_PICK_AND_IMPORT']({}, undefined);
  assert.ok(oldImport);
  const oldCachePath = path.join(userDataDir, 'bg-images', `${oldImport.id}.png`);
  assert.equal(fs.existsSync(oldCachePath), true);

  const newPicked = path.join(externalDir, 'new.png');
  fs.writeFileSync(newPicked, 'newbytes');
  nextDialogResult = { canceled: false, filePaths: [newPicked] };
  const newImport = await handlers['IMAGE_PICK_AND_IMPORT']({});
  assert.ok(newImport);
  assert.notEqual(newImport.id, oldImport.id);
  assert.equal(
    fs.existsSync(oldCachePath),
    true,
    'old file must remain until config persistence makes it unreachable',
  );
});

test('IMAGE_CACHE_GET_DATA_URL returns null for unknown ids', async () => {
  const result = await handlers['IMAGE_CACHE_GET_DATA_URL']({}, 'a'.repeat(32));
  assert.equal(result, null);
});

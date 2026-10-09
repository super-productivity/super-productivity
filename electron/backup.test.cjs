const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const backupModulePath = path.resolve(__dirname, 'backup.ts');

// Windows-shaped so the `.replace('Roaming', ...)` derivation actually fires on
// Linux/macOS CI too — otherwise BACKUP_DIR_WINSTORE would equal BACKUP_DIR and
// every assertion below would pass vacuously.
const USER_DATA = 'C:\\Users\\testuser\\AppData\\Roaming\\superProductivity';
// path.join, like the module under test — the separator is the host's, not '\'.
const BACKUP_DIR = path.join(USER_DATA, 'backups');
const BACKUP_DIR_WINSTORE = BACKUP_DIR.replace(
  'Roaming',
  'Local\\Packages\\53707johannesjo.SuperProductivity_ch45amy23cdv6\\LocalCache\\Roaming',
);

let existingPaths;
let handleHandlers;
let onHandlers;
// fileName -> mtime (ms) served by the mocked readdirSync/statSync
let backupFiles;
let writeFileSyncImpl;
// resolved path -> contents served by the mocked writeFileSync/readFileSync
let storedFiles;
let readPaths;

const resetModule = () => {
  delete require.cache[backupModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => USER_DATA },
        ipcMain: {
          on: (channel, handler) => onHandlers.set(channel, handler),
          handle: (channel, handler) => handleHandlers.set(channel, handler),
        },
      };
    }

    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }

    // Scoped to backup.ts so ts-node / node:test keep the real fs.
    if (
      request === 'fs' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('backup.ts')
    ) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        existsSync: (p) => existingPaths.has(p),
        readdirSync: () => Array.from(backupFiles.keys()),
        statSync: (p) => ({ mtime: new Date(backupFiles.get(path.basename(p))) }),
        mkdirSync: (p) => existingPaths.add(p),
        writeFileSync: (...args) => writeFileSyncImpl(...args),
        readFileSync: (p) => {
          readPaths.push(p);
          return storedFiles.get(path.resolve(p));
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadBackupModule = () => {
  resetModule();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(backupModulePath);
};

test.beforeEach(() => {
  existingPaths = new Set();
  handleHandlers = new Map();
  onHandlers = new Map();
  backupFiles = new Map();
  writeFileSyncImpl = (p, data) => {
    storedFiles.set(path.resolve(p), data);
    backupFiles.set(path.basename(p), Date.now());
  };
  storedFiles = new Map();
  readPaths = [];
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete process.windowsStore;
  resetModule();
});

// Sanity check: without this the Windows-only branches below could never be
// reached on a Linux CI runner and the suite would be green for the wrong reason.
test('derives a distinct Windows Store path from the userData path', () => {
  assert.notEqual(BACKUP_DIR_WINSTORE, BACKUP_DIR);
  assert.match(BACKUP_DIR_WINSTORE, /LocalCache\\Roaming/);
});

test('registers backup writes as a completion-aware IPC handler', () => {
  const { initBackupAdapter } = loadBackupModule();

  initBackupAdapter();

  assert.equal(handleHandlers.has('BACKUP'), true);
  assert.equal(onHandlers.has('BACKUP'), false);
});

test('BACKUP_LIST returns every backup file newest first', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('old.json', 1000);
  backupFiles.set('new.json', 3000);
  backupFiles.set('mid.json', 2000);
  backupFiles.set('notes.txt', 4000);

  const list = handleHandlers.get('BACKUP_LIST')();

  assert.deepEqual(
    list.map((f) => f.name),
    ['new.json', 'mid.json', 'old.json'],
  );
  assert.equal(list[0].path, path.join(BACKUP_DIR, 'new.json'));
  assert.equal(list[0].folder, BACKUP_DIR);
  assert.equal(list[0].created, 3000);
});

test('BACKUP_LIST is empty and BACKUP_IS_AVAILABLE false without a backup dir', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  assert.deepEqual(handleHandlers.get('BACKUP_LIST')(), []);
  assert.equal(handleHandlers.get('BACKUP_IS_AVAILABLE')(), false);
});

test('BACKUP_IS_AVAILABLE returns the newest file', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('old.json', 1000);
  backupFiles.set('new.json', 3000);

  assert.equal(handleHandlers.get('BACKUP_IS_AVAILABLE')().name, 'new.json');
});

test('non-Store builds always get the real backup dir', () => {
  const { getBackupDirForDisplay } = loadBackupModule();

  // Even if a LocalCache dir is left over from a previous Store install.
  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR);
});

// Regression test for #995: a virtualized Store package redirects its writes
// into LocalCache, so showing the plain Roaming path sends the user to a folder
// their backups are not in.
test('Store builds get the LocalCache path when it exists', () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR_WINSTORE);
});

// Regression test for #9209: a non-virtualized Store package writes to the real
// AppData\Roaming, so the LocalCache path does not exist and must not be shown.
test('Store builds fall back to the real backup dir when LocalCache is absent', () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR);

  assert.equal(getBackupDirForDisplay(), BACKUP_DIR);
});

// GHSA-x937-wf3j-88q3: the path comes from the renderer, which runs plugin code.
test('BACKUP rejects with a path-free error when the write fails (#10022)', async () => {
  existingPaths.add(BACKUP_DIR);
  writeFileSyncImpl = (p) => {
    const e = new Error(`ENOSPC: no space left on device, open '${p}'`);
    e.code = 'ENOSPC';
    throw e;
  };
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  // async wrapper: ipcMain.handle rejects the invoke for a sync throw and an
  // async rejection alike, so the test holds either way.
  await assert.rejects(
    async () => handleHandlers.get('BACKUP')({}, { data: {}, maxBackupFiles: 3 }),
    (e) => {
      assert.match(e.message, /^BACKUP failed: Error \(code: ENOSPC\)$/);
      assert.equal(e.code, 'ENOSPC');
      return true;
    },
  );
});

// GHSA-x937-wf3j-88q3: the path comes from the renderer, which runs plugin code.
test('BACKUP_LOAD_DATA refuses paths outside the backup dirs without reading them', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  const loadData = handleHandlers.get('BACKUP_LOAD_DATA');

  for (const outside of [
    path.join(USER_DATA, 'simpleSettings'),
    `${BACKUP_DIR}${path.sep}..${path.sep}simpleSettings`,
    `${BACKUP_DIR}-evil${path.sep}sp-backup.json`,
  ]) {
    assert.throws(
      () => loadData({}, outside),
      /refused path outside backup directory/,
      outside,
    );
  }
  assert.deepEqual(readPaths, []);
});

test('BACKUP_LOAD_DATA reads a backup from the Windows Store dir', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  const storePath = path.join(BACKUP_DIR_WINSTORE, 'sp-backup.json');
  storedFiles.set(path.resolve(storePath), '{"from":"store"}');

  assert.equal(handleHandlers.get('BACKUP_LOAD_DATA')({}, storePath), '{"from":"store"}');
});

test('a backup written by BACKUP restores through BACKUP_LOAD_DATA', () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  const data = { task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'Report' } } } };

  handleHandlers.get('BACKUP')({}, { data });
  const newest = handleHandlers.get('BACKUP_IS_AVAILABLE')();

  assert.deepEqual(
    JSON.parse(handleHandlers.get('BACKUP_LOAD_DATA')({}, newest.path)),
    data,
  );
});

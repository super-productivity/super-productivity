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

// what the mocked app.getPath('userData') returns; tests may change it after import
let userDataPath;
let existingPaths;
let handleHandlers;
let onHandlers;
// fileName -> mtime (ms) served by the mocked readdirSync/statSync
let backupFiles;
// resolved path -> contents served by the mocked writeFileSync/readFileSync
let storedFiles;
let readPaths;
let readFailure;
// overridable per test; defaults to storing into storedFiles
let writeFileSyncImpl;

const resetModule = () => {
  delete require.cache[backupModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => userDataPath },
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
        unlinkSync: (p) => {
          backupFiles.delete(path.basename(p));
          storedFiles.delete(path.resolve(p));
        },
        writeFileSync: (...args) => writeFileSyncImpl(...args),
        readFileSync: (p) => {
          readPaths.push(p);
          if (readFailure) throw readFailure;
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
  userDataPath = USER_DATA;
  existingPaths = new Set();
  handleHandlers = new Map();
  onHandlers = new Map();
  backupFiles = new Map();
  storedFiles = new Map();
  readPaths = [];
  readFailure = null;
  writeFileSyncImpl = (p, data) => {
    storedFiles.set(path.resolve(p), data);
    backupFiles.set(path.basename(p), Date.now());
  };
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

// backup.ts is imported before userData moves (snap common dir in main.ts,
// --user-data-dir in start-app.ts), so the dir must be read at use time (#11049).
test('backups follow a userData path changed after import (#11049)', () => {
  const { initBackupAdapter } = loadBackupModule();
  userDataPath = path.join('home', 'u', 'snap', 'sp', 'common', '.config', 'sp');
  const movedBackupDir = path.join(userDataPath, 'backups');
  initBackupAdapter();

  handleHandlers.get('BACKUP')({}, { data: { a: 1 } });
  const newest = handleHandlers.get('BACKUP_IS_AVAILABLE')();

  assert.ok(existingPaths.has(movedBackupDir));
  assert.equal(newest.folder, movedBackupDir);
  assert.equal(path.dirname(newest.path), movedBackupDir);
  assert.ok(storedFiles.has(path.resolve(newest.path)));
  assert.deepEqual(JSON.parse(handleHandlers.get('BACKUP_LOAD_DATA')({}, newest.path)), {
    a: 1,
  });
});

test('unchanged snapshots keep the newest backup without another write', () => {
  loadBackupModule().initBackupAdapter();
  const backup = handleHandlers.get('BACKUP');
  let writes = 0;
  const write = writeFileSyncImpl;
  writeFileSyncImpl = (...args) => {
    writes++;
    return write(...args);
  };
  const data = { task: { ids: ['synthetic'], entities: {} } };
  backup({}, { data });
  backup({}, { data });
  assert.equal(writes, 1);
});

test('equal-mtime backups preserve the current snapshot with a one-file limit', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 31, 12) });
  loadBackupModule().initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  const data = { task: { ids: ['synthetic'], entities: {} } };
  for (const [name, contents] of [
    ['2026-01-31_080000.json', JSON.stringify(data)],
    ['2026-01-31_090000.json', '{}'],
  ]) {
    backupFiles.set(name, new Date(2026, 0, 31, 10).getTime());
    storedFiles.set(path.resolve(BACKUP_DIR, name), contents);
  }

  handleHandlers.get('BACKUP')({}, { data, maxBackupFiles: 1 });

  assert.equal(backupFiles.size, 1);
  assert.deepEqual([...storedFiles.values()], [JSON.stringify(data)]);
});

test('unchanged daily backups preserve January state after thirty February changes', (t) => {
  const start = new Date(2026, 0, 1).getTime();
  const february = new Date(2026, 1, 1).getTime();
  t.mock.timers.enable({ apis: ['Date'], now: start });
  loadBackupModule().initBackupAdapter();
  const backup = handleHandlers.get('BACKUP');
  const data = { task: { ids: ['synthetic'], entities: {} } };
  let writes = 0;
  const write = writeFileSyncImpl;
  writeFileSyncImpl = (...args) => {
    writes++;
    return write(...args);
  };

  for (let now = start; now < february; now += 5 * 60 * 1000) {
    t.mock.timers.setTime(now);
    backup({}, { data });
  }
  const januaryWrites = writes;
  for (let change = 0; change < 30; change++) {
    t.mock.timers.setTime(february + change * 5 * 60 * 1000);
    backup({}, { data: { task: { ids: [`february-${change}`], entities: {} } } });
  }

  const january31 = [...backupFiles.keys()].find((name) => name.startsWith('2026-01-31'));
  assert.ok(january31, 'the daily retention window must keep the January 31 snapshot');
  assert.equal(
    storedFiles.get(path.resolve(BACKUP_DIR, january31)),
    JSON.stringify(data),
  );
  assert.equal(januaryWrites, 31, 'unchanged calls write once per calendar day');
  assert.equal(writes, 61, 'each February change still writes a backup');
});

test('a changed snapshot is written even if an older backup matches it', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 31, 12) });
  loadBackupModule().initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('2026-01-31_080000.json', 1000);
  backupFiles.set('2026-01-31_090000.json', 2000);
  const data = { task: { ids: ['synthetic'], entities: {} } };
  storedFiles.set(
    path.resolve(BACKUP_DIR, '2026-01-31_080000.json'),
    JSON.stringify(data),
  );
  storedFiles.set(path.resolve(BACKUP_DIR, '2026-01-31_090000.json'), '{}');
  let writes = 0;
  const write = writeFileSyncImpl;
  writeFileSyncImpl = (...args) => {
    writes++;
    return write(...args);
  };
  handleHandlers.get('BACKUP')({}, { data });
  assert.equal(writes, 1);
});

test('an unreadable newest backup does not suppress a new snapshot', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 31, 12) });
  loadBackupModule().initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  backupFiles.set('2026-01-31_090000.json', 2000);
  readFailure = new Error('synthetic unreadable backup');
  let writes = 0;
  const write = writeFileSyncImpl;
  writeFileSyncImpl = (...args) => {
    writes++;
    return write(...args);
  };
  handleHandlers.get('BACKUP')({}, { data: {} });
  assert.equal(writes, 1);
});

test('unchanged snapshots still apply a smaller retention limit', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 31, 12) });
  loadBackupModule().initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  for (const [name, stamp] of [
    ['2026-01-31_080000.json', 1000],
    ['2026-01-31_090000.json', 2000],
    ['2026-01-31_100000.json', 3000],
  ]) {
    backupFiles.set(name, stamp);
    storedFiles.set(path.resolve(BACKUP_DIR, name), '{}');
  }
  let writes = 0;
  writeFileSyncImpl = () => writes++;
  handleHandlers.get('BACKUP')({}, { data: {}, maxBackupFiles: 1 });
  assert.equal(writes, 0);
  assert.deepEqual([...backupFiles.keys()], ['2026-01-31_100000.json']);
});

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

const PICKED_DIR = path.resolve(path.join(path.sep, 'tmp', 'sp-backups'));

let existingPaths;
let handleHandlers;
let onHandlers;
let writtenFiles;
let dirFiles;
let simpleStore;
let openDialogResult;
let openDialogOptions;
let deletedFiles;
let fileMtimes;
let unwritableDirs;
let canonicalPaths;
let storeError;
let renameError;
let renamedFiles;
let statErrors;

const resetModule = () => {
  delete require.cache[backupModulePath];
};

const isBackupModule = (parent) =>
  parent && typeof parent.filename === 'string' && parent.filename.endsWith('backup.ts');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => USER_DATA },
        dialog: {
          showOpenDialog: async (win, options) => {
            openDialogOptions = options;
            return openDialogResult;
          },
        },
        ipcMain: {
          on: (channel, handler) => onHandlers.set(channel, handler),
          handle: (channel, handler) => handleHandlers.set(channel, handler),
        },
      };
    }

    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }

    if (request === './main-window' && isBackupModule(parent)) {
      return { getWin: () => ({}) };
    }

    // In-memory stand-in for the on-disk simpleSettings file, so the picked
    // folder round-trips without writing to the Windows-shaped USER_DATA path.
    if (request === './simple-store' && isBackupModule(parent)) {
      return {
        loadSimpleStoreAll: async () => ({ ...simpleStore }),
        saveSimpleStore: async (dataKey, data) => {
          if (storeError) {
            throw storeError;
          }
          simpleStore[dataKey] = data;
        },
      };
    }

    if (request === 'fs' && parent?.filename.endsWith('file-path-guard.ts')) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        realpathSync: {
          native: (p) => canonicalPaths.get(p) ?? realFs.realpathSync.native(p),
        },
      };
    }

    // Scoped to backup.ts so ts-node / node:test keep the real fs.
    if (request === 'fs' && isBackupModule(parent)) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        existsSync: (p) => existingPaths.has(p),
        // Non-recursive mkdir fails when the parent is gone, which is the only
        // situation the backup code can meet it in (a picked folder always
        // exists at pick time, userData always exists for the default one).
        mkdirSync: (p, options) => {
          if (!options?.recursive && !existingPaths.has(path.dirname(p))) {
            const e = new Error(`ENOENT: no such file or directory, mkdir '${p}'`);
            e.code = 'ENOENT';
            throw e;
          }
          existingPaths.add(p);
        },
        writeFileSync: (p, data) => {
          if (unwritableDirs.has(path.dirname(p))) {
            const e = new Error(`EACCES: permission denied, open '${p}'`);
            e.code = 'EACCES';
            throw e;
          }
          writtenFiles.set(p, data);
        },
        renameSync: (from, to) => {
          if (renameError) {
            throw renameError;
          }
          assert.equal(from.endsWith('.tmp'), true);
          assert.equal(path.dirname(from), path.dirname(to));
          renamedFiles.push([from, to]);
          writtenFiles.set(to, writtenFiles.get(from));
          writtenFiles.delete(from);
        },
        readdirSync: (p) => [...(dirFiles[p] ?? [])],
        readFileSync: (p) => writtenFiles.get(p),
        // No test below depends on the order backup files are listed in,
        // except where fileMtimes gives a file an explicit mtime.
        statSync: (p) => {
          if (statErrors.has(p)) {
            throw statErrors.get(p);
          }
          return { mtime: fileMtimes[p] ?? new Date(0) };
        },
        unlinkSync: (p) => {
          deletedFiles.push(p);
          writtenFiles.delete(p);
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
  // The parents of the folders written to below: userData for the default
  // backup dir, and the picked folder's parent. Both always exist in the real
  // world, and mkdirSync is no longer recursive, so tests that mean "the folder
  // is gone" have to say so by removing the parent (see the #7054 case below).
  existingPaths = new Set([USER_DATA, path.dirname(PICKED_DIR)]);
  handleHandlers = new Map();
  onHandlers = new Map();
  writtenFiles = new Map();
  dirFiles = {};
  simpleStore = {};
  openDialogResult = { canceled: true, filePaths: [] };
  openDialogOptions = undefined;
  deletedFiles = [];
  fileMtimes = {};
  unwritableDirs = new Set();
  canonicalPaths = new Map();
  storeError = undefined;
  renameError = undefined;
  renamedFiles = [];
  statErrors = new Map();
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

test('BACKUP_LIST returns every default-folder JSON backup newest first', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  dirFiles[BACKUP_DIR] = ['old.json', 'new.json', 'mid.json', 'notes.txt'];
  fileMtimes[path.join(BACKUP_DIR, 'old.json')] = new Date(1000);
  fileMtimes[path.join(BACKUP_DIR, 'new.json')] = new Date(3000);
  fileMtimes[path.join(BACKUP_DIR, 'mid.json')] = new Date(2000);
  fileMtimes[path.join(BACKUP_DIR, 'notes.txt')] = new Date(4000);

  const list = await handleHandlers.get('BACKUP_LIST')();

  assert.deepEqual(
    list.map((f) => f.name),
    ['new.json', 'mid.json', 'old.json'],
  );
  assert.equal(list[0].path, path.join(BACKUP_DIR, 'new.json'));
  assert.equal(list[0].folder, BACKUP_DIR);
  assert.equal(list[0].created, 3000);
});

test('BACKUP_LIST is empty and BACKUP_IS_AVAILABLE false without a backup dir', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  assert.deepEqual(await handleHandlers.get('BACKUP_LIST')(), []);
  assert.equal(await handleHandlers.get('BACKUP_IS_AVAILABLE')(), false);
});

test('BACKUP_IS_AVAILABLE returns the newest file', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  dirFiles[BACKUP_DIR] = ['old.json', 'new.json'];
  fileMtimes[path.join(BACKUP_DIR, 'old.json')] = new Date(1000);
  fileMtimes[path.join(BACKUP_DIR, 'new.json')] = new Date(3000);

  assert.equal((await handleHandlers.get('BACKUP_IS_AVAILABLE')()).name, 'new.json');
});

test('BACKUP_LIST in a picked folder includes only automatic backups', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);
  existingPaths.add(PICKED_DIR);
  dirFiles[PICKED_DIR] = [
    '2026-07-28_120000.json',
    'family-budget.json',
    'holiday-photo.png',
  ];

  const list = await handleHandlers.get('BACKUP_LIST')();

  assert.deepEqual(
    list.map((file) => file.name),
    ['2026-07-28_120000.json'],
  );
});

test('backup discovery skips a file removed before stat', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR);
  const removedPath = path.join(BACKUP_DIR, 'gone.json');
  const remainingPath = path.join(BACKUP_DIR, 'older.json');
  dirFiles[BACKUP_DIR] = ['gone.json', 'older.json'];
  statErrors.set(
    removedPath,
    Object.assign(new Error(`ENOENT: no such file or directory, stat '${removedPath}'`), {
      code: 'ENOENT',
    }),
  );
  fileMtimes[remainingPath] = new Date(1000);

  const meta = await handleHandlers.get('BACKUP_IS_AVAILABLE')();

  assert.equal(meta.name, 'older.json');
});

test('non-Store builds always get the real backup dir', async () => {
  const { getBackupDirForDisplay } = loadBackupModule();

  // Even if a LocalCache dir is left over from a previous Store install.
  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR);
});

// Regression test for #995: a virtualized Store package redirects its writes
// into LocalCache, so showing the plain Roaming path sends the user to a folder
// their backups are not in.
test('Store builds get the LocalCache path when it exists', async () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR_WINSTORE);

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR_WINSTORE);
});

// Regression test for #9209: a non-virtualized Store package writes to the real
// AppData\Roaming, so the LocalCache path does not exist and must not be shown.
test('Store builds fall back to the real backup dir when LocalCache is absent', async () => {
  process.windowsStore = true;
  const { getBackupDirForDisplay } = loadBackupModule();

  existingPaths.add(BACKUP_DIR);

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR);
});

const pickFolder = async (folderPath) => {
  // Only an existing folder can come back from the native picker, so a test
  // that means "the folder is gone" has to remove it explicitly.
  existingPaths.add(folderPath);
  openDialogResult = { canceled: false, filePaths: [folderPath] };
  const picked = await handleHandlers.get('PICK_BACKUP_FOLDER')();
  // The pick-time write probe removes its own temp file, so it leaves the
  // written-files bookkeeping clean but shows up as a deletion. Drop that here
  // so the retention assertions below see only what cleanup did; the probe has
  // its own tests.
  deletedFiles.length = 0;
  return picked;
};

// #7054: the backup location was fixed to <userData>/backups, so a user who
// wanted their backups elsewhere had no way to move them.
test('a picked folder becomes the backup folder', async () => {
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();

  assert.equal(await pickFolder(PICKED_DIR), PICKED_DIR);

  assert.equal(await getBackupDirForDisplay(), PICKED_DIR);
  await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 });
  assert.deepEqual(
    [...writtenFiles.keys()].map((p) => path.dirname(p)),
    [PICKED_DIR],
  );
});

test('the picked folder is where restore looks for backups', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  const filePath = path.join(PICKED_DIR, '2026-07-28_120000.json');
  existingPaths.add(PICKED_DIR);
  dirFiles[PICKED_DIR] = ['2026-07-28_120000.json'];
  writtenFiles.set(filePath, '{"stub":true}');

  const meta = await handleHandlers.get('BACKUP_IS_AVAILABLE')();
  assert.equal(meta.folder, PICKED_DIR);
  assert.equal(meta.path, filePath);
  assert.equal(
    await handleHandlers.get('BACKUP_LOAD_DATA')(null, filePath),
    '{"stub":true}',
  );
});

// Regression for #7054: a user-picked folder can hold files that are not
// backups (e.g. an existing Syncthing/Dropbox folder), so cleanup must never
// treat them as candidates just because they end in `.json`.
test('cleanup never deletes non-backup-shaped files, even when they are the oldest', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);
  existingPaths.add(PICKED_DIR);

  const foreignFile = 'family-budget.json';
  const olderBackup = '2026-07-01_090000.json';
  const newerBackup = '2026-07-02_090000.json';
  dirFiles[PICKED_DIR] = [foreignFile, olderBackup, newerBackup];
  fileMtimes[path.join(PICKED_DIR, foreignFile)] = new Date(2020, 0, 1);
  fileMtimes[path.join(PICKED_DIR, olderBackup)] = new Date(2026, 6, 1);
  fileMtimes[path.join(PICKED_DIR, newerBackup)] = new Date(2026, 6, 2);

  await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 1 });

  assert.deepEqual(deletedFiles, [path.join(PICKED_DIR, olderBackup)]);
});

// Regression for #7054: BACKUP_IS_AVAILABLE returned the newest file of any
// kind, so a stray non-backup file could hide the real backup from restore.
test('a non-backup file in the folder does not hide the real backup from restore', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);
  existingPaths.add(PICKED_DIR);

  const realBackupFile = '2026-07-28_120000.json';
  dirFiles[PICKED_DIR] = [realBackupFile, 'holiday-photo.png'];
  writtenFiles.set(path.join(PICKED_DIR, realBackupFile), '{"stub":true}');

  const meta = await handleHandlers.get('BACKUP_IS_AVAILABLE')();
  assert.equal(meta.name, realBackupFile);
});

// Regression for #7054: even a path that passes the directory check must
// still look like a backup filename before BACKUP_LOAD_DATA reads it.
test('refuses to load a non-backup file even inside the picked folder', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  const filePath = path.join(PICKED_DIR, 'holiday-photo.png');
  writtenFiles.set(filePath, 'not json');

  await assert.rejects(() => handleHandlers.get('BACKUP_LOAD_DATA')(null, filePath));
});

// The picked folder is read back by BACKUP_LOAD_DATA, which the renderer (and
// with it untrusted plugin code) can call, so it must stay out of userData.
test('refuses a folder inside the app private dir', async () => {
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();

  await assert.rejects(() => pickFolder(path.join(USER_DATA, 'somewhere')), {
    name: 'PathNotAllowedError',
  });

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR);
});

test('picking the default folder again drops the custom one', async () => {
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  await pickFolder(BACKUP_DIR);

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR);
});

test('a cancelled pick keeps the current backup folder', async () => {
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  openDialogResult = { canceled: true, filePaths: [] };
  assert.equal(await handleHandlers.get('PICK_BACKUP_FOLDER')(), undefined);

  assert.equal(await getBackupDirForDisplay(), PICKED_DIR);
});

// A folder the app cannot write to (Snap/Flatpak confinement, a macOS TCC
// prompt dismissed minutes later, a read-only or disconnected location) would
// otherwise be accepted, shown in the UI as the backup folder, and then every
// backup would fail.
test('refuses a folder that cannot be written to', async () => {
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();
  unwritableDirs.add(PICKED_DIR);

  await assert.rejects(() => pickFolder(PICKED_DIR), {
    name: 'FolderNotWritableError',
  });

  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR);
  assert.equal(simpleStore.backupFolderPath, undefined);
});

test('the write probe leaves no file behind in the picked folder', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  openDialogResult = { canceled: false, filePaths: [PICKED_DIR] };
  await handleHandlers.get('PICK_BACKUP_FOLDER')();

  assert.deepEqual([...writtenFiles.keys()], []);
  assert.equal(deletedFiles.length, 1);
  assert.equal(path.dirname(deletedFiles[0]), PICKED_DIR);
});

// Without a defaultPath the picker opens wherever the OS decides, which makes
// the default folder (a hidden path inside userData that may not even exist
// yet) unreachable in practice, and with it "put it back to the default".
test('the picker opens in the folder backups currently go to', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  await pickFolder(PICKED_DIR);
  assert.equal(openDialogOptions.defaultPath, BACKUP_DIR);
  assert.equal(openDialogOptions.properties.includes('promptToCreate'), false);

  openDialogResult = { canceled: true, filePaths: [] };
  await handleHandlers.get('PICK_BACKUP_FOLDER')();
  assert.equal(openDialogOptions.defaultPath, PICKED_DIR);
});

// A virtualized Store package shows the user the LocalCache path, so that is
// the path they can pick back. Treating it as a custom folder would pin
// backups to LocalCache, and refusing it would reject our own displayed path.
test('Store builds treat the displayed LocalCache path as the default folder', async () => {
  process.windowsStore = true;
  const { initBackupAdapter, getBackupDirForDisplay } = loadBackupModule();
  initBackupAdapter();
  existingPaths.add(BACKUP_DIR_WINSTORE);
  await pickFolder(PICKED_DIR);

  await pickFolder(BACKUP_DIR_WINSTORE);

  assert.equal(simpleStore.backupFolderPath, null);
  assert.equal(await getBackupDirForDisplay(), BACKUP_DIR_WINSTORE);
});

// Regression for #7054: creating the folder recursively would resurrect a
// picked folder whose parent has gone away (Dropbox uninstalled, volume
// ejected) and fill it with backups nothing syncs, while the real backup set
// sits somewhere the app no longer looks. A missing parent has to fail loudly
// into the existing catch instead.
test('a picked folder whose parent has gone away is not re-created', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  const dropbox = path.resolve(path.join(path.sep, 'home', 'me', 'Dropbox'));
  const picked = path.join(dropbox, 'SP-Backups');
  existingPaths.add(dropbox);
  existingPaths.add(picked);
  await pickFolder(picked);

  // Dropbox is uninstalled: both the backup folder and its parent are gone.
  existingPaths.delete(dropbox);
  existingPaths.delete(picked);
  await assert.rejects(() =>
    handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 }),
  );

  assert.deepEqual([...writtenFiles.keys()], []);
  assert.equal(existingPaths.has(picked), false);
});

// Regression for #7054: the existsSync/mkdirSync pair also re-created a picked
// folder whose own parent outlived it — the shape you get whenever the volume
// root is the backup folder (`/Volumes/Backup`, `/media/me/USB`) or the share
// is mounted below a directory that stays behind. Backups would then land on
// the internal disk, invisible to the user and shadowed the moment the real
// location is back, while every write reports success and the last-backup time
// keeps claiming the user is protected.
test('a picked folder that has gone away is not re-created', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  // The volume is ejected: the folder is gone, its parent is not.
  existingPaths.delete(PICKED_DIR);

  await assert.rejects(
    () => handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 }),
    { name: 'BackupFolderGoneError' },
  );
  assert.deepEqual([...writtenFiles.keys()], []);
  assert.equal(existingPaths.has(PICKED_DIR), false);
});

// The refusal above is only for a folder the user picked and that has since
// disappeared. The default one lives inside userData and is legitimately absent
// until the first backup runs, so it must still be created.
test('the default backup folder is still created when missing', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();

  await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 });

  assert.equal(existingPaths.has(BACKUP_DIR), true);
  assert.deepEqual(
    [...writtenFiles.keys()].map((p) => path.dirname(p)),
    [BACKUP_DIR],
  );
});

// A crash between the write and the rename, or a probe file whose unlink
// failed, leaves a file that is deliberately not backup-shaped — so retention
// ignores it and, in a folder the user picked for their own files, nothing
// would ever remove it. Only this app's own names, and only once they are too
// old to belong to an instance still writing.
test('cleanup removes stale temp files this app left behind', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  const orphanTmp = '2026-07-01_090000.json.4242.tmp';
  const orphanProbe = '.sp-backup-probe.4242.0123456789abcdef.tmp';
  const inFlightTmp = '2026-07-02_090000.json.4243.tmp';
  const foreignTmp = 'family-budget.tmp';
  dirFiles[PICKED_DIR] = [orphanTmp, orphanProbe, inFlightTmp, foreignTmp];
  const anHourAndAHalfAgo = new Date(Date.now() - 90 * 60 * 1000);
  fileMtimes[path.join(PICKED_DIR, orphanTmp)] = anHourAndAHalfAgo;
  fileMtimes[path.join(PICKED_DIR, orphanProbe)] = anHourAndAHalfAgo;
  fileMtimes[path.join(PICKED_DIR, foreignTmp)] = anHourAndAHalfAgo;
  fileMtimes[path.join(PICKED_DIR, inFlightTmp)] = new Date();

  await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 });

  assert.deepEqual(
    deletedFiles.sort(),
    [path.join(PICKED_DIR, orphanProbe), path.join(PICKED_DIR, orphanTmp)].sort(),
  );
});

// The read allow-list must follow the live backup folder, not accumulate every
// folder backups have ever been in: BACKUP_IS_AVAILABLE only ever hands out
// paths inside the current one, so a stale default-dir path can only come from
// a caller that is not the legitimate one.
test('refuses a default-dir path once a custom folder is in use', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);

  const stalePath = path.join(BACKUP_DIR, '2026-07-28_120000.json');
  writtenFiles.set(stalePath, '{"stub":true}');

  await assert.rejects(() => handleHandlers.get('BACKUP_LOAD_DATA')(null, stalePath));
});

for (const folder of [BACKUP_DIR, BACKUP_DIR_WINSTORE]) {
  test(`restores legacy daily backups from ${folder}`, async () => {
    const { initBackupAdapter } = loadBackupModule();
    initBackupAdapter();
    existingPaths.add(BACKUP_DIR);
    const fileName = '2025-03-14.json';
    dirFiles[BACKUP_DIR] = [fileName];
    const filePath = path.join(folder, fileName);
    writtenFiles.set(path.resolve(filePath), '{"legacy":true}');

    const meta = await handleHandlers.get('BACKUP_IS_AVAILABLE')();
    assert.equal(meta.name, fileName);
    assert.equal(
      await handleHandlers.get('BACKUP_LOAD_DATA')(null, filePath),
      '{"legacy":true}',
    );
  });
}

test('a picked folder excludes daily filenames from discovery and reads', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);
  existingPaths.add(PICKED_DIR);
  dirFiles[PICKED_DIR] = ['2025-03-14.json'];

  assert.equal(await handleHandlers.get('BACKUP_IS_AVAILABLE')(), false);
  await assert.rejects(() =>
    handleHandlers.get('BACKUP_LOAD_DATA')(
      null,
      path.join(PICKED_DIR, '2025-03-14.json'),
    ),
  );
});

for (const folder of [BACKUP_DIR, PICKED_DIR]) {
  test(`cleanup preserves daily filenames in ${folder}`, async () => {
    const { initBackupAdapter } = loadBackupModule();
    initBackupAdapter();
    if (folder === PICKED_DIR) {
      await pickFolder(folder);
    }
    existingPaths.add(folder);
    dirFiles[folder] = [
      '2025-03-14.json',
      '2026-07-01_090000.json',
      '2026-07-02_090000.json',
    ];

    await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 1 });

    assert.equal(deletedFiles.includes(path.join(folder, '2025-03-14.json')), false);
    assert.equal(deletedFiles.length, 1);
  });
}

test('rejects backup writes when the picked folder becomes unwritable', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  await pickFolder(PICKED_DIR);
  unwritableDirs.add(PICKED_DIR);

  await assert.rejects(() => handleHandlers.get('BACKUP')(null, { data: {} }), {
    code: 'EACCES',
  });
  assert.equal(renamedFiles.length, 0);
  assert.equal(writtenFiles.size, 0);

  unwritableDirs.clear();
  await handleHandlers.get('BACKUP')(null, { data: {} });
  assert.equal(renamedFiles.length, 1);
  assert.equal(writtenFiles.get(renamedFiles[0][1]), '{}');
});

test('rejects a failed rename without publishing a partial backup or pruning', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  renameError = new Error('rename failed');

  await assert.rejects(() => handleHandlers.get('BACKUP')(null, { data: {} }));

  assert.equal(
    [...writtenFiles.keys()].every((p) => p.endsWith('.tmp')),
    true,
  );
  assert.deepEqual(deletedFiles, []);
});

test('stores the canonical picked path', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  const alias = path.resolve('/tmp/sp-backups-alias');
  canonicalPaths.set(alias, PICKED_DIR);

  assert.equal(await pickFolder(alias), PICKED_DIR);
  assert.equal(simpleStore.backupFolderPath, PICKED_DIR);
});

for (const folder of [BACKUP_DIR, BACKUP_DIR_WINSTORE]) {
  test(`resets to default when ${folder} has an alias`, async () => {
    process.windowsStore = true;
    const { initBackupAdapter } = loadBackupModule();
    initBackupAdapter();
    await pickFolder(PICKED_DIR);
    const canonical = path.resolve('/tmp/canonical-user-data/backups');
    canonicalPaths.set(path.resolve(folder), canonical);

    await pickFolder(canonical);

    assert.equal(simpleStore.backupFolderPath, null);
  });
}

test('sanitizes errors when persisting the picked folder fails', async () => {
  const { initBackupAdapter } = loadBackupModule();
  initBackupAdapter();
  storeError = Object.assign(new Error('private filesystem path'), { code: 'EIO' });

  await assert.rejects(
    () => pickFolder(PICKED_DIR),
    (e) => {
      assert.equal(e.code, 'EIO');
      assert.equal(e.message.includes('private filesystem path'), false);
      assert.equal(e.stack, undefined);
      return true;
    },
  );
  assert.equal(simpleStore.backupFolderPath, undefined);
});

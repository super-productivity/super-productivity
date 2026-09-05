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
          simpleStore[dataKey] = data;
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
        readdirSync: (p) => [...(dirFiles[p] ?? [])],
        readFileSync: (p) => writtenFiles.get(p),
        // No test below depends on the order backup files are listed in,
        // except where fileMtimes gives a file an explicit mtime.
        statSync: (p) => ({ mtime: fileMtimes[p] ?? new Date(0) }),
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
// otherwise be accepted, shown in the UI as the backup folder, and then fail
// every backup silently: backupData catches and logs, so nothing surfaces.
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
  await handleHandlers.get('BACKUP')(null, { data: {}, maxBackupFiles: 30 });

  assert.deepEqual([...writtenFiles.keys()], []);
  assert.equal(existingPaths.has(picked), false);
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

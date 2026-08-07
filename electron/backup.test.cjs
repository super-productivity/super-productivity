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
let writtenFiles;
let dirFiles;
let simpleStore;
let openDialogResult;

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
        dialog: { showOpenDialog: async () => openDialogResult },
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
        mkdirSync: (p) => existingPaths.add(p),
        writeFileSync: (p, data) => writtenFiles.set(p, data),
        readdirSync: (p) => [...(dirFiles[p] ?? [])],
        readFileSync: (p) => writtenFiles.get(p),
        // No test below depends on the order backup files are listed in.
        statSync: () => ({ mtime: new Date(0) }),
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
  writtenFiles = new Map();
  dirFiles = {};
  simpleStore = {};
  openDialogResult = { canceled: true, filePaths: [] };
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

const PICKED_DIR = path.resolve(path.join(path.sep, 'tmp', 'sp-backups'));

const pickFolder = async (folderPath) => {
  openDialogResult = { canceled: false, filePaths: [folderPath] };
  return handleHandlers.get('PICK_BACKUP_FOLDER')();
};

// #9342: the backup location was fixed to <userData>/backups, so a user who
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

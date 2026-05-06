const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const fsModule = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const originalWriteFile = fsModule.promises.writeFile;

let userDataDir;
let logCalls = [];
let errorCalls = [];

const simpleStoreModulePath = path.resolve(__dirname, 'simple-store.ts');
const getStorePath = () => path.join(userDataDir, 'simpleSettings');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: (key) => {
            assert.equal(key, 'userData');
            return userDataDir;
          },
        },
      };
    }
    if (request === 'electron-log/main') {
      return {
        log: (...args) => logCalls.push(args),
        error: (...args) => errorCalls.push(args),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModule = () => {
  delete require.cache[simpleStoreModulePath];
};

const loadSimpleStoreModule = () => {
  resetModule();
  return require(simpleStoreModulePath);
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-simple-store-'));
  logCalls = [];
  errorCalls = [];
  fsModule.promises.writeFile = originalWriteFile;
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  fsModule.promises.writeFile = originalWriteFile;
  resetModule();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('loadSimpleStoreAll quarantines corrupt JSON files', async () => {
  const storePath = getStorePath();
  await fs.writeFile(storePath, '{"broken"', 'utf8');

  const { loadSimpleStoreAll } = loadSimpleStoreModule();
  const data = await loadSimpleStoreAll();

  assert.deepEqual(data, {});

  const dirEntries = await fs.readdir(userDataDir);
  const quarantined = dirEntries.find((entry) => entry.startsWith('simpleSettings.corrupt-'));
  assert.ok(quarantined, 'expected corrupt file to be quarantined');
  await assert.rejects(fs.access(storePath));
  assert.ok(
    errorCalls.some(([message]) =>
      String(message).includes('Failed to parse simple store JSON'),
    ),
  );
});

test('saveSimpleStore replaces legacy directories with a file', async () => {
  const storePath = getStorePath();
  await fs.mkdir(storePath, { recursive: true });

  const { saveSimpleStore, loadSimpleStoreAll } = loadSimpleStoreModule();
  await saveSimpleStore('main', { theme: 'dark' });

  const stat = await fs.stat(storePath);
  assert.equal(stat.isFile(), true);
  assert.deepEqual(await loadSimpleStoreAll(), { main: { theme: 'dark' } });
});

test('saveSimpleStore serializes concurrent writes so keys are merged', async () => {
  const { saveSimpleStore, loadSimpleStoreAll } = loadSimpleStoreModule();

  let unblockFirstWrite;
  const firstWriteBlocked = new Promise((resolve) => {
    unblockFirstWrite = resolve;
  });
  let firstWriteSeen = false;

  fsModule.promises.writeFile = async (...args) => {
    const [target] = args;
    if (!firstWriteSeen && String(target).includes('.tmp')) {
      firstWriteSeen = true;
      await firstWriteBlocked;
    }
    return originalWriteFile.apply(fsModule.promises, args);
  };

  const firstSave = saveSimpleStore('alpha', { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  const secondSave = saveSimpleStore('beta', { ok: true });

  unblockFirstWrite();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(await loadSimpleStoreAll(), {
    alpha: { ok: true },
    beta: { ok: true },
  });
});

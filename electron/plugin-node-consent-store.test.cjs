const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const consentStoreModulePath = path.resolve(__dirname, 'plugin-node-consent-store.ts');
const simpleStoreModulePath = path.resolve(__dirname, 'simple-store.ts');

let userDataDir;
const getStorePath = () => path.join(userDataDir, 'simpleSettings');
const readStoreFile = async () => JSON.parse(await fs.readFile(getStorePath(), 'utf8'));

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataDir } };
    }
    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

// Both the consent store and the simple store it wraps hold module-level state (save /
// mutation queues), so reset both caches to get a clean store bound to the new temp dir.
const resetModules = () => {
  delete require.cache[consentStoreModulePath];
  delete require.cache[simpleStoreModulePath];
};

const loadConsentStore = () => {
  resetModules();
  return require(consentStoreModulePath);
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-node-consent-'));
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  resetModules();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('set then get round-trips consent and pins the v1 format on disk', async () => {
  const store = loadConsentStore();
  await store.setNodeExecutionConsent('community.plugin', {
    name: 'Community Plugin',
    version: '1.2.3',
    grantedAt: 1000,
  });

  assert.deepEqual(await store.getNodeExecutionConsent('community.plugin'), {
    name: 'Community Plugin',
    version: '1.2.3',
    grantedAt: 1000,
  });

  // On-disk shape: a top-level version field (the migration anchor) keyed under the
  // dedicated simpleSettings key — never in any pfapi-synced model.
  const onDisk = await readStoreFile();
  assert.equal(onDisk.pluginNodeExecutionConsent.version, 1);
  assert.ok(onDisk.pluginNodeExecutionConsent.consents['community.plugin']);
});

test('get returns null for an unknown plugin id', async () => {
  const store = loadConsentStore();
  assert.equal(await store.getNodeExecutionConsent('never-granted'), null);
});

test('clear removes a persisted consent', async () => {
  const store = loadConsentStore();
  await store.setNodeExecutionConsent('p', { name: 'P', version: '1', grantedAt: 1 });
  await store.clearNodeExecutionConsent('p');
  assert.equal(await store.getNodeExecutionConsent('p'), null);
});

test('clear is a no-op (no throw) when nothing is persisted', async () => {
  const store = loadConsentStore();
  await assert.doesNotReject(() => store.clearNodeExecutionConsent('absent'));
});

test('ignores an on-disk blob with an unknown future version (forward-safe)', async () => {
  // A future client may write version 2+; an older client must re-prompt (treat as
  // empty) rather than mis-read a format it does not understand into a spurious grant.
  await fs.writeFile(
    getStorePath(),
    JSON.stringify({
      pluginNodeExecutionConsent: {
        version: 999,
        consents: { x: { name: 'X', version: '1', grantedAt: 1 } },
      },
    }),
    'utf8',
  );

  const store = loadConsentStore();
  assert.equal(await store.getNodeExecutionConsent('x'), null);
});

test('never treats a prototype-member id as a stored consent', async () => {
  // SECURITY regression: the consents map is keyed on an attacker-controlled pluginId.
  // A plain object would resolve e.g. consents['constructor'] to Object.prototype.constructor
  // (a truthy function), which the executor would mistake for a prior grant and mint a
  // token with NO dialog. A `Map` returns undefined for any unstored key, so reads must
  // return null for every prototype-member id.
  const store = loadConsentStore();
  const protoIds = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];

  for (const id of protoIds) {
    assert.equal(await store.getNodeExecutionConsent(id), null, `fresh store: ${id}`);
  }

  // Persisting a real plugin must not make prototype-member ids start resolving either.
  await store.setNodeExecutionConsent('real-plugin', {
    name: 'Real',
    version: '1',
    grantedAt: 1,
  });
  for (const id of protoIds) {
    assert.equal(
      await store.getNodeExecutionConsent(id),
      null,
      `after a real set: ${id}`,
    );
  }

  // Clearing a prototype-member id is a safe no-op that does not corrupt real entries.
  await store.clearNodeExecutionConsent('constructor');
  assert.deepEqual(await store.getNodeExecutionConsent('real-plugin'), {
    name: 'Real',
    version: '1',
    grantedAt: 1,
  });
});

test('a hand-edited on-disk `__proto__` data key round-trips inertly without polluting Object.prototype', async () => {
  // The store serializes the consents Map via Object.fromEntries and rebuilds it via
  // Object.entries. A maliciously hand-edited file naming a prototype member as a data key
  // must load as an ordinary, ignorable entry — never a prototype write, never a grant.
  await fs.writeFile(
    getStorePath(),
    '{"pluginNodeExecutionConsent":{"version":1,"consents":' +
      '{"__proto__":{"name":"X","version":"1","grantedAt":1},' +
      '"real-plugin":{"name":"Real","version":"1","grantedAt":2}}}}',
    'utf8',
  );

  const store = loadConsentStore();
  // A real (non-prototype) plugin still loads; loading did not pollute Object.prototype.
  assert.deepEqual(await store.getNodeExecutionConsent('real-plugin'), {
    name: 'Real',
    version: '1',
    grantedAt: 2,
  });
  assert.equal({}.name, undefined, 'Object.prototype must not be polluted on load');

  // A subsequent write re-serializes via Object.fromEntries without polluting either.
  await store.setNodeExecutionConsent('another', {
    name: 'A',
    version: '1',
    grantedAt: 3,
  });
  assert.equal({}.name, undefined, 'Object.prototype must not be polluted on save');
  assert.deepEqual(await store.getNodeExecutionConsent('another'), {
    name: 'A',
    version: '1',
    grantedAt: 3,
  });
});

test('keeps other consents when one is cleared', async () => {
  const store = loadConsentStore();
  await store.setNodeExecutionConsent('a', { name: 'A', version: '1', grantedAt: 1 });
  await store.setNodeExecutionConsent('b', { name: 'B', version: '1', grantedAt: 2 });
  await store.clearNodeExecutionConsent('a');

  assert.equal(await store.getNodeExecutionConsent('a'), null);
  assert.deepEqual(await store.getNodeExecutionConsent('b'), {
    name: 'B',
    version: '1',
    grantedAt: 2,
  });
});

test('ignores a malformed on-disk consent entry (presence alone must not authorize)', async () => {
  // SECURITY: mere presence of an entry authorizes execution, so a corrupt/tampered value
  // (empty object, array, or a record missing name/version/grantedAt) must be dropped — the
  // user re-prompts — rather than read as a grant. Only a fully well-formed record loads.
  await fs.writeFile(
    getStorePath(),
    JSON.stringify({
      pluginNodeExecutionConsent: {
        version: 1,
        consents: {
          'empty-object': {},
          'array-entry': [],
          'missing-version': { name: 'P', grantedAt: 1 },
          'non-number-grantedAt': { name: 'P', version: '1', grantedAt: 'soon' },
          'good-plugin': { name: 'Good', version: '1', grantedAt: 5 },
        },
      },
    }),
    'utf8',
  );

  const store = loadConsentStore();
  for (const id of [
    'empty-object',
    'array-entry',
    'missing-version',
    'non-number-grantedAt',
  ]) {
    assert.equal(
      await store.getNodeExecutionConsent(id),
      null,
      `malformed entry ${id} must be ignored`,
    );
  }
  assert.deepEqual(await store.getNodeExecutionConsent('good-plugin'), {
    name: 'Good',
    version: '1',
    grantedAt: 5,
  });
});

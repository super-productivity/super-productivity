const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const pluginNodeExecutorModulePath = path.resolve(__dirname, 'plugin-node-executor.ts');

// The executor verifies grants against the on-disk built-in plugin manifest.
// That manifest is a build artifact (only present after the frontend/plugin build),
// so the unit test stubs the manifest read instead of depending on built assets.
const BUILT_IN_PLUGIN_MANIFEST = {
  id: 'sync-md',
  name: 'Sync.md',
  version: '1.0.0',
  permissions: ['nodeExecution'],
};

const isBuiltInManifestPath = (filePath) =>
  typeof filePath === 'string' &&
  filePath.replace(/\\/g, '/').endsWith(`${BUILT_IN_PLUGIN_MANIFEST.id}/manifest.json`);

let ipcHandlers;
let dialogCalls;
let nextDialogResult;
let nextDialogPromise;
// In-memory stand-in for the main-owned persisted consent store (plugin-node-consent-store.ts),
// so the executor's Phase 2 ask-once logic can be tested without touching the filesystem.
let consentStore;

class FakeWebContents extends EventEmitter {
  constructor(id, url = 'app://index.html') {
    super();
    this.id = id;
    this._url = url;
    this._isDestroyed = false;
    this.window = { id: `window-${id}` };
  }

  getURL() {
    return this._url;
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  navigate(url) {
    this._url = url;
    this.emit('will-navigate', {}, url);
    this.emit('did-navigate', {}, url);
  }

  startNavigation(url, isInPlace = false, isMainFrame = true) {
    this._url = url;
    this.emit('did-start-navigation', {}, url, isInPlace, isMainFrame);
  }

  destroy() {
    this._isDestroyed = true;
    this.emit('destroyed');
  }
}

const resetModule = () => {
  for (const key of Object.keys(require.cache)) {
    if (
      key === pluginNodeExecutorModulePath ||
      key.endsWith('/electron/plugin-node-executor.ts') ||
      key.endsWith('/electron/plugin-node-executor.js')
    ) {
      delete require.cache[key];
    }
  }
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    // Stub the built-in plugin manifest read, scoped to the executor module so
    // every other `require('fs')` (ts-node, node:test, ...) keeps the real fs.
    if (
      request === 'fs' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('plugin-node-executor.ts')
    ) {
      const realFs = originalModuleLoad.call(this, request, parent, isMain);
      return {
        ...realFs,
        existsSync: (filePath) =>
          isBuiltInManifestPath(filePath) ? true : realFs.existsSync(filePath),
        readFileSync: (filePath, ...rest) =>
          isBuiltInManifestPath(filePath)
            ? JSON.stringify(BUILT_IN_PLUGIN_MANIFEST)
            : realFs.readFileSync(filePath, ...rest),
      };
    }

    // Stub the persisted-consent store so Phase 2 ask-once logic is exercised in-memory.
    if (
      request === './plugin-node-consent-store' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.endsWith('plugin-node-executor.ts')
    ) {
      return consentStore;
    }

    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }

    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
        },
        BrowserWindow: {
          fromWebContents: (webContents) => webContents.window,
        },
        dialog: {
          showMessageBox: async (...args) => {
            dialogCalls.push(args);
            if (nextDialogPromise) {
              return nextDialogPromise;
            }
            return nextDialogResult;
          },
        },
        ipcMain: {
          handle: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  resetModule();
  return require(pluginNodeExecutorModulePath);
};

const callIpc = (channel, sender, ...args) => {
  const handler = ipcHandlers.get(channel);
  assert.equal(typeof handler, 'function');
  return handler({ sender }, ...args);
};

test.beforeEach(() => {
  ipcHandlers = new Map();
  dialogCalls = [];
  nextDialogResult = { response: 0 };
  nextDialogPromise = undefined;
  const records = new Map();
  consentStore = {
    __records: records,
    getNodeExecutionConsent: async (pluginId) => records.get(pluginId) ?? null,
    setNodeExecutionConsent: async (pluginId, consent) => {
      records.set(pluginId, consent);
    },
    clearNodeExecutionConsent: async (pluginId) => {
      records.delete(pluginId);
    },
  };
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  resetModule();
});

test('issues a main-owned token and reuses it for the same webContents', async () => {
  loadModule();
  const webContents = new FakeWebContents(1);

  const firstGrant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  const secondGrant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );

  assert.equal(typeof firstGrant.token, 'string');
  assert.equal(secondGrant.token, firstGrant.token);
  assert.equal(dialogCalls.length, 1);
});

test('requires the issuing webContents and token for script execution', async () => {
  loadModule();
  const webContents = new FakeWebContents(2);
  const otherWebContents = new FakeWebContents(3);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  const result = await callIpc(
    'PLUGIN_EXEC_NODE_SCRIPT',
    webContents,
    'sync-md',
    grant.token,
    { script: 'return args[0] + 1;', args: [1] },
  );

  assert.equal(result.success, true);
  assert.equal(result.result, 2);
  assert.equal(typeof result.executionTime, 'number');
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', otherWebContents, 'sync-md', grant.token, {
        script: 'return true;',
      }),
    /not authorized/,
  );
});

test('does not mint a token when the sender navigates while consent is pending', async () => {
  loadModule();
  const webContents = new FakeWebContents(5);
  let resolveDialog;
  nextDialogPromise = new Promise((resolve) => {
    resolveDialog = resolve;
  });

  const grantPromise = callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  assert.equal(dialogCalls.length, 1);

  webContents.navigate('http://localhost:4200/after-navigation');
  resolveDialog({ response: 0 });

  await assert.doesNotReject(grantPromise);
  assert.equal(await grantPromise, null);
});

test('revoke is scoped to the issuing webContents', async () => {
  loadModule();
  const webContents = new FakeWebContents(6);
  const otherWebContents = new FakeWebContents(7);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
  );
  await callIpc(
    'PLUGIN_REVOKE_NODE_EXECUTION_GRANT',
    otherWebContents,
    'sync-md',
    grant.token,
  );
  await callIpc('PLUGIN_EXEC_NODE_SCRIPT', webContents, 'sync-md', grant.token, {
    script: 'return true;',
  });

  await callIpc(
    'PLUGIN_REVOKE_NODE_EXECUTION_GRANT',
    webContents,
    'sync-md',
    grant.token,
  );
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', webContents, 'sync-md', grant.token, {
        script: 'return true;',
      }),
    /not authorized/,
  );
});

test('issues a grant to an uploaded (non-bundled) plugin and labels it unverified', async () => {
  loadModule();
  const webContents = new FakeWebContents(10);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'uploaded-node-plugin',
    { name: 'Uploaded Node Plugin', version: '1.2.3' },
  );

  assert.equal(typeof grant.token, 'string');
  assert.equal(dialogCalls.length, 1);
  const opts = dialogCalls[0][1];
  // Dialog anchors on the validated id and flags the self-declared name as unverified,
  // and defaults to Deny.
  assert.match(opts.detail, /Plugin ID: uploaded-node-plugin/);
  assert.match(opts.detail, /self-declared, unverified/);
  // The Allow is persisted (ask-once), so the prompt must disclose that the choice is
  // remembered rather than claiming it is only valid "for this app session".
  assert.match(opts.detail, /remembered on this device/);
  assert.equal(opts.detail.includes('for this app session'), false);
  assert.equal(opts.defaultId, 1);
});

test('uploaded plugin executes after grant; a denied request leaves exec unauthorized', async () => {
  loadModule();
  const allowWc = new FakeWebContents(11);
  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    allowWc,
    'uploaded-node-plugin',
    { name: 'Uploaded', version: '1.0.0' },
  );
  const okResult = await callIpc(
    'PLUGIN_EXEC_NODE_SCRIPT',
    allowWc,
    'uploaded-node-plugin',
    grant.token,
    { script: 'return args[0] + 1;', args: [4] },
  );
  assert.equal(okResult.success, true);
  assert.equal(okResult.result, 5);

  // A denied request mints no token, so exec stays unauthorized.
  nextDialogResult = { response: 1 };
  const denyWc = new FakeWebContents(12);
  const denied = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    denyWc,
    'denied-plugin',
    { name: 'Denied', version: '1.0.0' },
  );
  assert.equal(denied, null);
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', denyWc, 'denied-plugin', 'made-up-token', {
        script: 'return true;',
      }),
    /not authorized/,
  );
});

test('accepts a non-kebab uploaded id (dots/uppercase) the built-in rule would reject', async () => {
  loadModule();
  const webContents = new FakeWebContents(13);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'Community.Plugin-2',
    { name: 'Community Plugin', version: '2.0.0' },
  );

  assert.equal(typeof grant.token, 'string');
});

test('rejects unsafe ids and sanitizes self-declared display strings', async () => {
  loadModule();
  const webContents = new FakeWebContents(14);

  // A newline in the id is rejected outright (it is a grant Map key + dialog text).
  await assert.rejects(
    () =>
      callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', webContents, 'evil\nid', {
        name: 'x',
        version: '1',
      }),
    /Invalid pluginId/,
  );

  // Path separators / dot-segments are rejected (the id is used as a path component in
  // the bundled-manifest existsSync probe).
  for (const badId of ['../../etc', '..', '.', 'a/b', 'a\\b']) {
    await assert.rejects(
      () =>
        callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', webContents, badId, {
          name: 'x',
          version: '1',
        }),
      /Invalid pluginId/,
    );
  }

  // A crafted name cannot inject an extra dialog line and is length-capped.
  const craftedName = `${'A'.repeat(500)}\nVerified by Super Productivity`;
  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'crafted-name-plugin',
    { name: craftedName, version: '1.0.0' },
  );
  assert.equal(typeof grant.token, 'string');
  const detail = dialogCalls[dialogCalls.length - 1][1].detail;
  assert.equal(detail.includes('Verified by Super Productivity'), false);
  assert.ok(detail.includes('…'));
});

test('revoke from the issuing webContents drops the grant even without the token', async () => {
  loadModule();
  const webContents = new FakeWebContents(15);
  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'uploaded-node-plugin',
    { name: 'Uploaded', version: '1.0.0' },
  );

  // Teardown/re-upload revokes by id without resupplying the token, so a re-uploaded
  // plugin reusing the id cannot inherit this live grant.
  await callIpc(
    'PLUGIN_REVOKE_NODE_EXECUTION_GRANT',
    webContents,
    'uploaded-node-plugin',
    '',
  );
  await assert.rejects(
    () =>
      callIpc(
        'PLUGIN_EXEC_NODE_SCRIPT',
        webContents,
        'uploaded-node-plugin',
        grant.token,
        {
          script: 'return true;',
        },
      ),
    /not authorized/,
  );
});

test('rejects bidi/zero-width/homoglyph and leading-dot ids the allowlist must exclude', async () => {
  loadModule();
  const webContents = new FakeWebContents(16);

  // These are exactly the dialog-anchor spoofing vectors a denylist of explicit Unicode
  // ranges tends to miss; the allowlist rejects every non-[A-Za-z0-9._-] id by construction.
  const badIds = [
    `sync${String.fromCodePoint(0x061c)}md`, // U+061C ARABIC LETTER MARK (bidi)
    `sync${String.fromCodePoint(0x2060)}md`, // U+2060 WORD JOINER (zero-width)
    `sync${String.fromCodePoint(0x3164)}md`, // U+3164 HANGUL FILLER (invisible)
    `${String.fromCodePoint(0xff53)}ync-md`, // U+FF53 fullwidth 's' (homoglyph)
    '.hidden', // leading dot-segment
    '-leading-dash',
    'a b', // whitespace
  ];

  for (const badId of badIds) {
    await assert.rejects(
      () =>
        callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', webContents, badId, {
          name: 'x',
          version: '1',
        }),
      /Invalid pluginId/,
      `expected ${JSON.stringify(badId)} to be rejected`,
    );
  }
});

test('strips bidi/zero-width chars from self-declared display strings', async () => {
  loadModule();
  const webContents = new FakeWebContents(17);

  const name = `Tru${String.fromCodePoint(0x061c)}sted${String.fromCodePoint(0x2060)} Plugin`;
  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'display-sanitize-plugin',
    { name, version: `1.0${String.fromCodePoint(0xfeff)}.0` },
  );

  assert.equal(typeof grant.token, 'string');
  const detail = dialogCalls[dialogCalls.length - 1][1].detail;
  // The control/format chars are gone; the visible text survives.
  assert.equal(detail.includes(String.fromCodePoint(0x061c)), false);
  assert.equal(detail.includes(String.fromCodePoint(0x2060)), false);
  assert.equal(detail.includes(String.fromCodePoint(0xfeff)), false);
  assert.match(detail, /Trusted Plugin/);
});

test('never upgrades trust: an on-disk match that does not cleanly verify uses the unverified dialog', async () => {
  // Simulate a bundled dir whose manifest exists but is not a grantable nodeExecution
  // built-in (here: missing the permission). The verified-built-in branch must return
  // null and fall back to the unverified-uploaded dialog rather than throw or upgrade.
  const originalPermissions = BUILT_IN_PLUGIN_MANIFEST.permissions;
  BUILT_IN_PLUGIN_MANIFEST.permissions = [];
  try {
    loadModule();
    const webContents = new FakeWebContents(18);
    const grant = await callIpc(
      'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
      webContents,
      BUILT_IN_PLUGIN_MANIFEST.id,
      { name: 'Impersonator', version: '9.9.9' },
    );

    assert.equal(typeof grant.token, 'string');
    const opts = dialogCalls[dialogCalls.length - 1][1];
    assert.match(opts.title, /run code on your machine/);
    assert.match(opts.detail, /self-declared, unverified/);
    assert.equal(opts.defaultId, 1);
  } finally {
    BUILT_IN_PLUGIN_MANIFEST.permissions = originalPermissions;
  }
});

// --- Phase 2: persisted, per-plugin consent (#8512) ---

test('uploaded plugin with persisted consent is granted without a dialog (ask-once)', async () => {
  loadModule();
  // Simulate a grant remembered from a previous app session.
  consentStore.__records.set('uploaded-node-plugin', {
    name: 'Uploaded',
    version: '1.0.0',
    grantedAt: 1,
  });
  const webContents = new FakeWebContents(20);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'uploaded-node-plugin',
    { name: 'Uploaded', version: '1.0.0' },
  );

  assert.equal(typeof grant.token, 'string');
  assert.equal(dialogCalls.length, 0);
});

test('granting an uploaded plugin persists consent for the next session', async () => {
  loadModule();
  const webContents = new FakeWebContents(21);

  await callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', webContents, 'persist-me', {
    name: 'Persist Me',
    version: '2.0.0',
  });

  assert.equal(dialogCalls.length, 1);
  const persisted = consentStore.__records.get('persist-me');
  assert.equal(persisted.name, 'Persist Me');
  assert.equal(persisted.version, '2.0.0');
  assert.equal(typeof persisted.grantedAt, 'number');
});

test('denying an uploaded plugin does not persist consent', async () => {
  loadModule();
  nextDialogResult = { response: 1 };
  const webContents = new FakeWebContents(22);

  const denied = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'deny-me',
    { name: 'Deny', version: '1.0.0' },
  );

  assert.equal(denied, null);
  assert.equal(consentStore.__records.has('deny-me'), false);
});

test('clearConsent drops the grant + persisted consent so the next request re-prompts', async () => {
  loadModule();
  const wc1 = new FakeWebContents(23);
  const grant = await callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', wc1, 'clear-me', {
    name: 'Clear',
    version: '1.0.0',
  });
  assert.equal(dialogCalls.length, 1);
  assert.ok(consentStore.__records.has('clear-me'));

  await callIpc('PLUGIN_CLEAR_NODE_EXECUTION_CONSENT', wc1, 'clear-me');
  assert.equal(consentStore.__records.has('clear-me'), false);

  // The live session grant is gone too: exec is now unauthorized.
  await assert.rejects(
    () =>
      callIpc('PLUGIN_EXEC_NODE_SCRIPT', wc1, 'clear-me', grant.token, {
        script: 'return true;',
      }),
    /not authorized/,
  );

  // A fresh request re-prompts because no persisted consent remains.
  const wc2 = new FakeWebContents(24);
  await callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', wc2, 'clear-me', {
    name: 'Clear',
    version: '1.0.0',
  });
  assert.equal(dialogCalls.length, 2);
});

test('rejects prototype-pollution ids before any consent lookup or mint', async () => {
  // SECURITY regression: 'constructor'/'prototype' pass the id allowlist regex and would,
  // against a plain-object consent map, resolve to an Object.prototype member and mint a
  // grant with no dialog. They must be rejected outright. ('__proto__' fails the regex.)
  loadModule();
  const webContents = new FakeWebContents(27);

  for (const badId of ['constructor', 'prototype', '__proto__']) {
    await assert.rejects(
      () =>
        callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', webContents, badId, {
          name: 'x',
          version: '1',
        }),
      /Invalid pluginId/,
      `expected ${badId} to be rejected`,
    );
  }
  assert.equal(dialogCalls.length, 0);
  assert.equal(consentStore.__records.has('constructor'), false);
});

test('built-in plugin consent is never persisted (stays per-session, regression)', async () => {
  loadModule();
  const wc1 = new FakeWebContents(25);
  await callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', wc1, 'sync-md');
  assert.equal(dialogCalls.length, 1);
  // Built-in plugins keep the verified per-session prompt — nothing is written to the
  // persisted store, so a new session prompts again.
  assert.equal(consentStore.__records.has('sync-md'), false);

  const wc2 = new FakeWebContents(26);
  await callIpc('PLUGIN_REQUEST_NODE_EXECUTION_GRANT', wc2, 'sync-md');
  assert.equal(dialogCalls.length, 2);
});

test('mints the grant before persisting consent (persist is best-effort, never gates the grant)', async () => {
  // SECURITY ordering: the consent persist is a new `await` after the post-dialog
  // sender-validity check. Minting BEFORE that write keeps the grant in the live table
  // during the write, so a navigation/destroy cleanup that fires mid-write drops it (in
  // real Electron), and a persist failure can never lose an approved grant. Asserting the
  // grant already exists at the moment of the persist write pins that ordering.
  let grantsSizeAtPersist = -1;
  let mod;
  consentStore.setNodeExecutionConsent = async (pluginId, consent) => {
    grantsSizeAtPersist = mod.pluginNodeExecutor.grants.size;
    consentStore.__records.set(pluginId, consent);
  };
  mod = loadModule();
  const webContents = new FakeWebContents(30);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'uploaded-order',
    { name: 'Uploaded', version: '1.0.0' },
  );

  assert.equal(typeof grant.token, 'string');
  // The grant for this request was already live when the persist ran (mint-before-persist).
  assert.equal(grantsSizeAtPersist, 1);
});

test('a consent persist failure still grants the approved session (best-effort)', async () => {
  // Persisting is best-effort: a write failure only costs a re-prompt next session, never
  // the grant the user just approved. Minting before the persist guarantees this.
  let mod;
  consentStore.setNodeExecutionConsent = async () => {
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  };
  mod = loadModule();
  assert.ok(mod);
  const webContents = new FakeWebContents(31);

  const grant = await callIpc(
    'PLUGIN_REQUEST_NODE_EXECUTION_GRANT',
    webContents,
    'persist-fails',
    { name: 'Uploaded', version: '1.0.0' },
  );

  assert.equal(typeof grant.token, 'string');
  const result = await callIpc(
    'PLUGIN_EXEC_NODE_SCRIPT',
    webContents,
    'persist-fails',
    grant.token,
    { script: 'return 1 + 1;' },
  );
  assert.equal(result.success, true);
  assert.equal(result.result, 2);
});

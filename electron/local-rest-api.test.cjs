const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');
const http = require('node:http');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const localRestApiModulePath = path.resolve(__dirname, 'local-rest-api.ts');

const SHARED_PORT = 3879;
// Isolated copies get a port each. server.close() only releases the socket once
// its callback runs, so reusing one number across tests makes a later test race
// the previous test's shutdown.
let nextIsolatedPort = 3880;
const takeIsolatedPort = () => nextIsolatedPort++;

/**
 * Everything one loaded copy of the module talks to. The module captures its
 * imports once, at require() time, so each copy keeps the context it was loaded
 * with — which is what lets an isolated copy own its own IPC handlers, userData
 * directory, renderer and port without disturbing the shared one.
 */
const createContext = ({ port, userDataDir }) => {
  const ctx = {
    port,
    userDataDir,
    onHandlers: new Map(),
    handleHandlers: new Map(),
    isAppReady: true,
    rendererSendCount: 0,
    // One-shot probe, fired from getIsAppReady(). handleHttpRequest() calls it
    // after the token check and immediately before it starts reading the body,
    // which is the exact window the rotation test has to act in.
    onAuthenticated: null,
    // Paths this copy has fsynced, in order. Crash durability cannot be
    // observed from a test — a power cut is not reproducible here — so the
    // fsync of the token file and of its parent directory is asserted by the
    // call being made at all.
    fsyncedPaths: [],
    // Stands in for a filesystem that does not enforce POSIX modes — a CIFS
    // mount without unix extensions is the documented one, where chmod() is
    // allowed to report success and change nothing. `createPermissiveMode` is
    // the other half of it: there, a file created with mode 0600 still lands
    // group- and world-readable.
    ignoreChmod: false,
    createPermissiveMode: false,
    // Effective mode of the descriptor at each writeFileSync(fd, ...), in order.
    // On POSIX the secret must never reach one whose mode check has not passed.
    writtenAtModes: [],
    // When set to a path, openSync() plants a symlink to it at every `.tmp`
    // path the module opens, at the instant it opens it. That is the
    // perfectly-timed version of pre-planting one: it removes the guessing from
    // the attack, leaving only whether the open refuses an existing entry.
    plantSymlinkOnTempOpen: null,
    // Every `.tmp` path this copy has opened, in order, and how many symlinks
    // the hook above planted. Both are how a test can tell "the temp file was
    // never opened" from "it was opened safely".
    openedTempPaths: [],
    plantedSymlinkCount: 0,
    // Arguments of every warn() this copy made.
    warnings: [],
  };

  ctx.win = {
    webContents: {
      send: (channel, payload) => {
        ctx.rendererSendCount++;
        // Simulate the renderer responding back with a successful IPC response.
        setTimeout(() => {
          const responseHandler = ctx.onHandlers.get('LOCAL_REST_API_RESPONSE');
          if (responseHandler) {
            responseHandler(
              {},
              {
                requestId: payload.requestId,
                status: 200,
                body: { ok: true, data: 'mock_renderer_data' },
              },
            );
          }
        }, 5);
      },
    },
  };

  return ctx;
};

const installMocks = (ctx) => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'fs') {
      // Pass-through except for bookkeeping: fsyncSync() takes a descriptor, so
      // openSync() is wrapped only to remember which path each one came from.
      const actualFs = originalModuleLoad(request, parent, isMain);
      const pathByFd = new Map();
      return {
        ...actualFs,
        openSync: (filePath, flags, mode) => {
          if (String(filePath).endsWith('.tmp')) {
            ctx.openedTempPaths.push(String(filePath));
            if (ctx.plantSymlinkOnTempOpen) {
              actualFs.symlinkSync(ctx.plantSymlinkOnTempOpen, filePath);
              ctx.plantedSymlinkCount++;
            }
          }
          const fd =
            mode !== undefined && ctx.createPermissiveMode
              ? actualFs.openSync(filePath, flags, 0o644)
              : actualFs.openSync(filePath, flags, mode);
          pathByFd.set(fd, String(filePath));
          return fd;
        },
        chmodSync: (filePath, mode) =>
          ctx.ignoreChmod ? undefined : actualFs.chmodSync(filePath, mode),
        fchmodSync: (fd, mode) =>
          ctx.ignoreChmod ? undefined : actualFs.fchmodSync(fd, mode),
        fsyncSync: (fd) => {
          ctx.fsyncedPaths.push(pathByFd.get(fd));
          return actualFs.fsyncSync(fd);
        },
        writeFileSync: (target, data, options) => {
          if (typeof target === 'number') {
            ctx.writtenAtModes.push(actualFs.fstatSync(target).mode & 0o777);
          }
          return actualFs.writeFileSync(target, data, options);
        },
      };
    }

    if (request === 'electron') {
      return {
        app: {
          getPath: () => ctx.userDataDir,
        },
        ipcMain: {
          on: (eventName, handler) => {
            ctx.onHandlers.set(eventName, handler);
          },
          handle: (eventName, handler) => {
            ctx.handleHandlers.set(eventName, handler);
          },
        },
      };
    }

    if (request === 'electron-log/main') {
      return {
        log: () => {},
        // Kept, not discarded: the Error this copy warned with is the only
        // place a test can read *why* a persist failed.
        warn: (...args) => {
          ctx.warnings.push(args);
        },
      };
    }

    if (request.endsWith('main-window') || request.endsWith('main-window.ts')) {
      return {
        getIsAppReady: () => {
          const probe = ctx.onAuthenticated;
          ctx.onAuthenticated = null;
          if (probe) {
            probe();
          }
          return ctx.isAppReady;
        },
        getWin: () => ctx.win,
      };
    }

    if (
      request.endsWith('local-rest-api.model') ||
      request.endsWith('local-rest-api.model.ts')
    ) {
      const actual = originalModuleLoad(request, parent, isMain);
      return {
        ...actual,
        LOCAL_REST_API_PORT: ctx.port, // Non-colliding port for testing.
      };
    }

    return originalModuleLoad(request, parent, isMain);
  };
};

const uninstallMocks = () => {
  Module._load = originalModuleLoad;
};

/** Loads a fresh copy of the module bound to `ctx`, with its own module state. */
const loadModule = (ctx) => {
  const resolved = require.resolve(localRestApiModulePath);
  installMocks(ctx);
  delete require.cache[resolved];
  const loaded = require(localRestApiModulePath);
  // Dropping it again keeps the next load genuinely cold.
  delete require.cache[resolved];
  uninstallMocks();
  return loaded;
};

// Isolated userData dir so the persisted token file never touches a real profile.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-test-'));
const tokenFilePath = path.join(userDataDir, 'local-rest-api-token');

const sharedCtx = createContext({ port: SHARED_PORT, userDataDir });
const { initLocalRestApi, updateLocalRestApiConfig } = loadModule(sharedCtx);

const enableApi = () =>
  updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });
const disableApi = () =>
  updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
const getToken = () => sharedCtx.handleHandlers.get('LOCAL_REST_API_GET_TOKEN')();
const regenerateToken = () =>
  sharedCtx.handleHandlers.get('LOCAL_REST_API_REGENERATE_TOKEN')();

/**
 * Yields the event loop so a pending listen() callback can run. Teardown needs
 * it: `isListening` only flips inside that callback, and stopServer() returns
 * early while it is false — so disabling in the same tick as the enable closes
 * nothing and leaves the socket bound for the rest of the process. A test whose
 * assertion fails before it awaits anything would otherwise hang the run
 * instead of reporting the failure.
 */
const settleListen = () => new Promise((resolve) => setTimeout(resolve, 0));

const collectResponse = (res, resolve) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
  });
};

const makeRequest = (options, body, port = SHARED_PORT) => {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) =>
      collectResponse(res, resolve),
    );
    req.on('error', (err) => reject(err));
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

/**
 * Sends the headers and the first byte of the body, then hands back a `finish`
 * that sends the rest — so a test can act in the gap between "request
 * authenticated" and "request executed".
 */
const makeSplitBodyRequest = (options, body, port = SHARED_PORT) => {
  const payload = JSON.stringify(body);
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        ...options,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => collectResponse(res, resolve),
    );
    req.on('error', (err) => reject(err));
    req.write(payload.slice(0, 1));
    finish = () => req.end(payload.slice(1));
  });
  return { response, finish: () => finish() };
};

test.before(() => {
  initLocalRestApi();
});

// MUST run before anything else touches getToken(): that IPC handler calls
// ensureToken() itself, so a test that mints through the getter would pass even
// if enabling minted nothing. This one reads the credential off disk instead,
// which is the only way it fails when the mint is removed from
// updateLocalRestApiConfig() — the round-2 blocker it guards.
test('enabling the API alone mints a live, persisted token', async () => {
  enableApi();
  assert.ok(fs.existsSync(tokenFilePath), 'no token file after enableApi()');

  const fromDisk = fs.readFileSync(tokenFilePath, 'utf8').trim();
  assert.match(fromDisk, /^[A-Za-z0-9]{32}$/);

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${fromDisk}` },
  });
  assert.equal(res.status, 200, 'server did not accept the on-disk token');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data, 'mock_renderer_data');
});

test('enabling the API registers get/regenerate IPC handlers', () => {
  enableApi();
  assert.ok(sharedCtx.handleHandlers.has('LOCAL_REST_API_GET_TOKEN'));
  assert.ok(sharedCtx.handleHandlers.has('LOCAL_REST_API_REGENERATE_TOKEN'));
});

test('getToken returns the same token that was minted on enable', () => {
  enableApi();
  assert.equal(getToken(), fs.readFileSync(tokenFilePath, 'utf8').trim());
});

test('the token is persisted to a 0600 file under userData', () => {
  enableApi();
  const token = getToken();
  assert.ok(fs.existsSync(tokenFilePath));
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), token);
  if (process.platform !== 'win32') {
    // Owner read/write only.
    assert.equal(fs.statSync(tokenFilePath).mode & 0o777, 0o600);
  }
});

test('GET /health needs no token', async () => {
  enableApi();
  const res = await makeRequest({ method: 'GET', path: '/health' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.server, 'up');
});

// RFC 7235 requires a challenge on every 401, and the message is the only
// guidance a script written against the pre-token API ever sees.
const assertUnauthorized = (res, messagePrefix) => {
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(res.headers['www-authenticate'], 'Bearer');
  assert.match(res.body.error.message, messagePrefix);
  assert.match(res.body.error.message, /Settings → Misc → Access Token/);
};

test('request without Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({ method: 'GET', path: '/tasks' });
  assertUnauthorized(res, /^Authorization token required/);
});

test('request with malformed Authorization header returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  });
  assertUnauthorized(res, /^Authorization token required/);
});

test('request with wrong token returns 401', async () => {
  enableApi();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: 'Bearer wrong_token' },
  });
  assertUnauthorized(res, /^Invalid authorization token/);
});

test('the Bearer scheme is case-insensitive (RFC 7235)', async () => {
  enableApi();
  const token = getToken();
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

// The header used to be split with /^Bearer +(.+)$/i, whose two space-matching
// parts made it quadratic in the number of spaces. This pins the grammar the
// replacement has to keep — a run of spaces separates the scheme from the
// credential, and a header with nothing after them is not a credential. It does
// not time the parse: at Node's 16 KB header cap the quadratic version is still
// fast enough that any threshold would be a coin flip on a loaded CI runner.
test('a long run of spaces separates the scheme from the credential', async () => {
  enableApi();
  const token = getToken();
  const padding = ' '.repeat(5000);

  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer${padding}${token}` },
  });
  assert.equal(res.status, 200);

  const empty = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer${padding}` },
  });
  assert.equal(empty.status, 401);
});

test('regenerating invalidates the previous token immediately', async () => {
  enableApi();
  const oldToken = getToken();
  const newToken = regenerateToken();
  assert.notEqual(oldToken, newToken);
  assert.match(newToken, /^[A-Za-z0-9]{32}$/);
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), newToken);

  const oldRes = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  assert.equal(oldRes.status, 401);

  const newRes = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${newToken}` },
  });
  assert.equal(newRes.status, 200);
});

// "Invalidates the previous token immediately" has to cover the request that
// was authenticated but not yet executed, otherwise someone holding a leaked
// token can bank mutating requests — open the body, wait for the rotation they
// expect, then commit them. Node gives them 300s of request-body timeout to do
// it in, and the renderer's own 15s timeout only starts after forwarding.
test('rotating the token rejects a request whose body was still arriving', async () => {
  enableApi();
  const oldToken = getToken();
  const sendsBefore = sharedCtx.rendererSendCount;

  const authenticated = new Promise((resolve) => {
    sharedCtx.onAuthenticated = resolve;
  });
  const banked = makeSplitBodyRequest(
    {
      method: 'POST',
      path: '/tasks',
      headers: { Authorization: `Bearer ${oldToken}` },
    },
    { title: 'banked before rotation' },
  );

  await authenticated;
  const newToken = regenerateToken();
  assert.notEqual(oldToken, newToken);
  banked.finish();

  const res = await banked.response;
  assertUnauthorized(res, /^Invalid authorization token/);
  assert.equal(
    sharedCtx.rendererSendCount,
    sendsBefore,
    'the rotated-away request still reached the renderer',
  );
});

test('a request that completes without a rotation is unaffected', async () => {
  enableApi();
  const token = getToken();
  const banked = makeSplitBodyRequest(
    {
      method: 'POST',
      path: '/tasks',
      headers: { Authorization: `Bearer ${token}` },
    },
    { title: 'no rotation' },
  );
  banked.finish();

  const res = await banked.response;
  assert.equal(res.status, 200);
  assert.equal(res.body.data, 'mock_renderer_data');
});

test('a failed persist leaves the old token live instead of silently un-revoking it', async () => {
  enableApi();
  const liveToken = getToken();
  const onDiskBefore = fs.readFileSync(tokenFilePath, 'utf8').trim();

  // Stand in for any write failure — disk full, EACCES, read-only mount, AV
  // lock — by pointing userData at a directory that does not exist.
  sharedCtx.userDataDir = path.join(userDataDir, 'nope');
  let regenerateThrew = false;
  try {
    regenerateToken();
  } catch {
    regenerateThrew = true;
  } finally {
    sharedCtx.userDataDir = userDataDir;
  }
  assert.ok(
    regenerateThrew,
    'regenerateToken() reported success even though the token was never stored',
  );

  // The old token is still the one on disk *and* the one in memory, so nothing
  // was revoked and nothing comes back to life on the next launch.
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), onDiskBefore);
  const res = await makeRequest({
    method: 'GET',
    path: '/tasks',
    headers: { Authorization: `Bearer ${liveToken}` },
  });
  assert.equal(res.status, 200, 'the un-rotated token should still work');
});

test('a corrupted token file is replaced instead of becoming the credential', () => {
  // Cold start against a truncated file, e.g. a write interrupted by a crash.
  const coldProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-cold-'));
  const coldTokenFilePath = path.join(coldProfileDir, 'local-rest-api-token');
  fs.writeFileSync(coldTokenFilePath, 'trunc', { mode: 0o600 });

  try {
    // No initLocalRestApi(): this copy registers no IPC handlers and starts no
    // server, it only has to answer what a fresh app does with this file.
    const cold = loadModule(
      createContext({ port: takeIsolatedPort(), userDataDir: coldProfileDir }),
    );
    cold.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });
    assert.match(fs.readFileSync(coldTokenFilePath, 'utf8').trim(), /^[A-Za-z0-9]{32}$/);
  } finally {
    fs.rmSync(coldProfileDir, { recursive: true, force: true });
  }
});

test('the persisted file is left at 0600 even if it already existed as 0644', () => {
  if (process.platform === 'win32') {
    return;
  }
  enableApi();
  getToken();
  fs.chmodSync(tokenFilePath, 0o644);

  const rotated = regenerateToken();
  assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), rotated);
  assert.equal(fs.statSync(tokenFilePath).mode & 0o777, 0o600);

  // Positive control for the negative assertion further down: that one passes
  // on an empty `writtenAtModes`, so it would also pass if the probe silently
  // stopped recording. Here the writes are the ordinary ones this file has
  // already made, and every one of them has to have gone into a 0600
  // descriptor.
  assert.ok(
    sharedCtx.writtenAtModes.length > 0,
    'the write-mode probe recorded nothing, so it is no longer wired up',
  );
  assert.deepEqual([...new Set(sharedCtx.writtenAtModes)], [0o600]);
});

// A valid token in a group/world-readable file is the case regeneration never
// sees: the app just reads it and serves. Tighten it on load instead of leaving
// the credential readable until the user happens to press Regenerate.
test('a cold start repairs the mode of a readable token file without rotating it', () => {
  if (process.platform === 'win32') {
    return;
  }
  const coldProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-cold-'));
  const coldTokenFilePath = path.join(coldProfileDir, 'local-rest-api-token');
  const existingToken = 'a'.repeat(32);
  fs.writeFileSync(coldTokenFilePath, existingToken, { mode: 0o644 });

  try {
    const cold = loadModule(
      createContext({ port: takeIsolatedPort(), userDataDir: coldProfileDir }),
    );
    cold.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    // Still the user's token — scripts keep working — but no longer readable by
    // every account on the machine.
    assert.equal(fs.readFileSync(coldTokenFilePath, 'utf8').trim(), existingToken);
    assert.equal(fs.statSync(coldTokenFilePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(coldProfileDir, { recursive: true, force: true });
  }
});

// chmod() is allowed to report success and change nothing — the Samba docs say
// so for a CIFS mount without unix extensions. Reading the mode back is the only
// way to know, and without it the two tests above pass while the credential
// stays readable by every account on the machine.
test('a token whose mode cannot actually be restricted is not served', () => {
  if (process.platform === 'win32') {
    return;
  }
  const coldProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-nochmod-'));
  const coldTokenFilePath = path.join(coldProfileDir, 'local-rest-api-token');
  const existingToken = 'b'.repeat(32);
  fs.writeFileSync(coldTokenFilePath, existingToken, { mode: 0o644 });

  try {
    const ctx = createContext({ port: takeIsolatedPort(), userDataDir: coldProfileDir });
    ctx.ignoreChmod = true;
    const cold = loadModule(ctx);
    cold.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    // The repair silently did nothing, so the readable token has to be dropped
    // rather than kept as the live credential.
    const onDisk = fs.readFileSync(coldTokenFilePath, 'utf8').trim();
    assert.notEqual(onDisk, existingToken, 'a world-readable token stayed live');
    assert.match(onDisk, /^[A-Za-z0-9]{32}$/);
    assert.equal(fs.statSync(coldTokenFilePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(coldProfileDir, { recursive: true, force: true });
  }
});

// And the same on the write path: a filesystem that ignores the mode entirely
// creates the file group/world-readable and fchmod() cannot fix it, so there is
// nowhere safe to keep the credential. Fail the enable instead of serving from
// a file the whole machine can read.
test('enabling fails closed when the token file cannot be made private', async () => {
  if (process.platform === 'win32') {
    return;
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-nomode-'));
  const tokenPath = path.join(profileDir, 'local-rest-api-token');
  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: profileDir });
  ctx.ignoreChmod = true;
  ctx.createPermissiveMode = true;
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    await assert.rejects(
      makeRequest({ method: 'GET', path: '/health' }, undefined, port),
      /ECONNREFUSED/,
      'the API came up with a token it could not keep private',
    );
    assert.equal(
      fs.existsSync(tokenPath),
      false,
      'a world-readable token file was left behind',
    );
    // That assertion cannot see the window this closes: it names the final
    // path, which the failed rename never creates, while the secret would have
    // gone into the sibling temp file. Nothing else asserts that temp file is
    // cleaned up either, so check the directory is left empty.
    assert.deepEqual(
      fs.readdirSync(profileDir),
      [],
      'the temp file that holds the token was left behind',
    );
    // And that the secret never reached a readable descriptor in the first
    // place, which is the property the write order exists for. POSIX only —
    // the Windows branch has no mode check, and this test returns early there.
    assert.deepEqual(
      ctx.writtenAtModes.filter((mode) => (mode & 0o077) !== 0),
      [],
      `the token was written into a descriptor other accounts can read (modes seen: ${JSON.stringify(
        ctx.writtenAtModes.map((m) => '0' + m.toString(8)),
      )})`,
    );
  } finally {
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

// The mode check above protects the token from being *read*. The temp path
// protects the machine from what the write itself can be aimed at: anything
// able to create an entry in the profile directory can put a symlink where the
// token is about to be written, and an open that follows it turns a credential
// write into a write to a file of someone else's choosing.
//
// The two halves of the fix fail this test differently, which is the point of
// asserting both outcomes below: with the old `<path>.<pid>.tmp` name and a
// following open, the planted symlink is written through; with that name and an
// exclusive open, nothing is clobbered but the enable is blocked until someone
// deletes the entry by hand. Only an unguessable name gives both.
test('an entry at the old predictable temp path cannot redirect or block the write', async () => {
  if (process.platform === 'win32') {
    return;
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-symlink-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-outside-'));
  const outsidePath = path.join(outsideDir, 'victim');
  const outsideContent = 'do not clobber me';
  fs.writeFileSync(outsidePath, outsideContent, { mode: 0o600 });
  const tokenPath = path.join(profileDir, 'local-rest-api-token');
  // The name the temp file used to carry. Guessing it needed nothing but the
  // pid, which is not a secret.
  fs.symlinkSync(outsidePath, `${tokenPath}.${process.pid}.tmp`);

  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: profileDir });
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    assert.equal(
      fs.readFileSync(outsidePath, 'utf8'),
      outsideContent,
      'the token was written through the planted symlink, outside the profile',
    );
    assert.equal(
      fs.existsSync(tokenPath),
      true,
      'the planted entry blocked the enable, so the temp name is still guessable',
    );
    // And the credential is a real file here, not the renamed symlink — which
    // would redirect every later read and rotation to the attacker's path.
    assert.equal(fs.lstatSync(tokenPath).isSymbolicLink(), false);
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    assert.match(token, /^[A-Za-z0-9]{32}$/);

    // Awaiting a request is also what lets the teardown below actually stop the
    // server: isListening only flips inside listen()'s callback, so a disable
    // in the same tick as the enable finds it still false and closes nothing.
    const authed = await makeRequest(
      { method: 'GET', path: '/tasks', headers: { Authorization: `Bearer ${token}` } },
      undefined,
      port,
    );
    assert.equal(authed.status, 200, 'the token that survived the symlink is not live');

    // Avoiding one known name is not the property being claimed. Rotate twice
    // and require every temp path to differ: a name that is merely *different*
    // from the old one, `<token>.fixed.tmp` say, passes everything above and is
    // just as pre-plantable.
    ctx.handleHandlers.get('LOCAL_REST_API_REGENERATE_TOKEN')();
    ctx.handleHandlers.get('LOCAL_REST_API_REGENERATE_TOKEN')();
    assert.ok(
      ctx.openedTempPaths.length >= 3,
      `expected one temp file per write, saw ${ctx.openedTempPaths.length}`,
    );
    assert.equal(
      new Set(ctx.openedTempPaths).size,
      ctx.openedTempPaths.length,
      `the temp path repeats across writes, so it is derived rather than random: ${JSON.stringify(
        ctx.openedTempPaths.map((p) => path.basename(p)),
      )}`,
    );
  } finally {
    await settleListen();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// An unguessable name makes that attack impractical rather than impossible, so
// the open refuses an existing entry as well. This test hands the attacker the
// name for free — the symlink appears at the exact path, at the exact moment —
// which is the only way to observe the flag rather than the name.
test('the temp file is opened exclusively, so a name that is guessed anyway fails closed', async () => {
  if (process.platform === 'win32') {
    return;
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-excl-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-excl-out-'));
  const outsidePath = path.join(outsideDir, 'victim');
  const outsideContent = 'do not clobber me either';
  fs.writeFileSync(outsidePath, outsideContent, { mode: 0o600 });
  const tokenPath = path.join(profileDir, 'local-rest-api-token');

  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: profileDir });
  ctx.plantSymlinkOnTempOpen = outsidePath;
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    assert.equal(
      fs.readFileSync(outsidePath, 'utf8'),
      outsideContent,
      'the token was written through the planted symlink, outside the profile',
    );
    // Failing closed, like every other case where the token cannot be stored
    // safely: no server, and nothing left behind in the profile.
    await assert.rejects(
      makeRequest({ method: 'GET', path: '/health' }, undefined, port),
      /ECONNREFUSED/,
      'the API came up with a token it could not store safely',
    );
    // Subsumes existsSync(tokenPath): the failed write left nothing at all.
    assert.deepEqual(fs.readdirSync(profileDir), []);
    // Every assertion above also holds if the module never opened a temp file
    // at all — a persistToken() that threw on its first line would pass them.
    // The hook only fires from inside openSync(), so this says the attempt was
    // made.
    assert.ok(
      ctx.plantedSymlinkCount > 0,
      'no temp file was ever opened, so this test proves nothing about the open',
    );
    // And this says the *exclusive* open is what refused it. "Fails closed" is
    // reachable by other means — an open that succeeds and a write that then
    // fails also leaves the victim untouched and no server running — so pin
    // the reason rather than the outcome.
    const causes = ctx.warnings.map(([, error]) => error && error.code);
    assert.ok(
      causes.includes('EEXIST'),
      `the write failed for some reason other than the planted entry: ${JSON.stringify(causes)}`,
    );
  } finally {
    await settleListen();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// rename() makes the *content* atomic, but on POSIX the new directory entry
// only survives a power cut once the directory itself has been fsynced.
test('persisting a token fsyncs the file and the directory entry', () => {
  if (process.platform === 'win32') {
    return; // No directory fsync there — see fsyncDirectory().
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-fsync-'));
  const ctx = createContext({ port: takeIsolatedPort(), userDataDir: profileDir });
  const cold = loadModule(ctx);

  try {
    ctx.fsyncedPaths.length = 0;
    cold.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    assert.ok(
      ctx.fsyncedPaths.some((p) => p && p.endsWith('.tmp')),
      `the token file itself was never fsynced (got ${JSON.stringify(ctx.fsyncedPaths)})`,
    );
    assert.ok(
      ctx.fsyncedPaths.includes(profileDir),
      `the directory entry was never fsynced (got ${JSON.stringify(ctx.fsyncedPaths)})`,
    );
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

// The directory fsync that makes the rename crash-durable is best effort: the
// token is already on disk by then, so a filesystem that will not fsync a
// directory must not turn a completed write into a failed one. Stand in for
// that with a userData directory this process may write to but not open for
// reading, which is what fsyncing a directory needs.
test('a directory that cannot be fsynced does not fail the write', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    return; // No POSIX modes, or running as root, which ignores them.
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-nofsync-'));
  const tokenPath = path.join(profileDir, 'local-rest-api-token');
  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: profileDir });
  const isolated = loadModule(ctx);

  try {
    fs.chmodSync(profileDir, 0o300); // write + search, no read
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    // Not merely "the file is there" — the rename already happened by the time
    // the fsync runs, so the file exists either way. What a rethrown fsync
    // error would cost is the enable itself: ensureToken() would throw and the
    // API would fail closed over a write that actually succeeded.
    const health = await makeRequest({ method: 'GET', path: '/health' }, undefined, port);
    assert.equal(health.status, 200, 'a non-fsyncable directory failed the enable');
    fs.chmodSync(profileDir, 0o700);
    assert.match(fs.readFileSync(tokenPath, 'utf8').trim(), /^[A-Za-z0-9]{32}$/);
  } finally {
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.chmodSync(profileDir, 0o700);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

// Enabling fails closed when the very first token cannot be stored, but the
// renderer's saved setting stays `true`. Without a desired-vs-actual split the
// app is then stuck: storage can recover, the token IPCs can hand out a working
// credential, and the server still never comes up.
test('a first enable that could not store a token recovers once storage works', async () => {
  const brokenProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-recover-'));
  const missingProfileDir = path.join(brokenProfileDir, 'not-created-yet');
  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: missingProfileDir });
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });

    // Failing closed is correct: no credential, no server.
    await assert.rejects(
      () => makeRequest({ method: 'GET', path: '/health' }, undefined, port),
      /ECONNREFUSED/,
      'the API served requests even though its token was never stored',
    );

    // Storage recovers, and the user opens Settings — which reads the token.
    ctx.userDataDir = brokenProfileDir;
    const token = ctx.handleHandlers.get('LOCAL_REST_API_GET_TOKEN')();
    assert.match(token, /^[A-Za-z0-9]{32}$/);
    assert.equal(
      fs.readFileSync(path.join(brokenProfileDir, 'local-rest-api-token'), 'utf8').trim(),
      token,
    );

    // The setting still says enabled, so the server must now actually be up —
    // and the token the user is looking at must be the one it accepts.
    const health = await makeRequest({ method: 'GET', path: '/health' }, undefined, port);
    assert.equal(health.status, 200, 'settings showed enabled but nothing was listening');

    const authed = await makeRequest(
      {
        method: 'GET',
        path: '/tasks',
        headers: { Authorization: `Bearer ${token}` },
      },
      undefined,
      port,
    );
    assert.equal(authed.status, 200);
    assert.equal(authed.body.data, 'mock_renderer_data');
  } finally {
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(brokenProfileDir, { recursive: true, force: true });
  }
});

// The same recovery, reached from the other IPC: storage is still broken when
// the settings page loads, so reading the token fails too, and Regenerate is
// the button the user presses once they have freed the disk.
test('recovery also works when Regenerate is the call that first succeeds', async () => {
  const brokenProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-regen-'));
  const missingProfileDir = path.join(brokenProfileDir, 'not-created-yet');
  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: missingProfileDir });
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: true } });
    // Settings opens while storage is still broken: the read fails as well.
    assert.throws(() => ctx.handleHandlers.get('LOCAL_REST_API_GET_TOKEN')());

    ctx.userDataDir = brokenProfileDir;
    const token = ctx.handleHandlers.get('LOCAL_REST_API_REGENERATE_TOKEN')();
    assert.match(token, /^[A-Za-z0-9]{32}$/);

    const health = await makeRequest({ method: 'GET', path: '/health' }, undefined, port);
    assert.equal(health.status, 200, 'settings showed enabled but nothing was listening');
  } finally {
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(brokenProfileDir, { recursive: true, force: true });
  }
});

// The reconciliation above must not become a second way to switch the API on.
test('recovering a token does not start a server the user disabled', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lra-off-'));
  const port = takeIsolatedPort();
  const ctx = createContext({ port, userDataDir: profileDir });
  const isolated = loadModule(ctx);

  try {
    isolated.initLocalRestApi();
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });

    const token = ctx.handleHandlers.get('LOCAL_REST_API_GET_TOKEN')();
    assert.match(token, /^[A-Za-z0-9]{32}$/);

    await assert.rejects(
      () => makeRequest({ method: 'GET', path: '/health' }, undefined, port),
      /ECONNREFUSED/,
      'reading the token started the API while the setting was off',
    );
  } finally {
    isolated.updateLocalRestApiConfig({ misc: { isLocalRestApiEnabled: false } });
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('SP_FORCE_LOCAL_REST_API can use an explicit dev token', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalForce = process.env.SP_FORCE_LOCAL_REST_API;
  const originalForceToken = process.env.SP_FORCE_LOCAL_REST_API_TOKEN;

  process.env.NODE_ENV = 'DEV';
  process.env.SP_FORCE_LOCAL_REST_API = '1';
  process.env.SP_FORCE_LOCAL_REST_API_TOKEN = 'forced_dev_token_123';

  try {
    // Persisted setting disabled: the forced-dev override must still yield a
    // usable credential, and getToken must report it.
    disableApi();
    assert.equal(getToken(), 'forced_dev_token_123');

    const res = await makeRequest({
      method: 'GET',
      path: '/tasks',
      headers: { Authorization: 'Bearer forced_dev_token_123' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // Regenerating must not mint a token the getter will never return, and must
    // leave the real profile's token file alone.
    const persistedBefore = fs.readFileSync(tokenFilePath, 'utf8').trim();
    assert.equal(regenerateToken(), 'forced_dev_token_123');
    assert.equal(getToken(), 'forced_dev_token_123');
    assert.equal(fs.readFileSync(tokenFilePath, 'utf8').trim(), persistedBefore);
  } finally {
    const restore = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('NODE_ENV', originalNodeEnv);
    restore('SP_FORCE_LOCAL_REST_API', originalForce);
    restore('SP_FORCE_LOCAL_REST_API_TOKEN', originalForceToken);
    disableApi();
  }
});

test.after(() => {
  disableApi();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

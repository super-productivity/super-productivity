const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('ts-node/register/transpile-only');

// Resolve the .ts source via a computed path (matches the other *.test.cjs
// files) so tools/verify-electron-requires.js doesn't flag a literal relative
// require of a file excluded from app.asar.
const { assertSecureWebPreferences } = require(
  path.resolve(__dirname, 'web-preferences-guard.ts'),
);

const SECURE = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
});

test('accepts a fully specified secure webPreferences object', () => {
  assert.doesNotThrow(() => assertSecureWebPreferences({ ...SECURE }, 'test'));
});

test('accepts extra unrelated keys (preload, webSecurity, etc.)', () => {
  assert.doesNotThrow(() =>
    assertSecureWebPreferences(
      { ...SECURE, preload: '/x/preload.js', webSecurity: true, spellcheck: false },
      'test',
    ),
  );
});

test('rejects missing webPreferences (relying on Electron defaults)', () => {
  assert.throws(() => assertSecureWebPreferences(undefined, 'test'), /no webPreferences/);
});

test('rejects contextIsolation !== true (including omitted)', () => {
  for (const bad of [false, undefined]) {
    assert.throws(
      () => assertSecureWebPreferences({ ...SECURE, contextIsolation: bad }, 'test'),
      /contextIsolation must be true/,
      `contextIsolation: ${String(bad)} must be rejected`,
    );
  }
});

test('rejects nodeIntegration !== false (including omitted)', () => {
  for (const bad of [true, undefined]) {
    assert.throws(
      () => assertSecureWebPreferences({ ...SECURE, nodeIntegration: bad }, 'test'),
      /nodeIntegration must be false/,
      `nodeIntegration: ${String(bad)} must be rejected`,
    );
  }
});

test('rejects nodeIntegrationInSubFrames unless explicitly false', () => {
  // Fail-closed: this governs whether the preload bridge reaches plugin iframes,
  // so an omitted value (undefined) is rejected too, not just an explicit true.
  for (const bad of [true, undefined]) {
    assert.throws(
      () =>
        assertSecureWebPreferences(
          { ...SECURE, nodeIntegrationInSubFrames: bad },
          'test',
        ),
      /nodeIntegrationInSubFrames must be false/,
      `nodeIntegrationInSubFrames: ${String(bad)} must be rejected`,
    );
  }
});

test('rejects an explicit sandbox: false, but allows it omitted', () => {
  assert.throws(
    () => assertSecureWebPreferences({ ...SECURE, sandbox: false }, 'test'),
    /sandbox must not be explicitly false/,
  );
  assert.doesNotThrow(() => assertSecureWebPreferences({ ...SECURE }, 'test'));
  assert.doesNotThrow(() =>
    assertSecureWebPreferences({ ...SECURE, sandbox: true }, 'test'),
  );
});

test('rejects nodeIntegrationInWorker: true, allows it omitted', () => {
  assert.throws(
    () =>
      assertSecureWebPreferences({ ...SECURE, nodeIntegrationInWorker: true }, 'test'),
    /nodeIntegrationInWorker must not be true/,
  );
  assert.doesNotThrow(() => assertSecureWebPreferences({ ...SECURE }, 'test'));
});

test('rejects webviewTag: true, allows it omitted', () => {
  assert.throws(
    () => assertSecureWebPreferences({ ...SECURE, webviewTag: true }, 'test'),
    /webviewTag must not be true/,
  );
  assert.doesNotThrow(() => assertSecureWebPreferences({ ...SECURE }, 'test'));
});

test('rejects webSecurity: false, allows it omitted or true', () => {
  assert.throws(
    () => assertSecureWebPreferences({ ...SECURE, webSecurity: false }, 'test'),
    /webSecurity must not be explicitly false/,
  );
  assert.doesNotThrow(() => assertSecureWebPreferences({ ...SECURE }, 'test'));
  assert.doesNotThrow(() =>
    assertSecureWebPreferences({ ...SECURE, webSecurity: true }, 'test'),
  );
});

test('error names the offending window', () => {
  assert.throws(
    () => assertSecureWebPreferences({ ...SECURE, nodeIntegration: true }, 'task-widget'),
    /"task-widget" window/,
  );
});

// Wiring guard: every renderer-window constructor in electron/ — `new BrowserWindow`,
// `new BrowserView`, `new WebContentsView` (each carries its own webPreferences) —
// must route through assertSecureWebPreferences. This is the actual regression this
// feature exists to prevent — a NEW window creation site that silently ships without
// the boundary check. Text-scan the sources (importing them would drag in Electron).
//
// We count constructor sites vs guard calls PER FILE rather than a per-file
// boolean, so a second unguarded constructor in an already-guarded file is caught
// too. This stays a heuristic: it cannot see an aliased constructor
// (`const BW = BrowserWindow`) or a window created from a non-`.ts` source, and
// a guard call in a comment would count. Those are acceptable gaps for a tripwire.
test('every renderer-window constructor site has a matching assertSecureWebPreferences call', () => {
  const electronDir = __dirname;
  const tsFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        tsFiles.push(full);
      }
    }
  };
  walk(electronDir);

  const count = (src, re) => (src.match(re) || []).length;
  const NEW_WINDOW_RE = /new\s+(?:BrowserWindow|BrowserView|WebContentsView)\s*\(/g;
  const GUARD_CALL_RE = /assertSecureWebPreferences\s*\(/g;

  const offenders = tsFiles
    .map((file) => {
      const src = fs.readFileSync(file, 'utf8');
      const windows = count(src, NEW_WINDOW_RE);
      const guards = count(src, GUARD_CALL_RE);
      return { file: path.relative(electronDir, file), windows, guards };
    })
    .filter(({ windows, guards }) => windows > guards);

  assert.deepEqual(
    offenders,
    [],
    'These files create more BrowserWindows than they guard. Route each ' +
      'webPreferences through assertSecureWebPreferences() before creating the window.',
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const openUrlPath = path.resolve(__dirname, 'open-url.ts');
const originalModuleLoad = Module._load;

let openPathCalls = [];

const installMocks = () => {
  openPathCalls = [];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        shell: {
          openPath: (p) => {
            openPathCalls.push(p);
            return Promise.resolve('');
          },
          openExternal: () => Promise.resolve(),
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const restoreMocks = () => {
  Module._load = originalModuleLoad;
};

const loadModule = () => {
  delete require.cache[openUrlPath];
  installMocks();
  try {
    return require(openUrlPath);
  } finally {
    restoreMocks();
  }
};

test('isLocalFileUrl detects local file: URLs (case-insensitive, leading space)', () => {
  const { isLocalFileUrl } = loadModule();
  assert.equal(isLocalFileUrl('file:///D:/x'), true);
  assert.equal(isLocalFileUrl('FILE:///D:/x'), true);
  assert.equal(isLocalFileUrl('  file:///D:/x'), true);
  assert.equal(isLocalFileUrl('https://example.com'), false);
  assert.equal(isLocalFileUrl('C:\\Projects\\x'), false);
  assert.equal(isLocalFileUrl('/home/x'), false);
});

// NOTE: these decode tests run on Linux CI, where fileURLToPath returns POSIX
// form ("/D:/Projects/Grüne") and does NOT do the drive-letter + backslash
// conversion ("D:\\Projects\\Grüne") that is the actual Windows behavior. They
// verify percent-decoding (the mechanism that was broken); the Windows-specific
// path conversion relies on Node's documented cross-platform fileURLToPath
// contract and can only be confirmed on-device.
test('openLocalPath decodes non-ASCII chars in a file: URL (issue #8695)', () => {
  const { openLocalPath } = loadModule();
  // The umlaut arrives percent-encoded from the WHATWG URL parser (ü → %C3%BC).
  openLocalPath('file:///D:/Projects/Gr%C3%BCne');
  assert.equal(openPathCalls.length, 1);
  // openPath must receive the DECODED name, never the literal %-escape that
  // ShellExecute would treat as the folder name.
  assert.ok(openPathCalls[0].includes('Grüne'), openPathCalls[0]);
  assert.ok(!openPathCalls[0].includes('%C3%BC'), openPathCalls[0]);
});

test('openLocalPath decodes spaces in a file: URL (issue #8695)', () => {
  const { openLocalPath } = loadModule();
  openLocalPath('file:///D:/Projects/Another%20One');
  assert.equal(openPathCalls.length, 1);
  assert.ok(openPathCalls[0].includes('Another One'), openPathCalls[0]);
  assert.ok(!openPathCalls[0].includes('%20'), openPathCalls[0]);
});

test('openLocalPath accepts a raw (unencoded) file: URL with backslashes', () => {
  const { openLocalPath } = loadModule();
  openLocalPath('file:///D:\\Projects\\Grüne');
  assert.equal(openPathCalls.length, 1);
  assert.ok(openPathCalls[0].includes('Grüne'), openPathCalls[0]);
});

test('openLocalPath passes a plain filesystem path through unchanged', () => {
  const { openLocalPath } = loadModule();
  openLocalPath('/home/user/Grüne Ordner/notes.txt');
  assert.deepEqual(openPathCalls, ['/home/user/Grüne Ordner/notes.txt']);
});

test('openLocalPath blocks executable file: URLs', () => {
  const { openLocalPath } = loadModule();
  openLocalPath('file:///C:/tmp/evil.exe');
  openLocalPath('file:///C:/tmp/evil.bat');
  assert.deepEqual(openPathCalls, []);
});

test('openLocalPath blocks UNC paths', () => {
  const { openLocalPath } = loadModule();
  openLocalPath('\\\\host\\share\\file.txt');
  openLocalPath('//host/share/file.txt');
  assert.deepEqual(openPathCalls, []);
});

test('openLocalPath blocks a path-based UNC file: URL (four slashes)', () => {
  const { openLocalPath } = loadModule();
  // The OPEN_PATH sink has no isExternalUrlSchemeAllowed pre-gate, so
  // openLocalPath alone must block this NTLM-leak vector (GHSA-hr87-735w-hfq3):
  // file:////host/share decodes to //host/share, which isUncPath rejects.
  openLocalPath('file:////host/share');
  assert.deepEqual(openPathCalls, []);
});

test('openLocalPath blocks an executable hidden behind a percent-encoded dot', () => {
  const { openLocalPath } = loadModule();
  // fileURLToPath decodes %2E → "." so the executable guard sees the real
  // ".bat" extension. (Stricter than the old openExternal path, where the
  // encoded dot hid the extension.)
  openLocalPath('file:///C:/tmp/evil%2Ebat');
  assert.deepEqual(openPathCalls, []);
});

test('openLocalPath rejects a file: URL with a remote authority', () => {
  const { openLocalPath } = loadModule();
  // fileURLToPath throws for a remote authority on POSIX; on Windows it yields a
  // UNC path that isPathSafeToOpen then rejects. Either way: never opened.
  openLocalPath('file://host/share');
  assert.deepEqual(openPathCalls, []);
});

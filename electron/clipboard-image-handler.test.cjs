/**
 * Security test for CLIPBOARD_COPY_IMAGE_FILE source validation.
 * The copy source is renderer-supplied; only actual image files may be copied
 * (so a plugin/XSS can't copy a secret into the images dir and read it back).
 * Run with: npm run test:electron
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modPath = path.resolve(__dirname, 'clipboard-image-handler.ts');
const originalModuleLoad = Module._load;

let handlers = {};
let userDataDir;
let externalDir;

const installMocks = () => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        app: { getPath: () => userDataDir },
        clipboard: { readImage: () => ({ isEmpty: () => true }) },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const load = () => {
  delete require.cache[modPath];
  handlers = {};
  require(modPath).initClipboardImageHandlers();
};

test.beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cb-ud-'));
  externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cb-src-'));
  installMocks();
  load();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete require.cache[modPath];
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(externalDir, { recursive: true, force: true });
});

const imagesDir = () => path.join(userDataDir, 'clipboard-images');

test('CLIPBOARD_COPY_IMAGE_FILE refuses a non-image source file', async () => {
  const secret = path.join(externalDir, 'secret.txt');
  fs.writeFileSync(secret, 'topsecret');

  const result = await handlers['CLIPBOARD_COPY_IMAGE_FILE'](
    {},
    { basePath: imagesDir(), filePath: secret },
  );

  assert.equal(result, null, 'returns the error value');
  // Nothing copied into the images dir.
  const copied = fs.existsSync(imagesDir()) ? fs.readdirSync(imagesDir()) : [];
  assert.equal(copied.length, 0);
});

test('CLIPBOARD_COPY_IMAGE_FILE copies an actual image file', async () => {
  const src = path.join(externalDir, 'pic.png');
  fs.writeFileSync(src, 'pngbytes');

  const result = await handlers['CLIPBOARD_COPY_IMAGE_FILE'](
    {},
    { basePath: imagesDir(), filePath: src },
  );

  assert.ok(result && typeof result.id === 'string');
  assert.equal(fs.readdirSync(imagesDir()).length, 1);
});

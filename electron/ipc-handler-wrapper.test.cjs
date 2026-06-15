/**
 * Security tests for createValidatedHandler path/name validation.
 * Closes the grant-file forgery via clipboard image save (fileName='simpleSettings'),
 * the `<userData>-evil` sibling-prefix bypass (containment vs bare startsWith), and
 * `..` traversal out of the images dir. Run with: npm run test:electron
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modPath = path.resolve(__dirname, 'ipc-handler-wrapper.ts');
const originalModuleLoad = Module._load;
const USERDATA = path.resolve('/home/u/.config/sp');

Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => USERDATA } };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { createValidatedHandler, validatePathInUserData } = require(modPath);

// A SAVE-like handler (no errorValue): validation failures must reject.
const saveLike = createValidatedHandler(async () => 'WROTE', { validatePath: true });
const call = (args) => saveLike({}, args);

test('validatePathInUserData: containment, not bare startsWith', () => {
  assert.equal(validatePathInUserData(path.join(USERDATA, 'clipboard-images')), true);
  // The userData root itself is not a valid write target (strict containment).
  assert.equal(validatePathInUserData(USERDATA), false);
  assert.equal(validatePathInUserData(USERDATA + '-evil'), false); // sibling prefix
  assert.equal(validatePathInUserData(path.resolve('/etc')), false);
});

test('allows a normal clipboard image write', async () => {
  const r = await call({
    basePath: path.join(USERDATA, 'clipboard-images'),
    fileName: 'abc123.png',
    base64Data: 'x',
  });
  assert.equal(r, 'WROTE');
});

test('rejects fileName="simpleSettings" (grant-file forgery)', async () => {
  await assert.rejects(
    () =>
      call({
        basePath: path.join(USERDATA, 'clipboard-images'),
        fileName: 'simpleSettings',
        base64Data: 'x',
      }),
    /Invalid file name/,
  );
});

test('rejects a `..`/separator traversal in fileName', async () => {
  await assert.rejects(
    () =>
      call({
        basePath: path.join(USERDATA, 'clipboard-images'),
        fileName: '../simpleSettings.png',
        base64Data: 'x',
      }),
    /Invalid file name/,
  );
});

test('rejects a non-image fileName even with a safe basename', async () => {
  await assert.rejects(
    () =>
      call({
        basePath: path.join(USERDATA, 'clipboard-images'),
        fileName: 'evil.sh',
        base64Data: 'x',
      }),
    /Invalid file name/,
  );
});

test('rejects basePath outside userData', async () => {
  await assert.rejects(
    () => call({ basePath: path.resolve('/etc'), fileName: 'a.png', base64Data: 'x' }),
    /Invalid base path/,
  );
});

test('rejects an imageId containing a traversal', async () => {
  const loadLike = createValidatedHandler(async () => 'READ', { validatePath: true });
  await assert.rejects(
    () =>
      loadLike(
        {},
        {
          basePath: path.join(USERDATA, 'clipboard-images'),
          imageId: '../../etc/passwd',
        },
      ),
    /Invalid image id/,
  );
});

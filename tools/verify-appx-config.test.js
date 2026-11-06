'use strict';

// The Microsoft Store (appx) build must declare the `superproductivity` URI
// scheme in its package manifest. Inside an appx, `app.setAsDefaultProtocolClient`
// returns true but registers nothing other apps can see (Electron docs), so
// without the manifest entry the browser cannot hand the OneDrive OAuth
// callback back to the app (#8572). The shipped v19.3.1 appx had no
// `windows.protocol` extension because its config lived in a CI secret that
// never declared one.
//
// Loads the config through electron-builder's own loader, so `extends` and its
// merge rules are exercised the same way the release workflow uses them.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { getConfig } = require('app-builder-lib/out/util/config/config');

const ROOT = join(__dirname, '..');
const APPX_CONFIG = 'build/electron-builder.appx.yaml';

const loadAppxConfig = () => getConfig(ROOT, join(ROOT, APPX_CONFIG), null);

test('appx config declares the superproductivity URI scheme', async () => {
  const config = await loadAppxConfig();
  const schemes = [config.protocols, config.win?.protocols]
    .flat()
    .filter(Boolean)
    .flatMap((p) => p.schemes);
  assert.ok(
    schemes.includes('superproductivity'),
    `expected scheme "superproductivity", got ${JSON.stringify(schemes)}`,
  );
});

test('appx config keeps the published Store identity', async () => {
  const { appx } = await loadAppxConfig();
  // Literals read from the AppxManifest.xml of the shipped v19.3.1 appx; a
  // changed identity would publish as a different Store app.
  assert.equal(appx.identityName, '53707johannesjo.SuperProductivity');
  assert.equal(appx.publisher, 'CN=AC30A249-AFE7-4B23-AE54-A95B4FDF8928');
  assert.equal(appx.applicationId, 'SuperProductivity');
});

test('appx config builds only the appx target', async () => {
  const { win } = await loadAppxConfig();
  assert.deepEqual(
    [win.target].flat().map((t) => t.target),
    ['appx'],
  );
});

test('Store workflow builds from the in-repo appx config', () => {
  const workflow = readFileSync(
    join(ROOT, '.github', 'workflows', 'build-create-windows-store-on-release.yml'),
    'utf8',
  );
  assert.ok(
    workflow.includes(`--config ${APPX_CONFIG}`),
    `Store workflow must pass --config ${APPX_CONFIG}`,
  );
  assert.doesNotMatch(workflow, /WIN_STORE_ELECTRON_BUILDER_YML/);
});

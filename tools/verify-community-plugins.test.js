const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  validateCommunityPlugins,
  verifyRelease,
  LISTING_PATH,
  MAX_PLUGIN_ZIP_SIZE,
} = require('./verify-community-plugins');
const path = require('node:path');

const ZIP_BYTES = Buffer.from('zip bytes');
const SHA = crypto.createHash('sha256').update(ZIP_BYTES).digest('hex');

const entry = (overrides = {}) => ({
  name: 'Plugin',
  shortDescription: 'Does things.',
  url: 'https://github.com/someone/plugin',
  author: 'someone',
  ...overrides,
});

const listed = entry({
  name: 'Listed Plugin',
  id: 'my-plugin',
  release: {
    version: '1.2.0',
    downloadUrl: 'https://github.com/someone/plugin/releases/download/v1.2.0/plugin.zip',
    sha256: SHA,
  },
});

test('the shipped listing is valid', () => {
  const entries = JSON.parse(fs.readFileSync(LISTING_PATH, 'utf8'));
  assert.deepEqual(validateCommunityPlugins(entries), []);
});

test('uses the same ZIP size limit as the app', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/app/plugins/plugin.const.ts'),
    'utf8',
  );
  const match = src.match(/MAX_PLUGIN_ZIP_SIZE = (\d+) \* 1024 \* 1024;/);
  assert.ok(match, 'MAX_PLUGIN_ZIP_SIZE not found in plugin.const.ts');
  assert.equal(MAX_PLUGIN_ZIP_SIZE, Number(match[1]) * 1024 * 1024);
});

test('accepts link-only and installable entries', () => {
  assert.deepEqual(validateCommunityPlugins([entry(), listed]), []);
});

test('rejects unknown keys, e.g. the dropped "stars"', () => {
  const [error] = validateCommunityPlugins([entry({ stars: 3 })]);
  assert.match(error, /unknown key "stars"/);
});

test('rejects missing fields and non-https urls', () => {
  const errors = validateCommunityPlugins([
    entry({ author: '', url: 'http://example.com', authorUrl: 'javascript:alert(1)' }),
  ]);
  assert.equal(errors.length, 3);
});

test('rejects duplicate names and ids', () => {
  const errors = validateCommunityPlugins([
    listed,
    { ...listed, name: 'listed plugin' },
    entry({ name: 'Other', id: 'my-plugin' }),
  ]);
  assert.ok(errors.some((e) => /duplicate name/.test(e)));
  assert.ok(errors.some((e) => /duplicate id/.test(e)));
});

test('a release needs an id, a numeric version, an https url and a sha256', () => {
  const errors = validateCommunityPlugins([
    entry({
      release: {
        version: 'latest',
        downloadUrl: 'http://x/y.zip',
        sha256: SHA.toUpperCase(),
      },
    }),
  ]);
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /requires "id"/);
});

const fakeFetch =
  (body, status = 200) =>
  async () =>
    new Response(body, { status });

test('verifies the hash and the manifest id and version of a release', async () => {
  const errors = await verifyRelease(listed, {
    fetchFn: fakeFetch(ZIP_BYTES),
    readManifest: () => ({ id: 'my-plugin', version: '1.2.0' }),
  });
  assert.deepEqual(errors, []);
});

test('reports a hash mismatch without reading the manifest', async () => {
  let isRead = false;
  const [error] = await verifyRelease(listed, {
    fetchFn: fakeFetch(Buffer.from('swapped')),
    readManifest: () => {
      isRead = true;
    },
  });
  assert.match(error, /sha256 mismatch/);
  assert.equal(isRead, false);
});

test('reports a manifest that does not match the listing', async () => {
  const errors = await verifyRelease(listed, {
    fetchFn: fakeFetch(ZIP_BYTES),
    readManifest: () => ({ id: 'other', version: '1.1.0' }),
  });
  assert.equal(errors.length, 2);
});

test('quotes manifest values so they cannot inject workflow commands', async () => {
  const [error] = await verifyRelease(listed, {
    fetchFn: fakeFetch(ZIP_BYTES),
    readManifest: () => ({ id: 'x\n::notice::All good', version: '1.2.0' }),
  });
  assert.ok(!error.includes('\n'));
  assert.match(error, /"x\\n::notice::All good"/);
});

test('reports a failed download', async () => {
  const [error] = await verifyRelease(listed, { fetchFn: fakeFetch(null, 404) });
  assert.match(error, /HTTP 404/);
});

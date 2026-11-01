const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { createWebDavCookieJar } = require(
  path.resolve(__dirname, 'webdav-cookie-jar.ts'),
);

const BASE = 'https://ewebdav.example.com';

test('resends the session cookie a WebDAV server set (#10839)', () => {
  const jar = createWebDavCookieJar();
  assert.equal(jar.beginRequest(`${BASE}/sync/sync-data.json`), undefined);
  jar.storeFromResponse(`${BASE}/sync/sync-data.json`, {
    'Set-Cookie': ['session=s1; Path=/; Secure; HttpOnly', 'lang=en'],
  });
  assert.equal(jar.beginRequest(`${BASE}/sync/other.json`), 'session=s1; lang=en');
});

test('replaces a cookie by name and drops one the server expires', () => {
  const jar = createWebDavCookieJar();
  jar.beginRequest(`${BASE}/a`);
  jar.storeFromResponse(`${BASE}/a`, { 'set-cookie': ['session=s1', 'old=1'] });
  jar.storeFromResponse(`${BASE}/a`, {
    'set-cookie': [
      'session=s2',
      'old=; Max-Age=0',
      'gone=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ],
  });
  assert.equal(jar.beginRequest(`${BASE}/a`), 'session=s2');
});

test('stops sending a cookie once its Max-Age elapsed', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const jar = createWebDavCookieJar();
  jar.beginRequest(`${BASE}/a`);
  jar.storeFromResponse(`${BASE}/a`, { 'set-cookie': ['session=s1; Max-Age=60'] });
  t.mock.timers.tick(59_000);
  assert.equal(jar.beginRequest(`${BASE}/a`), 'session=s1');
  t.mock.timers.tick(2_000);
  assert.equal(jar.beginRequest(`${BASE}/a`), undefined);
});

test('forgets cookies when the credentials for an origin change', () => {
  // Nextcloud authenticates a DAV session cookie without checking the Basic
  // credentials, so a stale cookie would sync into the previous account.
  const jar = createWebDavCookieJar();
  jar.beginRequest(`${BASE}/a`, 'Basic old');
  jar.storeFromResponse(`${BASE}/a`, { 'set-cookie': ['session=s1'] });
  assert.equal(jar.beginRequest(`${BASE}/a`, 'Basic old'), 'session=s1');
  assert.equal(jar.beginRequest(`${BASE}/a`, 'Basic new'), undefined);
  assert.equal(jar.beginRequest(`${BASE}/a`, 'Basic old'), undefined);
});

test('keeps cookies per origin', () => {
  const jar = createWebDavCookieJar();
  jar.beginRequest(`${BASE}/a`);
  jar.storeFromResponse(`${BASE}/a`, { 'set-cookie': ['session=s1'] });
  assert.equal(jar.beginRequest('https://other-dav.example.com/a'), undefined);
  assert.equal(jar.beginRequest('http://ewebdav.example.com/a'), undefined);
});

test('ignores responses from origins no WebDAV request was sent to', () => {
  const jar = createWebDavCookieJar();
  jar.storeFromResponse('https://tracker.example.com/x', { 'set-cookie': ['t=1'] });
  assert.equal(jar.beginRequest('https://tracker.example.com/x'), undefined);
});

test('ignores malformed values and invalid URLs', () => {
  const jar = createWebDavCookieJar();
  jar.beginRequest(`${BASE}/a`);
  jar.storeFromResponse(`${BASE}/a`, { 'set-cookie': ['no-equals-sign', '=nameless'] });
  assert.equal(jar.beginRequest(`${BASE}/a`), undefined);
  assert.equal(jar.beginRequest('not a url'), undefined);
  assert.doesNotThrow(() => jar.storeFromResponse('not a url', {}));
});

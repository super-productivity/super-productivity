const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

// Match the layout used by the other *.test.cjs files: resolve the .ts source
// via a computed path so tools/verify-electron-requires.js doesn't flag a
// literal relative require of a file excluded from app.asar.
const { isAppOriginUrl } = require(path.resolve(__dirname, 'navigation-guard.ts'));

const DEV_APP_URL = 'http://localhost:4200';
const PROD_APP_URL = 'file:///Applications/SP.app/Contents/Resources/index.html';

test('dev: exact origin matches', () => {
  assert.equal(isAppOriginUrl('http://localhost:4200/', DEV_APP_URL), true);
  assert.equal(isAppOriginUrl('http://localhost:4200/#/foo', DEV_APP_URL), true);
  assert.equal(isAppOriginUrl('http://localhost:4200/some-route', DEV_APP_URL), true);
});

test('dev: different port on localhost is rejected', () => {
  // The whole point of the fix: 127.0.0.1:1337 or localhost:9999 must NOT
  // inherit the preload bridge just because the hostname looks local.
  assert.equal(isAppOriginUrl('http://localhost:1337/', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('http://localhost:9999/', DEV_APP_URL), false);
});

test('dev: 127.0.0.1 is rejected (different host than localhost)', () => {
  // The old guard accepted any "localhost OR 127.0.0.1" — anything serving
  // on a loopback address could load in the privileged window. After the
  // fix, only the exact origin the app loaded is allowed.
  assert.equal(isAppOriginUrl('http://127.0.0.1:4200/', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('http://127.0.0.1:1337/', DEV_APP_URL), false);
});

test('dev: localhost.evil.com substring attack is rejected', () => {
  // Regression for the earlier substring-match bug (fixed in 4bf699735).
  assert.equal(isAppOriginUrl('http://localhost.evil.com/', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('http://evil.localhost:4200/', DEV_APP_URL), false);
});

test('dev: userinfo @ trick is rejected (host is the part after @)', () => {
  // WHATWG URL parses `http://localhost:4200@evil.com/` with host=evil.com,
  // username=localhost. A naive substring/startsWith check would be fooled;
  // the host-equality check correctly rejects it.
  assert.equal(isAppOriginUrl('http://localhost:4200@evil.com/', DEV_APP_URL), false);
  assert.equal(
    isAppOriginUrl('http://localhost@evil.com:4200/', DEV_APP_URL),
    false,
    'evil.com:4200 with localhost as username is still not our origin',
  );
});

test('dev: https variant is rejected (protocol must match)', () => {
  assert.equal(isAppOriginUrl('https://localhost:4200/', DEV_APP_URL), false);
});

test('dev: external https URL is rejected', () => {
  assert.equal(isAppOriginUrl('https://example.com/', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('https://jira.example.com/browse/X-1', DEV_APP_URL), false);
});

test('prod: same file:// path matches', () => {
  assert.equal(isAppOriginUrl(PROD_APP_URL, PROD_APP_URL), true);
});

test('prod: rejects ALL http(s) localhost URLs (no dev-only opt-in)', () => {
  // Production never legitimately navigates to http://localhost:*. The fix
  // is what makes this hold: no host-based allowlist, only "matches the
  // app's actual loaded URL".
  assert.equal(isAppOriginUrl('http://localhost:4200/', PROD_APP_URL), false);
  assert.equal(isAppOriginUrl('http://localhost:1337/', PROD_APP_URL), false);
  assert.equal(isAppOriginUrl('http://127.0.0.1:1337/', PROD_APP_URL), false);
});

test('prod: rejects different file:// targets', () => {
  assert.equal(
    isAppOriginUrl('file:///etc/passwd', PROD_APP_URL),
    false,
    'arbitrary file path',
  );
  assert.equal(
    isAppOriginUrl(
      'file:///Applications/SP.app/Contents/Resources/other.html',
      PROD_APP_URL,
    ),
    false,
    'sibling html under the app bundle',
  );
});

test('prod: rejects UNC / remote-host file:// even when pathname matches', () => {
  // Regression: `file://` URLs carry a host. A pathname-only check matched
  // `file://192.168.1.100/Applications/SP.app/Contents/Resources/index.html`
  // against the local `file:///…/index.html` because both pathnames are
  // `/Applications/SP.app/Contents/Resources/index.html` — letting an
  // attacker-controlled UNC host load in the privileged window.
  assert.equal(
    isAppOriginUrl(
      'file://192.168.1.100/Applications/SP.app/Contents/Resources/index.html',
      PROD_APP_URL,
    ),
    false,
    'UNC host with matching pathname must be rejected',
  );
  assert.equal(
    isAppOriginUrl(
      'file://attacker.example.com/Applications/SP.app/Contents/Resources/index.html',
      PROD_APP_URL,
    ),
    false,
    'remote-host file:// with matching pathname must be rejected',
  );
  // Even an empty-but-malformed authority pattern should not bypass it.
  assert.equal(
    isAppOriginUrl('file://localhost/etc/passwd', PROD_APP_URL),
    false,
    'localhost-host file:// pointing elsewhere is rejected',
  );
});

test('non-http(s)/file schemes are rejected', () => {
  // data:/blob:/javascript:/etc must never land in the privileged window.
  assert.equal(isAppOriginUrl('data:text/html,<h1>x</h1>', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('javascript:alert(1)', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('blob:http://localhost:4200/abcd', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('about:blank', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('ftp://localhost:4200/x', DEV_APP_URL), false);
});

test('malformed URLs are rejected', () => {
  assert.equal(isAppOriginUrl('not a url', DEV_APP_URL), false);
  assert.equal(isAppOriginUrl('', DEV_APP_URL), false);
});

test('custom dev URL: exact origin still required', () => {
  // Some setups override the dev URL (electron CLI). The guard always reads
  // back the actual loaded URL, so a custom dev origin works without code
  // changes — but still rejects look-alikes.
  const customUrl = 'http://localhost:9999';
  assert.equal(isAppOriginUrl('http://localhost:9999/route', customUrl), true);
  assert.equal(isAppOriginUrl('http://localhost:4200/', customUrl), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { getConfiguredHosts, isCertErrorTrusted, toTrustedHostSet } = require(
  path.resolve(__dirname, 'shared-with-frontend/cert-trust-hosts.ts'),
);

const trusted = (...hosts) => new Set(hosts);

test('collects hosts from top-level and nested config URLs', () => {
  const hosts = getConfiguredHosts([
    { host: 'https://jira.corp.local/', token: 'abc' },
    { pluginConfig: { url: 'https://Gitea.Example.org:3000/api', apiKey: 'x' } },
    { baseUrl: 'http://nas.lan/remote.php/dav' },
  ]);
  assert.deepEqual(hosts.sort(), [
    'gitea.example.org:3000',
    'jira.corp.local',
    'nas.lan',
  ]);
});

test('ignores non-URL strings, other schemes, null and duplicates', () => {
  const hosts = getConfiguredHosts([
    null,
    { a: 'not a url', b: 'ftp://files.example.org', c: 'javascript:alert(1)' },
    { a: 'https://same.example.org/x' },
    { a: 'https://same.example.org/y' },
  ]);
  assert.deepEqual(hosts, ['same.example.org']);
});

test('does not descend deeper than one nested level', () => {
  const hosts = getConfiguredHosts([{ a: { b: { c: 'https://deep.example.org' } } }]);
  assert.deepEqual(hosts, []);
});

test('accepts certificate errors only for an exactly matching host', () => {
  const hosts = trusted('nas.lan', 'gitea.example.org:3000');
  assert.equal(isCertErrorTrusted('https://nas.lan/remote.php/dav', hosts), true);
  assert.equal(isCertErrorTrusted('wss://nas.lan/ws', hosts), true);
  assert.equal(isCertErrorTrusted('https://gitea.example.org:3000/x', hosts), true);
});

test('rejects other hosts, subdomains, suffix tricks and other ports', () => {
  const hosts = trusted('nas.lan', 'gitea.example.org:3000');
  assert.equal(isCertErrorTrusted('https://www.dropbox.com/', hosts), false);
  assert.equal(isCertErrorTrusted('https://evil.nas.lan/', hosts), false);
  assert.equal(isCertErrorTrusted('https://nas.lan.evil.com/', hosts), false);
  assert.equal(isCertErrorTrusted('https://nas.lan@evil.com/', hosts), false);
  assert.equal(isCertErrorTrusted('https://nas.lan:8443/', hosts), false);
  assert.equal(isCertErrorTrusted('https://gitea.example.org/', hosts), false);
});

test('rejects unparsable URLs and an empty allowlist', () => {
  assert.equal(isCertErrorTrusted('not a url', trusted('nas.lan')), false);
  assert.equal(isCertErrorTrusted('https://nas.lan/', trusted()), false);
});

test('toTrustedHostSet keeps only plausible host strings', () => {
  const set = toTrustedHostSet([
    'nas.lan',
    'gitea.example.org:3000',
    42,
    '',
    'a/b',
    'x'.repeat(300),
  ]);
  assert.deepEqual([...set].sort(), ['gitea.example.org:3000', 'nas.lan']);
});

test('toTrustedHostSet returns an empty set for a non-array payload', () => {
  assert.equal(toTrustedHostSet('nas.lan').size, 0);
  assert.equal(toTrustedHostSet(undefined).size, 0);
});

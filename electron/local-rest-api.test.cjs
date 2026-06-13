// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'local-rest-api.ts');
const originalModuleLoad = Module._load;

// --- mock helpers -----------------------------------------------------------

let mockNetworkInterfaces = () => ({
  lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  en0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
});

let mockIsIpResult = /** @type {(ip: string) => number} */ ((_ip) => 4);

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return { ipcMain: { on: () => {} } };
    if (request === 'electron-log/main')
      return { log: () => {}, warn: () => {}, error: () => {} };
    if (request === 'os') return { networkInterfaces: () => mockNetworkInterfaces() };
    if (request === 'net') return { isIP: (ip) => mockIsIpResult(ip) };
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModule = () => {
  delete require.cache[modulePath];
};

const loadModule = () => {
  resetModule();
  return require(modulePath);
};

test.beforeEach(() => {
  mockNetworkInterfaces = () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
  });
  mockIsIpResult = (_ip) => 4;
  delete process.env.SP_LOCAL_REST_API_HOST;
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete process.env.SP_LOCAL_REST_API_HOST;
  resetModule();
});

// --- isAllInterfaces --------------------------------------------------------

test('isAllInterfaces: 0.0.0.0 is all-interfaces', () => {
  const { isAllInterfaces } = loadModule();
  assert.equal(isAllInterfaces('0.0.0.0'), true);
});

test('isAllInterfaces: 127.0.0.1 is not all-interfaces', () => {
  const { isAllInterfaces } = loadModule();
  assert.equal(isAllInterfaces('127.0.0.1'), false);
});

test('isAllInterfaces: :: is not all-interfaces (IPv6 not supported)', () => {
  const { isAllInterfaces } = loadModule();
  assert.equal(isAllInterfaces('::'), false);
});

// --- buildLocalhostAllowedHosts ---------------------------------------------

test('buildLocalhostAllowedHosts: includes localhost and the given host', () => {
  const { buildLocalhostAllowedHosts } = loadModule();
  const set = buildLocalhostAllowedHosts('127.0.0.1');
  assert.ok(set.has('localhost'));
  assert.ok(set.has('127.0.0.1'));
  assert.ok(set.has('127.0.0.1:3876'));
  assert.ok(set.has('localhost:3876'));
});

// --- buildAllInterfacesAllowedHosts -----------------------------------------

test('buildAllInterfacesAllowedHosts: includes localhost and local IPv4 addresses', () => {
  const { buildAllInterfacesAllowedHosts } = loadModule();
  const set = buildAllInterfacesAllowedHosts();
  assert.ok(set.has('localhost'));
  assert.ok(set.has('127.0.0.1'));
  assert.ok(set.has('192.168.1.100'));
  assert.ok(set.has('192.168.1.100:3876'));
});

test('buildAllInterfacesAllowedHosts: reflects current interfaces (simulates VPN joining)', () => {
  const { buildAllInterfacesAllowedHosts } = loadModule();
  // Initially no VPN
  const before = buildAllInterfacesAllowedHosts();
  assert.equal(before.has('10.8.0.1'), false);
  // VPN comes up
  mockNetworkInterfaces = () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
    utun3: [{ family: 'IPv4', address: '10.8.0.1', internal: false }],
  });
  const after = buildAllInterfacesAllowedHosts();
  assert.ok(after.has('10.8.0.1'));
});

// --- isAllowedHost ----------------------------------------------------------

test('isAllowedHost: localhost mode accepts localhost:3876', () => {
  const { isAllowedHost } = loadModule();
  // currentHost defaults to 127.0.0.1
  assert.equal(isAllowedHost('localhost:3876'), true);
});

test('isAllowedHost: localhost mode accepts 127.0.0.1:3876', () => {
  const { isAllowedHost } = loadModule();
  assert.equal(isAllowedHost('127.0.0.1:3876'), true);
});

test('isAllowedHost: localhost mode rejects attacker hostname', () => {
  const { isAllowedHost } = loadModule();
  assert.equal(isAllowedHost('evil.attacker.com:3876'), false);
});

test('buildAllInterfacesAllowedHosts: includes local IPs and excludes unknown hostnames', () => {
  // currentHost is module-level state not accessible from tests; test the underlying
  // helper directly — it drives the same allowlist that isAllowedHost uses in
  // all-interfaces mode.
  const { buildAllInterfacesAllowedHosts } = loadModule();
  const set = buildAllInterfacesAllowedHosts();
  assert.ok(set.has('192.168.1.100:3876'), 'LAN IP with port should be allowed');
  assert.ok(set.has('192.168.1.100'), 'LAN IP without port should be allowed');
  assert.equal(
    set.has('evil.attacker.com:3876'),
    false,
    'attacker hostname should be rejected',
  );
});

// --- resolveHost ------------------------------------------------------------

/** Minimal GlobalConfigState-shaped object */
const makeCfg = (isApiEnabled, isExtEnabled) => ({
  misc: {
    isLocalRestApiEnabled: isApiEnabled,
    isLocalRestApiExternalAccessEnabled: isExtEnabled,
  },
});

test('resolveHost: API+external both on → 0.0.0.0', () => {
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(true, true)), '0.0.0.0');
});

test('resolveHost: API on but external off → 127.0.0.1', () => {
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(true, false)), '127.0.0.1');
});

test('resolveHost: external on but API off → 127.0.0.1', () => {
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(false, true)), '127.0.0.1');
});

test('resolveHost: both off → 127.0.0.1', () => {
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(false, false)), '127.0.0.1');
});

test('resolveHost: valid IP env override is used regardless of config', () => {
  process.env.SP_LOCAL_REST_API_HOST = '10.0.0.5';
  mockIsIpResult = (_ip) => 4;
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(false, false)), '10.0.0.5');
});

test('resolveHost: hostname env override is rejected, falls back to 127.0.0.1', () => {
  process.env.SP_LOCAL_REST_API_HOST = 'not-an-ip';
  mockIsIpResult = (_ip) => 0;
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(true, true)), '127.0.0.1');
});

test('resolveHost: env override with 0.0.0.0 is valid', () => {
  process.env.SP_LOCAL_REST_API_HOST = '0.0.0.0';
  mockIsIpResult = (_ip) => 4;
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(false, false)), '0.0.0.0');
});

test('resolveHost: IPv6 env override is rejected, falls back to 127.0.0.1', () => {
  process.env.SP_LOCAL_REST_API_HOST = '::1';
  mockIsIpResult = (_ip) => 6;
  const { resolveHost } = loadModule();
  assert.equal(resolveHost(makeCfg(true, true)), '127.0.0.1');
});

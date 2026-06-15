const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { Agent: HttpsAgent } = require('node:https');
const { HttpsProxyAgent } = require('https-proxy-agent');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const originalEnv = { ...process.env };
const proxyAgentModulePath = path.resolve(__dirname, 'proxy-agent.ts');

const resetModule = () => {
  delete require.cache[proxyAgentModulePath];
};

const clearProxyEnv = () => {
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  delete process.env.HTTP_PROXY;
  delete process.env.http_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron-log/main') {
      return {
        log: () => {},
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadProxyAgentModule = () => {
  resetModule();
  return require(proxyAgentModulePath);
};

test.beforeEach(() => {
  clearProxyEnv();
  installMocks();
  resetModule();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  process.env = { ...originalEnv };
  resetModule();
});

test('returns undefined when no proxy or self-signed handling is configured', () => {
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.internal.example/rest/api'),
    undefined,
  );
});

test('creates a proxy agent from HTTPS_PROXY', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  const agent = createProxyAwareAgent('https://jira.external.example/rest/api');

  assert.ok(agent instanceof HttpsProxyAgent);
  assert.equal(agent.proxy.href, 'http://proxy.example:8080/');
});

test('bypasses proxy for an exact NO_PROXY host match', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = 'jira.internal.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.internal.example/rest/api'),
    undefined,
  );
});

test('bypasses proxy for subdomains of a bare NO_PROXY domain', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = 'internal.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.internal.example/rest/api'),
    undefined,
  );
  assert.ok(
    createProxyAwareAgent('https://notinternal.example/rest/api') instanceof
      HttpsProxyAgent,
  );
});

test('honors lowercase no_proxy and leading-dot suffix matches', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.no_proxy = '.internal.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.internal.example/rest/api'),
    undefined,
  );
  assert.equal(createProxyAwareAgent('https://internal.example/rest/api'), undefined);
});

test('honors wildcard NO_PROXY entries', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = '*';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.external.example/rest/api'),
    undefined,
  );
});

test('honors wildcard suffix NO_PROXY entries', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = '*.corp.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(createProxyAwareAgent('https://jira.corp.example/rest/api'), undefined);
});

test('requires NO_PROXY port entries to match the request port', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = 'jira.internal.example:8443';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  assert.equal(
    createProxyAwareAgent('https://jira.internal.example:8443/rest/api'),
    undefined,
  );
  assert.ok(
    createProxyAwareAgent('https://jira.internal.example:443/rest/api') instanceof
      HttpsProxyAgent,
  );
});

test('keeps self-signed handling when NO_PROXY bypasses the proxy', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = 'jira.internal.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  const agent = createProxyAwareAgent('https://jira.internal.example/rest/api', true);

  assert.ok(agent instanceof HttpsAgent);
  assert.equal(agent.options.rejectUnauthorized, false);
});

test('keeps proxy handling for non-matching NO_PROXY entries', () => {
  process.env.HTTPS_PROXY = 'http://proxy.example:8080';
  process.env.NO_PROXY = 'other.internal.example,.corp.example';
  const { createProxyAwareAgent } = loadProxyAgentModule();

  const agent = createProxyAwareAgent('https://jira.internal.example/rest/api', true);

  assert.ok(agent instanceof HttpsProxyAgent);
  assert.equal(agent.proxy.href, 'http://proxy.example:8080/');
  assert.equal(agent.options.rejectUnauthorized, false);
});

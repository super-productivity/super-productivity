const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { resolveLocalRestApiPort } = require('./local-rest-api-port.ts');

const DEFAULT_PORT = 3876;

const resolve = ({ argv = ['electron', '.'], env = {} } = {}) =>
  resolveLocalRestApiPort({ argv, env, defaultPort: DEFAULT_PORT });

const withArg = (value) => ['electron', '.', `--rest-api-port=${value}`];
const withEnv = (value) => ({ SP_LOCAL_REST_API_PORT: value });

test('uses the default when nothing is set', () => {
  assert.equal(resolve(), DEFAULT_PORT);
});

test('uses --rest-api-port', () => {
  assert.equal(resolve({ argv: withArg('3877') }), 3877);
});

test('uses SP_LOCAL_REST_API_PORT', () => {
  assert.equal(resolve({ env: withEnv('3878') }), 3878);
});

test('the flag wins over the environment variable', () => {
  assert.equal(resolve({ argv: withArg('3877'), env: withEnv('3878') }), 3877);
});

test('an invalid flag falls back to the environment variable', () => {
  assert.equal(resolve({ argv: withArg('abc'), env: withEnv('3878') }), 3878);
});

test('ignores ports outside 1024-65535', () => {
  assert.equal(resolve({ argv: withArg('80') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('1023') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('65536') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('1024') }), 1024);
  assert.equal(resolve({ argv: withArg('65535') }), 65535);
});

test('ignores values that are not whole numbers', () => {
  assert.equal(resolve({ argv: withArg('38.5') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('3877abc') }), DEFAULT_PORT);
  assert.equal(resolve({ argv: withArg('0x0f1d') }), DEFAULT_PORT);
  assert.equal(resolve({ env: withEnv('-1') }), DEFAULT_PORT);
  assert.equal(resolve({ env: withEnv('') }), DEFAULT_PORT);
});

test('accepts surrounding whitespace', () => {
  assert.equal(resolve({ env: withEnv(' 3879 ') }), 3879);
});

test('uses the given default, not a fixed one', () => {
  assert.equal(resolveLocalRestApiPort({ argv: [], env: {}, defaultPort: 4000 }), 4000);
});

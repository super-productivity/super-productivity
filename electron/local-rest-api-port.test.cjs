const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { resolveLocalRestApiPort } = require('./local-rest-api-port.ts');

const DEFAULT_PORT = 3876;

const resolveFull = ({ argv = ['electron', '.'], env = {} } = {}) =>
  resolveLocalRestApiPort({ argv, env, defaultPort: DEFAULT_PORT });
const resolve = (options) => resolveFull(options).port;

const withArg = (value) => ['electron', '.', `--rest-api-port=${value}`];
const withEnv = (value) => ({ SP_LOCAL_REST_API_PORT: value });

test('uses the default when nothing is set', () => {
  assert.deepEqual(resolveFull(), { port: DEFAULT_PORT, warnings: [] });
});

test('uses --rest-api-port', () => {
  assert.equal(resolve({ argv: withArg('3877') }), 3877);
});

test('uses SP_LOCAL_REST_API_PORT', () => {
  assert.equal(resolve({ env: withEnv('3878') }), 3878);
});

test('the flag wins over the environment variable', () => {
  assert.deepEqual(resolveFull({ argv: withArg('3877'), env: withEnv('3878') }), {
    port: 3877,
    warnings: [],
  });
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
  assert.equal(
    resolveLocalRestApiPort({ argv: [], env: {}, defaultPort: 4000 }).port,
    4000,
  );
});

test('warns about a rejected flag value', () => {
  assert.deepEqual(resolveFull({ argv: withArg('80') }).warnings, [
    'Ignoring --rest-api-port="80": not a port from 1024 to 65535',
  ]);
});

test('warns about a rejected environment value', () => {
  assert.deepEqual(resolveFull({ env: withEnv('abc') }).warnings, [
    'Ignoring SP_LOCAL_REST_API_PORT="abc": not a port from 1024 to 65535',
  ]);
});

test('warns about both when the flag falls back to a rejected variable', () => {
  const result = resolveFull({ argv: withArg('x'), env: withEnv('y') });
  assert.equal(result.port, DEFAULT_PORT);
  assert.equal(result.warnings.length, 2);
});

test('does not check the variable when the flag is valid', () => {
  assert.deepEqual(resolveFull({ argv: withArg('3877'), env: withEnv('abc') }), {
    port: 3877,
    warnings: [],
  });
});

test('an empty variable counts as unset', () => {
  assert.deepEqual(resolveFull({ env: withEnv('  ') }), {
    port: DEFAULT_PORT,
    warnings: [],
  });
});

test('warns about the space-separated form instead of ignoring it silently', () => {
  const result = resolveFull({ argv: ['electron', '.', '--rest-api-port', '3877'] });
  assert.equal(result.port, DEFAULT_PORT);
  assert.deepEqual(result.warnings, [
    'Ignoring --rest-api-port without a value: use --rest-api-port=<port>',
  ]);
});

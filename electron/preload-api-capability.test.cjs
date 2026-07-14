const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { createOneShotApiConsumer } = require(
  path.resolve(__dirname, 'shared-with-frontend/one-shot-api-consumer.ts'),
);

test('a preload capability can only be consumed once', () => {
  const api = { request: () => 'ok' };
  let factoryCalls = 0;
  const consume = createOneShotApiConsumer(() => {
    factoryCalls += 1;
    return api;
  });

  assert.equal(consume(), api);
  assert.equal(consume(), null);
  assert.equal(consume(), null);
  assert.equal(factoryCalls, 1);
});

test('the top-level preload API does not expose raw Jira request methods', () => {
  const preloadSource = fs.readFileSync(path.resolve(__dirname, 'preload.ts'), 'utf8');

  assert.doesNotMatch(preloadSource, /^\s*makeJiraRequest:/m);
  assert.doesNotMatch(preloadSource, /^\s*jiraSetupImgHeaders:/m);
  assert.match(preloadSource, /^\s*consumeJiraApi:/m);
});

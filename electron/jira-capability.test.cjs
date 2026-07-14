const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { JiraCapabilityRegistry } = require(
  path.resolve(__dirname, 'jira-capability.ts'),
);

test('rotates the Jira capability when a renderer document re-registers', () => {
  let counter = 0;
  const registry = new JiraCapabilityRegistry(() => `test-token-${(counter += 1)}`);
  const frame = {};

  const first = registry.register(frame);
  assert.equal(first, 'test-token-1');

  // A reload re-registers the same frame object: a fresh token is issued and
  // the stale one is invalidated, so the reloaded document is never locked out.
  const second = registry.register(frame);
  assert.equal(second, 'test-token-2');
  assert.equal(registry.isAuthorized(frame, first), false);
  assert.equal(registry.isAuthorized(frame, second), true);
});

test('only authorizes the issued token from the same renderer document', () => {
  const registry = new JiraCapabilityRegistry(() => 'test-token');
  const registeredFrame = {};
  const otherFrame = {};
  registry.register(registeredFrame);

  assert.equal(registry.isAuthorized(registeredFrame, 'test-token'), true);
  assert.equal(registry.isAuthorized(registeredFrame, 'wrong-token'), false);
  assert.equal(registry.isAuthorized(otherFrame, 'test-token'), false);
  assert.equal(registry.isAuthorized(registeredFrame, null), false);
});

test('unwraps only an authorized Jira capability envelope', () => {
  const registry = new JiraCapabilityRegistry(() => 'test-token');
  const frame = {};
  registry.register(frame);
  const payload = { requestId: 'request-1' };

  assert.equal(
    registry.unwrap(frame, {
      capabilityToken: 'test-token',
      payload,
    }),
    payload,
  );
  assert.throws(
    () => registry.unwrap(frame, { capabilityToken: 'wrong-token', payload }),
    /unauthorized/i,
  );
  assert.throws(() => registry.unwrap(frame, payload), /unauthorized/i);
});

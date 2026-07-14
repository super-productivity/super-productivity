const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { JiraCapabilityRegistry } = require(
  path.resolve(__dirname, 'jira-capability.ts'),
);

test('issues one Jira capability per renderer document', () => {
  const registry = new JiraCapabilityRegistry(() => 'test-token');
  const frame = {};

  assert.equal(registry.register(frame), 'test-token');
  assert.equal(registry.register(frame), null);
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

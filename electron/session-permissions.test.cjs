const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { isAllowedSessionPermission } = require(
  path.resolve(__dirname, 'session-permissions.ts'),
);

test('allows notifications for desktop reminders', () => {
  assert.equal(isAllowedSessionPermission('notifications'), true);
});

test('allows clipboard writes so navigator.clipboard.writeText() works', () => {
  assert.equal(isAllowedSessionPermission('clipboard-sanitized-write'), true);
});

test('keeps clipboard reads and device access denied', () => {
  for (const permission of [
    'clipboard-read',
    'media',
    'geolocation',
    'midi',
    'hid',
    'openExternal',
    '',
  ]) {
    assert.equal(isAllowedSessionPermission(permission), false, permission);
  }
});

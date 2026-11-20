const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { createBeforeCloseActions } = require(
  path.resolve(__dirname, 'before-close-actions.ts'),
);

const setup = () => {
  const actions = createBeforeCloseActions();
  actions.register('save', false);
  actions.register('finish-day', true);
  return actions;
};

test('all confirmations finish before pending save work starts', () => {
  const actions = setup();
  actions.register('confirm-other', true);

  assert.deepEqual(actions.start(), ['finish-day', 'confirm-other']);
  assert.equal(actions.complete('finish-day'), 'wait');
  assert.equal(actions.complete('confirm-other'), 'notify');
  assert.deepEqual(actions.start(), ['save']);
  assert.equal(actions.complete('save'), 'quit');
});

test('Finish Day leaves the save pending for the next quit', () => {
  const actions = setup();

  assert.deepEqual(actions.start(), ['finish-day']);
  // Finish Day keeps the app open and sends no completion.
  assert.deepEqual(actions.start(), ['finish-day']);
  assert.equal(actions.complete('finish-day'), 'notify');
  assert.deepEqual(actions.start(), ['save']);
  assert.equal(actions.complete('save'), 'quit');
});

test('a confirmation already shown can finish after its setting is disabled', () => {
  const actions = setup();

  assert.deepEqual(actions.start(), ['finish-day']);
  actions.unregister('finish-day');
  assert.equal(actions.complete('finish-day'), 'notify');
  assert.deepEqual(actions.start(), ['save']);
});

test('the next quit skips a confirmation disabled while the prompt was open', () => {
  const actions = setup();

  assert.deepEqual(actions.start(), ['finish-day']);
  actions.unregister('finish-day');
  assert.deepEqual(actions.start(), ['save']);
  assert.equal(actions.complete('finish-day'), 'ignore');
  assert.equal(actions.complete('save'), 'quit');
});

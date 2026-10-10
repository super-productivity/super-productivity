import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction } from './decide';

const base = {
  matchId: 'm',
  currentTaskId: null,
  autoStartedId: null,
  isAutoSwitch: false,
};

test('does nothing when the match is already tracked', () => {
  assert.equal(decideAction({ ...base, currentTaskId: 'm', isAutoSwitch: true }), 'none');
});

test('suggests by default', () => {
  assert.equal(decideAction(base), 'suggest');
  assert.equal(decideAction({ ...base, currentTaskId: 'x' }), 'suggest');
});

test('auto-switch acts when nothing is tracked or the plugin started the task', () => {
  assert.equal(decideAction({ ...base, isAutoSwitch: true }), 'switch');
  assert.equal(
    decideAction({ ...base, isAutoSwitch: true, currentTaskId: 'x', autoStartedId: 'x' }),
    'switch',
  );
});

test('auto-switch never overrides a task the user picked', () => {
  assert.equal(
    decideAction({ ...base, isAutoSwitch: true, currentTaskId: 'x' }),
    'suggest',
  );
});

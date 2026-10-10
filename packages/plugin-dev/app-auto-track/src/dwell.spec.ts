import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_DWELL_STATE, stepDwell, type DwellState } from './dwell';

const DWELL = 100;

const run = (samples: [string | null, number][]): (string | null)[] => {
  let state: DwellState = INITIAL_DWELL_STATE;
  return samples.map(([id, now]) => {
    const step = stepDwell(state, id, now, DWELL);
    state = step.state;
    return step.fireId;
  });
};

test('fires once after the dwell time', () => {
  assert.deepEqual(
    run([
      ['a', 0],
      ['a', 50],
      ['a', 100],
      ['a', 200],
    ]),
    [null, null, 'a', null],
  );
});

test('a different match restarts the clock', () => {
  assert.deepEqual(
    run([
      ['a', 0],
      ['b', 50],
      ['b', 100],
      ['b', 150],
    ]),
    [null, null, null, 'b'],
  );
});

test('unmatched samples do not reset the candidate', () => {
  assert.deepEqual(
    run([
      ['a', 0],
      [null, 50],
      ['a', 100],
    ]),
    [null, null, 'a'],
  );
});

test('returning to a previous match after another one fires again', () => {
  assert.deepEqual(
    run([
      ['a', 0],
      ['a', 100],
      ['b', 150],
      ['a', 200],
      ['a', 300],
    ]),
    [null, 'a', null, null, 'a'],
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_DWELL_STATE, stepDwell, type DwellState } from './dwell';

const TIMING = { dwellMs: 100, maxGapMs: 30 };

const run = (samples: [string | null, number][]): (string | null)[] => {
  let state: DwellState = INITIAL_DWELL_STATE;
  return samples.map(([matchId, now]) => {
    const step = stepDwell(state, { matchId, now }, TIMING);
    state = step.state;
    return step.fireId;
  });
};

const every10 = (
  id: string | null,
  from: number,
  to: number,
): [string | null, number][] =>
  Array.from({ length: (to - from) / 10 + 1 }, (_, i) => [id, from + i * 10]);

test('fires once after the dwell time', () => {
  const fired = run(every10('a', 0, 200));
  assert.deepEqual(
    fired.filter((id) => id),
    ['a'],
  );
  assert.equal(fired.indexOf('a'), 10);
});

test('a different match restarts the clock', () => {
  const fired = run([...every10('a', 0, 50), ...every10('b', 60, 160)]);
  assert.equal(fired.indexOf('b'), 6 + 10);
});

test('short unmatched gaps do not reset the candidate', () => {
  const fired = run([
    ...every10('a', 0, 50),
    [null, 60],
    [null, 70],
    ...every10('a', 80, 100),
  ]);
  assert.equal(fired.at(-1), 'a');
});

test('a long gap restarts the clock instead of firing on return', () => {
  assert.deepEqual(run([['a', 0], ...every10(null, 10, 1000), ['a', 1010]]).at(-1), null);
  // no samples at all, e.g. sleep
  assert.deepEqual(
    run([
      ['a', 0],
      ['a', 5000],
    ]),
    [null, null],
  );
});

test('returning to a previous match after another one fires again', () => {
  const fired = run([
    ...every10('a', 0, 100),
    ...every10('b', 110, 120),
    ...every10('a', 130, 230),
  ]);
  assert.deepEqual(
    fired.filter((id) => id),
    ['a', 'a'],
  );
});

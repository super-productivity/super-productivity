import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProposal } from './check';
import type { ChangeRow, Proposal } from '../core/types';

const stamp = {
  title: 'x',
  isDone: false,
  dueDay: null,
  dueWithTime: null,
  timeEstimate: 0,
} as never;
const proposal = (changes: ChangeRow[], extra: Partial<Proposal> = {}): Proposal => ({
  changes,
  selection: null,
  say: null,
  dropped: [],
  isTooMany: false,
  isDayPlan: false,
  ...extra,
});

test('matches an add by title part, day and estimate', () => {
  const p = proposal([
    {
      kind: 'add',
      key: 'r1',
      ref: 'n1',
      title: 'Call the plumber',
      dueDay: '2026-11-04',
      timeEstimate: 900000,
    },
  ]);
  assert.deepEqual(
    checkProposal(p, {
      adds: [{ titleIncludes: 'PLUMBER', dueDay: '2026-11-04', estimateMin: 15 }],
    }),
    [],
  );
  assert.deepEqual(
    checkProposal(p, { adds: [{ titleIncludes: 'plumber', dueDay: '2026-11-05' }] }),
    ['no add like “plumber”'],
  );
});

test('fails on changes nobody asked for', () => {
  const p = proposal([
    { kind: 'update', key: 'r1', taskId: 'a', stamp, dueDay: '2026-11-06' },
    { kind: 'update', key: 'r2', taskId: 'b', stamp, isDone: true },
    { kind: 'delete', key: 'r3', taskId: 'c', stamp },
  ]);
  assert.deepEqual(
    checkProposal(p, { updates: [{ taskId: 'a', dueDay: '2026-11-06' }] }),
    ['changed b unasked', 'deleted c unasked'],
  );
  assert.deepEqual(
    checkProposal(p, { updates: [{ taskId: 'a' }], allowTouch: ['b'], deletes: ['c'] }),
    [],
  );
});

test('reports a wrong field, a missing selection item and a missing say', () => {
  const p = proposal([{ kind: 'update', key: 'r1', taskId: 'a', stamp, isDone: false }], {
    selection: { title: 'Focus', items: [{ taskId: 'x', reason: 'due' }] },
  });
  assert.deepEqual(
    checkProposal(p, {
      updates: [{ taskId: 'a', isDone: true }],
      selectionIncludes: ['x', 'y'],
      isSay: true,
    }),
    ['a: done false ≠ true', 'selection lacks y', 'no say'],
  );
});

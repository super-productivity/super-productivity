import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRows, type WriteApi } from './apply';
import { stampOf } from './stamp';
import { TODAY, snapshot, task } from './test-fixtures';
import type { ChangeRow, TaskLike } from './types';

interface Call {
  op: string;
  args: unknown[];
}

const fakeApi = (
  tasks: TaskLike[],
  failAdd?: string,
): { api: WriteApi; calls: Call[] } => {
  const calls: Call[] = [];
  let n = 0;
  const api: WriteApi = {
    getTasks: async () => tasks,
    addTask: async (data) => {
      calls.push({ op: 'add', args: [data] });
      if (data.title === failAdd) throw new Error('nope');
      return `new${++n}`;
    },
    updateTask: async (...args) => void calls.push({ op: 'update', args }),
    deleteTask: async (...args) => void calls.push({ op: 'delete', args }),
  };
  return { api, calls };
};

test('adds parents first, then updates, then deletes, verbatim titles', async () => {
  const a = task('a', { notes: 'old note' });
  const b = task('b');
  const rows: ChangeRow[] = [
    { kind: 'delete', key: 'r4', taskId: 'b', stamp: stampOf(b) },
    {
      kind: 'update',
      key: 'r3',
      taskId: 'a',
      stamp: stampOf(a),
      dueDay: null,
      appendNote: 'more',
      projectId: 'p2',
    },
    { kind: 'add', key: 'r1', ref: 'n1', title: 'Parent #x' },
    { kind: 'add', key: 'r2', ref: 'c1', title: 'Child', parentRef: 'n1' },
  ];
  const { api, calls } = fakeApi([a, b]);
  const results = await applyRows(api, rows, snapshot([a, b]));
  assert.deepEqual(
    calls.map((c) => c.op),
    ['add', 'add', 'update', 'update', 'delete'],
  );
  assert.deepEqual(calls[0].args[0], {
    title: 'Parent #x',
    projectId: undefined,
    tagIds: undefined,
    dueDay: undefined,
    timeEstimate: undefined,
    parentId: undefined,
    notes: undefined,
    isIgnoreShortSyntax: true,
  });
  assert.equal((calls[1].args[0] as { parentId: string }).parentId, 'new1');
  assert.deepEqual(calls[2].args, [
    'a',
    { dueDay: null, notes: 'old note\n\nmore' },
    { isIgnoreShortSyntax: true },
  ]);
  assert.deepEqual(calls[3].args, ['a', { projectId: 'p2' }]);
  assert.equal(
    results.every((r) => !r.error),
    true,
  );
});

test('stale and deleted tasks are skipped, the rest applies', async () => {
  const a = task('a', { dueDay: TODAY });
  const b = task('b');
  const rows: ChangeRow[] = [
    { kind: 'update', key: 'r1', taskId: 'a', stamp: stampOf(a), isDone: true },
    { kind: 'update', key: 'r2', taskId: 'b', stamp: stampOf(b), isDone: true },
    { kind: 'delete', key: 'r3', taskId: 'gone', stamp: stampOf(task('gone')) },
  ];
  const changedA = { ...a, title: 'Renamed meanwhile' };
  const { api, calls } = fakeApi([changedA, b]);
  const results = await applyRows(api, rows, snapshot([a, b, task('gone')]));
  assert.match(results[0].error || '', /changed in the meantime/);
  assert.equal(results[1].error, undefined);
  assert.match(results[2].error || '', /deleted in the meantime/);
  assert.equal(calls.length, 1);
});

test('a child of a failed new parent is not added', async () => {
  const rows: ChangeRow[] = [
    { kind: 'add', key: 'r1', ref: 'n1', title: 'Parent' },
    { kind: 'add', key: 'r2', ref: 'c1', title: 'Child', parentRef: 'n1' },
  ];
  const { api, calls } = fakeApi([], 'Parent');
  const results = await applyRows(api, rows, snapshot([]));
  assert.equal(results[0].error, 'nope');
  assert.match(results[1].error || '', /parent task was not added/);
  assert.equal(calls.length, 1);
});

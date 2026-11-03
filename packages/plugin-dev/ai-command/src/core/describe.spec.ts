import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRow, planSummary } from './describe';
import { stampOf } from './stamp';
import { TODAY, snapshot, task } from './test-fixtures';

const H = 3_600_000;

test('describes an update old → new', () => {
  const t = task('a', { title: 'Old', dueDay: TODAY, timeEstimate: H, tagIds: ['g1'] });
  const s = snapshot([t]);
  const text = describeRow(
    {
      kind: 'update',
      key: 'r1',
      taskId: 'a',
      stamp: stampOf(t),
      title: 'New',
      dueDay: '2026-11-04',
      timeEstimate: 2 * H,
      isDone: true,
      projectId: 'p2',
      tagIds: ['g2'],
    },
    s,
  );
  assert.equal(text.title, 'New');
  assert.deepEqual(text.what, [
    'Renamed from “Old”',
    'Today → Tomorrow',
    'Estimate 1 h → 2 h',
    'Marked done',
    'Inbox → Website',
    '+ tag calls',
    '− tag errands',
  ]);
});

test('describes an add and a delete', () => {
  const s = snapshot([task('a', { title: 'Gone' })]);
  const add = describeRow(
    {
      kind: 'add',
      key: 'r1',
      ref: 'n1',
      title: 'Milk',
      projectId: 'p2',
      dueDay: TODAY,
      tagIds: ['g1'],
    },
    s,
  );
  assert.deepEqual(add, { title: 'Milk', what: ['Website', 'Today', '+ tag errands'] });
  const del = describeRow(
    { kind: 'delete', key: 'r2', taskId: 'a', stamp: stampOf(s.tasks[0]) },
    s,
  );
  assert.deepEqual(del, { title: 'Gone', what: ['Delete'] });
});

test('plan summary counts today after the moves and flags overplanning', () => {
  const a = task('a', { dueDay: TODAY, timeEstimate: 5 * H });
  const b = task('b', { dueDay: '2026-11-05', timeEstimate: 4 * H });
  const rows = [
    { kind: 'update' as const, key: 'r1', taskId: 'b', stamp: stampOf(b), dueDay: TODAY },
  ];
  assert.equal(
    planSummary(rows, snapshot([a, b])),
    'Today: 2 tasks, 9 h of 8 h free, over by 1 h',
  );
  const off = [
    { kind: 'update' as const, key: 'r1', taskId: 'a', stamp: stampOf(a), dueDay: null },
  ];
  assert.equal(planSummary(off, snapshot([a, b])), 'Today: 0 tasks, 0 min of 8 h free');
});

test('a delete names the subtasks it takes with it', () => {
  const s = snapshot([task('p', { title: 'Trip', subTaskIds: ['c1', 'c2'] })]);
  const del = describeRow(
    { kind: 'delete', key: 'r1', taskId: 'p', stamp: stampOf(s.tasks[0]) },
    s,
  );
  assert.deepEqual(del, { title: 'Trip', what: ['Delete with 2 subtasks'] });
});

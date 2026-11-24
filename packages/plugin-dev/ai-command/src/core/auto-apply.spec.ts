import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApplyWithoutReview } from './auto-apply';
import { buildContext } from './context';
import { validateCalls } from './validate';
import { TODAY, snapshot, task } from './test-fixtures';
import type { Snapshot, ToolCall } from './types';

const check = (s: Snapshot, request: string, calls: ToolCall[]): boolean => {
  const ctx = buildContext(s, request);
  return canApplyWithoutReview(validateCalls(ctx, calls).proposal, ctx);
};
const done = (id: string): ToolCall => ({
  name: 'update_task',
  input: { id, done: true },
});

test('applies a plain add and a change to a task the user named', () => {
  const s = snapshot([task('a', { title: 'Dentist', dueDay: TODAY })]);
  assert.equal(check(s, 'dentist done', [done('t1')]), true);
  assert.equal(
    check(s, 'add milk', [{ name: 'add_task', input: { ref: 'n1', title: 'Milk' } }]),
    true,
  );
});

test('never for radar-only tasks, deletes or project moves', () => {
  const s = snapshot([task('a', { title: 'Dentist', dueDay: TODAY })]);
  assert.equal(check(s, 'finish everything', [done('t1')]), false);
  assert.equal(
    check(s, 'dentist', [{ name: 'delete_task', input: { id: 't1' } }]),
    false,
  );
  assert.equal(
    check(s, 'dentist', [
      { name: 'update_task', input: { id: 't1', project: 'Website' } },
    ]),
    false,
  );
});

test('selected tasks count as named', () => {
  const s = snapshot([task('a', { title: 'Dentist', dueDay: TODAY })], {
    selectionIds: ['a'],
  });
  assert.equal(check(s, 'these are finished', [done('t1')]), true);
});

test('done stays manual for reminders, the current task, parents and subtasks', () => {
  const tasks = [
    task('r', { title: 'Alpha', remindAt: 5 }),
    task('c', { title: 'Bravo' }),
    task('p', { title: 'Charlie', subTaskIds: ['s'] }),
    task('s', { title: 'Delta', parentId: 'p' }),
  ];
  const s = snapshot(tasks, { currentTaskId: 'c' });
  for (const name of ['alpha', 'bravo', 'charlie', 'delta']) {
    const ctx = buildContext(s, name);
    const alias = ctx.sent.tasks.find((t) => t.title.toLowerCase() === name)
      ?.id as string;
    assert.equal(
      canApplyWithoutReview(validateCalls(ctx, [done(alias)]).proposal, ctx),
      false,
      name,
    );
  }
});

test('not with dropped notes, a selection only, or more than 10 changes', () => {
  const s = snapshot([task('a', { title: 'Dentist', dueDay: TODAY })]);
  assert.equal(
    check(s, 'dentist', [
      done('t1'),
      { name: 'update_task', input: { id: 't9', done: true } },
    ]),
    false,
  );
  assert.equal(
    check(s, 'dentist', [
      { name: 'show_tasks', input: { title: 'x', items: [{ id: 't1', reason: 'y' }] } },
    ]),
    false,
  );
  const adds = Array.from({ length: 11 }, (_, i) => ({
    name: 'add_task',
    input: { ref: `n${i}`, title: `T${i}` },
  }));
  assert.equal(check(s, 'add', adds), false);
});

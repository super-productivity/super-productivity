import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalls, shapeError } from './parse-calls';

test('shapeError catches unknown tools, fields, missing and wrong types', () => {
  assert.match(shapeError({ name: 'run_shell', input: {} }) || '', /unknown tool/);
  assert.match(shapeError({ name: 'say', input: 'x' }) || '', /not an object/);
  assert.match(
    shapeError({ name: 'add_task', input: { title: 'x' } }) || '',
    /ref is missing/,
  );
  assert.match(
    shapeError({ name: 'update_task', input: { id: 't1', remindAt: 1 } }) || '',
    /unknown field/,
  );
  assert.match(
    shapeError({ name: 'update_task', input: { id: 't1', done: 'yes' } }) || '',
    /boolean/,
  );
  assert.match(
    shapeError({ name: 'show_tasks', input: { title: 'x', items: [{ id: 't1' }] } }) ||
      '',
    /items/,
  );
  assert.equal(shapeError({ name: 'update_task', input: { id: 't1', day: null } }), null);
});

test('parseCalls sorts calls, drops nulls and keeps errors', () => {
  const parsed = parseCalls([
    { name: 'add_task', input: { ref: 'n1', title: 'A', project: null } },
    { name: 'update_task', input: { id: 't1', day: '2026-11-04' } },
    { name: 'delete_task', input: { id: 't2' } },
    {
      name: 'show_tasks',
      input: { title: 'Focus', items: [{ id: 't1', reason: 'due' }] },
    },
    { name: 'say', input: { text: 'Ok.' } },
    { name: 'nope', input: {} },
  ]);
  assert.deepEqual(parsed.adds, [{ ref: 'n1', title: 'A' }]);
  assert.equal(parsed.updates.length, 1);
  assert.equal(parsed.deletes.length, 1);
  assert.equal(parsed.shows.length, 1);
  assert.deepEqual(parsed.says, ['Ok.']);
  assert.equal(parsed.errors.length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnMatches, dropWrite } from './board';
import type { Tag } from '@super-productivity/plugin-api';
import { TAGS, task } from './test-fixtures';

const todo = { id: 'todo', title: 'To do', notTags: ['Doing'], isDone: false };
const doing = { id: 'doing', title: 'Doing', tags: ['Doing'], isDone: false };
const done = { id: 'done', title: 'Done', isDone: true };

test('columns follow native board panel rules', () => {
  const open = task('a');
  const started = task('b', { tagIds: ['t-doing'] });
  const finished = task('c', { isDone: true, tagIds: ['t-doing'] });
  assert.deepEqual(
    [open, started, finished].map((t) =>
      [todo, doing, done].filter((c) => columnMatches(t, c, TAGS)).map((c) => c.id),
    ),
    [['todo'], ['doing'], ['done']],
  );
});

test('a column naming a tag that does not exist matches nothing', () => {
  assert.equal(
    columnMatches(task('a'), { id: 'x', title: 'X', tags: ['Waiting'] }, TAGS),
    false,
  );
});

test('dropping adds the column tags, removes its excluded tags and sets done', () => {
  assert.deepEqual(dropWrite(task('a'), doing, TAGS), {
    changes: { tagIds: ['t-doing'] },
    missingTags: [],
  });
  assert.deepEqual(
    dropWrite(task('b', { tagIds: ['t-doing', 't-urgent'] }), todo, TAGS),
    {
      changes: { tagIds: ['t-urgent'] },
      missingTags: [],
    },
  );
  assert.deepEqual(dropWrite(task('c', { tagIds: ['t-doing'] }), done, TAGS), {
    changes: { isDone: true },
    missingTags: [],
  });
});

test('dropping into the column a task already fits changes nothing', () => {
  assert.equal(dropWrite(task('a', { tagIds: ['t-doing'] }), doing, TAGS), null);
});

test('missing tags are reported so the caller can create them first', () => {
  const waiting = { id: 'w', title: 'Waiting', tags: ['Waiting'] };
  assert.deepEqual(dropWrite(task('a'), waiting, TAGS), {
    changes: {},
    missingTags: [{ title: 'Waiting' }],
  });
});

const BUILT_IN = [
  { id: 'KANBAN_IN_PROGRESS', title: 'in-progress', taskIds: [] },
  { id: 'EM_URGENT', title: 'urgent', taskIds: [] },
] as unknown as Tag[];
const inProgress = { id: 'p', title: 'Doing', tags: ['@doing'], isDone: false };
const notStarted = { id: 'n', title: 'To do', notTags: ['@doing'], isDone: false };

test('@doing stands for the built-in in-progress tag, whatever it is called', () => {
  const started = task('b', { tagIds: ['KANBAN_IN_PROGRESS'] });
  assert.equal(columnMatches(started, inProgress, BUILT_IN), true);
  assert.equal(columnMatches(started, notStarted, BUILT_IN), false);
  assert.equal(columnMatches(task('a'), notStarted, BUILT_IN), true);
  // a user tag that happens to be titled "Doing" is not the alias
  const userTag = task('c', { tagIds: ['t-doing'] });
  assert.equal(columnMatches(userTag, inProgress, [...BUILT_IN, ...TAGS]), false);
});

test('dropping into an alias column writes the built-in tag id', () => {
  assert.deepEqual(dropWrite(task('a'), inProgress, BUILT_IN), {
    changes: { tagIds: ['KANBAN_IN_PROGRESS'] },
    missingTags: [],
  });
  assert.deepEqual(
    dropWrite(task('b', { tagIds: ['KANBAN_IN_PROGRESS', 't-x'] }), notStarted, BUILT_IN),
    { changes: { tagIds: ['t-x'] }, missingTags: [] },
  );
});

test('a missing built-in tag is created under its own id, once per name', () => {
  const urgent = { id: 'u', title: 'Urgent', tags: ['@urgent', '@doing'] };
  assert.deepEqual(dropWrite(task('a'), urgent, []), {
    changes: {},
    missingTags: [
      { id: 'EM_URGENT', title: 'urgent', icon: 'emergency' },
      { id: 'KANBAN_IN_PROGRESS', title: 'in-progress' },
    ],
  });
});

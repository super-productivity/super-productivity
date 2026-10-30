import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnMatches, dropWrite } from './board';
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
    missingTags: ['Waiting'],
  });
});

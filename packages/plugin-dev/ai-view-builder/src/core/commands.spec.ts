import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchViewByName, parseLocalCommand } from './commands';

test('undo, redo and new view are understood without the model', () => {
  assert.deepEqual(parseLocalCommand('Undo.'), { kind: 'undo' });
  assert.deepEqual(parseLocalCommand('please go back'), { kind: 'undo' });
  assert.deepEqual(parseLocalCommand('redo'), { kind: 'redo' });
  assert.deepEqual(parseLocalCommand('New view'), { kind: 'newView' });
});

test('switching views by name', () => {
  assert.deepEqual(parseLocalCommand('Switch to the weekly review view'), {
    kind: 'switchView',
    name: 'weekly review',
  });
  const views = [{ title: 'Weekly review' }, { title: 'Kanban' }];
  assert.equal(matchViewByName(views, 'weekly review')?.title, 'Weekly review');
  assert.equal(matchViewByName(views, 'kan')?.title, 'Kanban');
  assert.equal(matchViewByName(views, 'calendar'), null);
});

test('everything else goes to the model', () => {
  assert.equal(parseLocalCommand('group by project'), null);
  assert.equal(parseLocalCommand('undo the grouping and sort by due date'), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveWorkContext } from '@super-productivity/plugin-api';
import { dueDayOf, logicalDayOf, needsArchive, runQuery, weekRange } from './query';
import { at, DAY, env, task } from './test-fixtures';

const ids = (q: Parameters<typeof runQuery>[0], e: ReturnType<typeof env>): string[] =>
  runQuery(q, e).tasks.map((t) => t.id);

test('a timestamp before the start of the next day belongs to the previous day', () => {
  assert.equal(logicalDayOf(at('2026-10-30', 2), DAY), '2026-10-29');
  assert.equal(logicalDayOf(at('2026-10-30', 5), DAY), '2026-10-30');
});

test('the week follows the first day of the week', () => {
  assert.deepEqual(weekRange(DAY), { start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(weekRange({ ...DAY, firstDayOfWeek: 0 }), {
    start: '2026-10-25',
    end: '2026-10-31',
  });
});

test('a due time wins over a due day', () => {
  const t = task('a', { dueDay: '2026-10-28', dueWithTime: at('2026-10-29', 15) });
  assert.equal(dueDayOf(t, DAY), '2026-10-29');
});

test('due tokens follow the logical day', () => {
  const tasks = [
    task('today', { dueDay: '2026-10-29' }),
    task('late-night', { dueWithTime: at('2026-10-30', 2) }),
    task('tomorrow', { dueDay: '2026-10-30' }),
    task('overdue', { dueDay: '2026-10-20' }),
    task('overdue-done', { dueDay: '2026-10-20', isDone: true }),
    task('none'),
  ];
  const e = env(tasks);
  assert.deepEqual(ids({ due: 'today' }, e), ['today', 'late-night']);
  assert.deepEqual(ids({ due: 'tomorrow' }, e), ['tomorrow']);
  assert.deepEqual(ids({ due: 'overdue' }, e), ['overdue']);
  assert.deepEqual(ids({ due: 'none' }, e), ['none']);
  assert.deepEqual(ids({ due: 'thisWeek' }, e), ['today', 'late-night', 'tomorrow']);
});

test('@current follows the open project, tag or Today, with its order', () => {
  const tasks = [
    task('a', { created: 1 }),
    task('b', { created: 2 }),
    task('c', { projectId: 'p-home', tagIds: ['t-doing'], dueDay: '2026-10-29' }),
  ];
  const project = { id: 'p-work', type: 'PROJECT', title: 'Work', taskIds: ['b', 'a'] };
  assert.deepEqual(
    ids({ scope: '@current' }, env(tasks, { context: project as ActiveWorkContext })),
    ['b', 'a'],
  );
  const tag = { id: 't-doing', type: 'TAG', title: 'Doing', taskIds: [] };
  assert.deepEqual(
    ids({ scope: '@current' }, env(tasks, { context: tag as ActiveWorkContext })),
    ['c'],
  );
  const today = { id: 'TODAY', type: 'TODAY', title: 'Today', taskIds: [] };
  assert.deepEqual(
    ids({ scope: '@current' }, env(tasks, { context: today as ActiveWorkContext })),
    ['c'],
  );
});

test('scopes and tags resolve by name, case-insensitively, and report unknown names', () => {
  const tasks = [task('a'), task('b', { projectId: 'p-home', tagIds: ['t-urgent'] })];
  assert.deepEqual(ids({ scope: 'home' }, env(tasks)), ['b']);
  assert.deepEqual(ids({ scope: 'URGENT' }, env(tasks)), ['b']);
  const missing = runQuery({ scope: 'Garden' }, env(tasks));
  assert.deepEqual(missing.tasks, []);
  assert.deepEqual(missing.problems, ['No project or tag named "Garden"']);
});

test('tags match all by default, any on request; a missing tag matches nothing', () => {
  const tasks = [
    task('both', { tagIds: ['t-urgent', 't-important'] }),
    task('urgent', { tagIds: ['t-urgent'] }),
    task('none'),
  ];
  const e = env(tasks);
  assert.deepEqual(ids({ tags: ['Urgent', 'Important'] }, e), ['both']);
  assert.deepEqual(ids({ tags: ['Urgent', 'Important'], tagsMatch: 'any' }, e), [
    'both',
    'urgent',
  ]);
  assert.deepEqual(ids({ notTags: ['Urgent'] }, e), ['none']);
  const r = runQuery({ tags: ['Someday'] }, e);
  assert.deepEqual(r.tasks, []);
  assert.deepEqual(r.problems, ['No tag named "Someday"']);
});

test('subtasks are hidden unless asked for', () => {
  const tasks = [
    task('parent', { subTaskIds: ['child'] }),
    task('child', { parentId: 'parent' }),
  ];
  assert.deepEqual(ids({}, env(tasks)), ['parent']);
  assert.deepEqual(ids({ parentsOnly: false }, env(tasks)), ['parent', 'child']);
});

test('priority accepts numbers and the older string form', () => {
  const tasks = [
    task('high', { priority: 3 }),
    task('legacy-high', { priority: 'high' }),
    task('low', { priority: 1 }),
    task('none'),
  ];
  const e = env(tasks);
  assert.deepEqual(ids({ priority: ['high'] }, e), ['high', 'legacy-high']);
  assert.deepEqual(ids({ priority: ['none'] }, e), ['none']);
  assert.deepEqual(ids({ sort: 'priority' }, e), ['high', 'legacy-high', 'low', 'none']);
});

test('doneOn uses the logical day and looks in the archive by itself', () => {
  const tasks = [task('today', { isDone: true, doneOn: at('2026-10-30', 1) })];
  const archived = [task('monday', { isDone: true, doneOn: at('2026-10-26', 12) })];
  const e = env(tasks, { archivedTasks: archived });
  assert.deepEqual(ids({ doneOn: 'today' }, e), ['today']);
  // Changed on purpose: doneOn used to need includeArchived, so a weekly
  // review silently missed what was archived earlier in the week.
  assert.deepEqual(ids({ doneOn: 'thisWeek' }, e), ['today', 'monday']);
  assert.deepEqual(ids({ doneOn: 'thisWeek', includeArchived: true }, e), [
    'today',
    'monday',
  ]);
});

test('sorting, direction and limit', () => {
  const tasks = [
    task('b', { title: 'Beta', timeEstimate: 30 }),
    task('a', { title: 'Alpha', timeEstimate: 60 }),
    task('c', { title: 'Gamma', timeEstimate: 10 }),
  ];
  const e = env(tasks);
  assert.deepEqual(ids({ sort: 'title' }, e), ['a', 'b', 'c']);
  assert.deepEqual(ids({ sort: 'estimate', sortDir: 'desc' }, e), ['a', 'b', 'c']);
  assert.deepEqual(ids({ sort: 'title', limit: 2 }, e), ['a', 'b']);
});

test('the archive is loaded for doneOn and includeArchived, not otherwise', () => {
  assert.equal(needsArchive([{ doneOn: 'thisWeek' }]), true);
  assert.equal(needsArchive([{ includeArchived: true }]), true);
  assert.equal(needsArchive([{ isDone: true }]), false);
});

test('a task in both lists is counted once', () => {
  const done = task('a', { isDone: true, doneOn: at('2026-10-29', 10) });
  const e = env([done], { archivedTasks: [done] });
  assert.deepEqual(ids({ doneOn: 'today' }, e), ['a']);
});

test('the older scope "today" keeps working for saved views', () => {
  const tasks = [
    task('a', { dueDay: '2026-10-29' }),
    task('b', { dueDay: '2026-10-30' }),
  ];
  assert.deepEqual(ids({ scope: 'today' }, env(tasks)), ['a']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, formatDuration, NodeModel, specNeedsArchive } from './model';
import { ViewSpec } from './spec';
import { env, task } from './test-fixtures';

const spec = (partial: Partial<ViewSpec>): ViewSpec => ({
  specVersion: 1,
  title: 'T',
  root: 'main',
  components: {},
  queries: { all: {} },
  ...partial,
});

test('a board places each task in the column whose rule it meets', () => {
  const model = buildModel(
    spec({
      components: {
        main: {
          type: 'board',
          query: 'all',
          columns: [
            { id: 'todo', title: 'To do', notTags: ['Doing'], isDone: false },
            { id: 'doing', title: 'Doing', tags: ['Doing'] },
          ],
        },
      },
    }),
    env([task('a'), task('b', { tagIds: ['t-doing'] })]),
  ) as Extract<NodeModel, { kind: 'board' }>;
  assert.deepEqual(
    model.columns.map((c) => [c.id, c.cards.map((x) => x.id)]),
    [
      ['todo', ['a']],
      ['doing', ['b']],
    ],
  );
});

test('task lists group, show fields and mark the tracked task', () => {
  const model = buildModel(
    spec({
      components: {
        main: {
          type: 'taskList',
          query: 'all',
          groupBy: 'project',
          fields: ['estimate'],
        },
      },
    }),
    env([task('a', { timeEstimate: 90 * 60000 }), task('b', { projectId: 'p-home' })], {
      currentTaskId: 'a',
    }),
  ) as Extract<NodeModel, { kind: 'taskList' }>;
  assert.deepEqual(
    model.groups.map((g) => g.label),
    ['Work', 'Home'],
  );
  assert.deepEqual(model.groups[0].cards[0].meta, ['est. 1h 30m']);
  assert.equal(model.groups[0].cards[0].isTracking, true);
});

test('metrics sum over the query, time spent today uses the logical day', () => {
  const model = buildModel(
    spec({
      components: {
        main: { type: 'stack', children: ['n', 't'] },
        n: { type: 'metric', query: 'all', measure: 'count', title: 'Tasks' },
        t: { type: 'metric', query: 'all', measure: 'timeSpentToday', title: 'Today' },
      },
    }),
    env([
      task('a', { timeSpentOnDay: { '2026-10-29': 30 * 60000 } }),
      task('b', { timeSpentOnDay: { '2026-10-28': 60 * 60000 } }),
    ]),
  ) as Extract<NodeModel, { kind: 'container' }>;
  assert.deepEqual(
    model.children.map((c) => (c.kind === 'metric' ? c.value : null)),
    ['2', '30m'],
  );
});

test('unknown types, missing parts and loops render as placeholders', () => {
  const model = buildModel(
    spec({
      components: {
        main: { type: 'stack', children: ['future', 'missing', 'loop'] },
        future: { type: 'calendar' },
        loop: { type: 'stack', children: ['main'] },
      },
    }),
    env([]),
  ) as Extract<NodeModel, { kind: 'container' }>;
  const kinds = model.children.map((c) =>
    c.kind === 'placeholder'
      ? c.message
      : c.kind === 'container'
        ? c.children[0].kind
        : c.kind,
  );
  assert.deepEqual(kinds, [
    'This part needs a newer version of AI View Builder.',
    'Being added…',
    'placeholder',
  ]);
});

test('durations read naturally', () => {
  assert.equal(formatDuration(45 * 60000), '45m');
  assert.equal(formatDuration(120 * 60000), '2h');
  assert.equal(formatDuration(135 * 60000), '2h 15m');
});

test('time spent this week sums the logical week, archived tasks included', () => {
  const week = spec({
    components: { main: { type: 'metric', query: 'all', measure: 'timeSpentThisWeek' } },
  });
  const model = buildModel(
    week,
    env(
      [
        task('a', {
          timeSpentOnDay: { '2026-10-29': 30 * 60000, '2026-10-25': 5 * 60000 * 60 },
        }),
      ],
      {
        archivedTasks: [
          task('old', {
            isDone: true,
            timeSpentOnDay: { '2026-10-26': 60 * 60000, '2026-11-02': 99 * 60000 },
          }),
        ],
      },
    ),
  ) as Extract<NodeModel, { kind: 'metric' }>;
  // Mon 26 to Sun 1: the 25th and the 2nd are outside the week.
  assert.equal(model.value, '1h 30m');
  assert.equal(specNeedsArchive(week), true);
  assert.equal(specNeedsArchive(spec({ queries: { all: {} } })), false);
});

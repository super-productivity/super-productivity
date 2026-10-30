import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './cards';
import { buildModel, NodeModel, specNeedsArchive } from './model';
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
  // Changed on purpose: the estimate has its own slot on a card now, so it no
  // longer arrives as the text "est. 1h 30m" in meta.
  assert.equal(model.groups[0].cards[0].estimate, '1h 30m');
  assert.deepEqual(model.groups[0].cards[0].meta, []);
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

const themed = (env0: ReturnType<typeof env>): ReturnType<typeof env> => ({
  ...env0,
  projects: [
    { ...env0.projects[0], theme: { primary: '#2a7de1' } },
    { ...env0.projects[1], theme: { primary: 'url(https://example.com/x)' } },
  ],
  tags: [
    { ...env0.tags[0], color: '#e1572a' },
    { ...env0.tags[1], color: null, theme: { primary: 'rgb(10, 20, 30)' } },
    { ...env0.tags[2], color: 'red; background: url(x)' },
  ],
});

const firstCard = (
  s: ViewSpec,
  e: ReturnType<typeof env>,
): Extract<NodeModel, { kind: 'taskList' }>['groups'][number]['cards'][number] =>
  (buildModel(s, e) as Extract<NodeModel, { kind: 'taskList' }>).groups[0].cards[0];

const listSpec = (extra: Record<string, unknown> = {}, query = {}): ViewSpec =>
  spec({
    components: { main: { type: 'taskList', query: 'q', ...extra } },
    queries: { q: query },
  });

test('cards show project, tags, estimate and due unless the view says otherwise', () => {
  const t = task('a', {
    tagIds: ['t-doing', 't-urgent', 't-important'],
    timeEstimate: 45 * 60000,
    dueDay: '2026-10-28',
  });
  const card = firstCard(listSpec(), themed(env([t])));
  assert.deepEqual(card.chips, [
    { label: 'Work', color: '#2a7de1' },
    { label: 'Doing', color: '#e1572a' },
    { label: 'Urgent', color: 'rgb(10, 20, 30)' },
    // A color that is not a plain color notation is dropped, not passed on.
    { label: 'Important', color: undefined },
  ]);
  assert.equal(card.estimate, '45m');
  assert.deepEqual(card.due, { text: 'Yesterday', overdue: true });
  assert.deepEqual(firstCard(listSpec({ fields: [] }), themed(env([t]))).chips, []);
  const onlyDue = firstCard(listSpec({ fields: ['due'] }), env([t]));
  assert.equal(onlyDue.estimate, undefined);
  assert.equal(onlyDue.due?.text, 'Yesterday');
});

test('a done task is not overdue and a far day reads as a date', () => {
  const done = firstCard(
    listSpec(),
    env([task('a', { dueDay: '2026-10-20', isDone: true })]),
  );
  assert.equal(done.due?.overdue, false);
  const later = firstCard(listSpec(), env([task('a', { dueDay: '2026-11-12' })]));
  assert.equal(later.due?.overdue, false);
  assert.match(later.due?.text ?? '', /12/);
});

test('the default fields leave the project chip out inside a project', () => {
  const inProject = env([task('a')], {
    context: { id: 'p-work', type: 'PROJECT', taskIds: ['a'] } as never,
  });
  const current = listSpec({}, { scope: '@current' });
  assert.deepEqual(firstCard(current, inProject).chips, []);
  assert.deepEqual(
    firstCard(listSpec({}, { scope: 'work' }), env([task('a')])).chips,
    [],
  );
  // Explicit fields are obeyed, and other scopes keep the chip.
  const explicit = listSpec({ fields: ['project'] }, { scope: '@current' });
  assert.equal(firstCard(explicit, inProject).chips[0]?.label, 'Work');
  assert.equal(
    firstCard(listSpec({}, { scope: 'all' }), env([task('a')])).chips.length,
    1,
  );
});

test('group and column headers carry the estimate sum', () => {
  const tasks = [
    task('a', { timeEstimate: 90 * 60000 }),
    task('b', { timeEstimate: 30 * 60000 }),
    task('c', { projectId: 'p-home', tagIds: ['t-doing'] }),
  ];
  const list = buildModel(listSpec({ groupBy: 'project' }), env(tasks)) as Extract<
    NodeModel,
    { kind: 'taskList' }
  >;
  assert.deepEqual(
    list.groups.map((g) => [g.label, g.cards.length, g.estimate]),
    [
      ['Work', 2, '2h'],
      ['Home', 1, undefined],
    ],
  );
  const board = buildModel(
    spec({
      components: {
        main: {
          type: 'board',
          query: 'all',
          columns: [
            { id: 'todo', title: 'To do', notTags: ['Doing'] },
            { id: 'doing', title: 'Doing', tags: ['Doing'] },
          ],
        },
      },
    }),
    env(tasks),
  ) as Extract<NodeModel, { kind: 'board' }>;
  assert.deepEqual(
    board.columns.map((c) => [c.id, c.cards.length, c.estimate]),
    [
      ['todo', 2, '2h'],
      ['doing', 1, undefined],
    ],
  );
});

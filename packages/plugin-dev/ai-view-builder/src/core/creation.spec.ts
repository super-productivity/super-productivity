import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project, Tag } from '@super-productivity/plugin-api';
import { creationFor, findAddTarget, groupLane, newTaskData } from './creation';
import { buildModel, type NodeModel } from './model';
import type { Query, ViewSpec } from './spec';
import { PROJECTS, TAGS, env, task } from './test-fixtures';

const world = env([]);
const open = { isDone: false };
const IN_PROGRESS = { id: 'KANBAN_IN_PROGRESS', title: 'in-progress' };

test('a lane that requires a built-in tag creates the tag by id when missing', () => {
  const doing = { tags: ['@doing'], isDone: false };
  assert.deepEqual(creationFor({ scope: 'all', ...open }, doing, world), {
    tagIds: ['KANBAN_IN_PROGRESS'],
    missingTags: [IN_PROGRESS],
  });
  const tags = [...TAGS, { id: 'KANBAN_IN_PROGRESS', title: 'Doing now' }] as Tag[];
  assert.deepEqual(creationFor({ scope: 'all' }, doing, env([], { tags })), {
    tagIds: ['KANBAN_IN_PROGRESS'],
    missingTags: [],
  });
});

test('a lane naming an existing tag gets it, one naming no tag gets no Add', () => {
  assert.deepEqual(creationFor({}, { tags: ['Urgent'] }, world), {
    tagIds: ['t-urgent'],
    missingTags: [],
  });
  assert.equal(creationFor({}, { tags: ['Waiting'] }, world), null);
});

test('a done lane and a done query take no new tasks', () => {
  assert.equal(creationFor({}, { isDone: true }, world), null);
  assert.equal(creationFor({ isDone: true }, {}, world), null);
});

test('a lane that only excludes a tag is satisfied by a task without tags', () => {
  assert.deepEqual(creationFor({}, { notTags: ['@doing'], isDone: false }, world), {
    tagIds: [],
    missingTags: [],
  });
});

test('the project is the scope only when the scope names exactly one project', () => {
  assert.equal(creationFor({ scope: 'Work' }, {}, world)?.projectId, 'p-work');
  assert.equal(creationFor({ scope: 'all' }, {}, world)?.projectId, undefined);
  const twins = [...PROJECTS, { id: 'p-work-2', title: 'work' }] as Project[];
  assert.equal(creationFor({ scope: 'Work' }, {}, env([], { projects: twins })), null);
});

test('the current project and Today are scopes that pin a project or a day', () => {
  const project = { id: 'p-home', type: 'PROJECT', title: 'Home', taskIds: [] };
  const today = { id: 'TODAY', type: 'TODAY', title: 'Today', taskIds: [] };
  const inProject = env([], { context: project as never });
  const inToday = env([], { context: today as never });
  assert.equal(creationFor({ scope: '@current' }, {}, inProject)?.projectId, 'p-home');
  assert.equal(creationFor({ scope: '@current' }, {}, inToday)?.dueDay, '2026-10-29');
  assert.equal(creationFor({ scope: 'today' }, {}, world)?.dueDay, '2026-10-29');
});

test('an agenda day sets the due day', () => {
  const tomorrow = { dueDay: '2026-10-30' };
  assert.deepEqual(creationFor(open, tomorrow, world), {
    tagIds: [],
    missingTags: [],
    dueDay: '2026-10-30',
  });
  // The query asks for today only, so a task due tomorrow would vanish.
  assert.equal(creationFor({ due: 'today' }, tomorrow, world), null);
});

test('a due filter of today or tomorrow sets that day', () => {
  assert.equal(creationFor({ due: 'today' }, {}, world)?.dueDay, '2026-10-29');
  assert.equal(creationFor({ due: 'tomorrow' }, {}, world)?.dueDay, '2026-10-30');
  assert.equal(creationFor({ due: 'none' }, {}, world)?.dueDay, undefined);
});

test('filters that creation cannot satisfy take no Add', () => {
  const unsatisfiable = [
    { due: 'overdue' },
    { due: 'thisWeek' },
    { doneOn: 'today' },
    { text: 'invoice' },
    { priority: ['high'] },
    { hasEstimate: true },
    { hasDeadline: true },
    { tags: ['Doing'], notTags: ['Doing'] },
  ] as const;
  for (const query of unsatisfiable) {
    assert.equal(
      creationFor({ ...query } as never, {}, world),
      null,
      JSON.stringify(query),
    );
  }
});

test('filters a fresh task satisfies still take an Add', () => {
  for (const query of [
    { priority: ['none'] },
    { hasEstimate: false },
    { parentsOnly: true },
  ]) {
    assert.ok(creationFor(query as never, {}, world), JSON.stringify(query));
  }
});

test('a query matching any of several tags asks for one of them', () => {
  const query: Query = { tags: ['Doing', 'Urgent'], tagsMatch: 'any' };
  assert.deepEqual(creationFor(query, {}, world)?.tagIds, ['t-doing']);
  assert.deepEqual(creationFor({ tags: ['Doing', 'Urgent'] }, {}, world)?.tagIds, [
    't-doing',
    't-urgent',
  ]);
});

test('a scope that is a tag puts the new task in that tag', () => {
  assert.deepEqual(creationFor({ scope: 'Urgent' }, {}, world)?.tagIds, ['t-urgent']);
});

test('without a query there is nothing to add to', () => {
  assert.equal(creationFor(undefined, {}, world), null);
});

test('a task is created with only the fields the lane fixes', () => {
  assert.deepEqual(newTaskData({ tagIds: [], missingTags: [] }, 'Call'), {
    title: 'Call',
  });
  assert.deepEqual(
    newTaskData(
      { tagIds: ['t-doing'], missingTags: [], projectId: 'p-work', dueDay: '2026-10-30' },
      'Call',
    ),
    { title: 'Call', tagIds: ['t-doing'], projectId: 'p-work', dueDay: '2026-10-30' },
  );
});

test('groups of a list pin their project, tag or day', () => {
  assert.deepEqual(groupLane('project', 'p-home', world), { projectId: 'p-home' });
  assert.equal(groupLane('project', 'none', world), null);
  assert.deepEqual(groupLane('tag', 't-urgent', world), { tagIds: ['t-urgent'] });
  assert.deepEqual(groupLane('tag', 'none', world), {});
  assert.deepEqual(groupLane('due', '2-tomorrow', world), { dueDay: '2026-10-30' });
  assert.equal(groupLane('due', '0-overdue', world), null);
  assert.equal(groupLane('priority', 'high', world), null);
  assert.deepEqual(groupLane(undefined, 'all', world), {});
});

test('a group in another project than the scope takes no Add', () => {
  const lane = groupLane('project', 'p-home', world)!;
  assert.equal(creationFor({ scope: 'Work' }, lane, world), null);
  assert.equal(creationFor({ scope: 'all' }, lane, world)?.projectId, 'p-home');
});

test('the add target of a key is found in the model on screen', () => {
  const creation = { tagIds: [], missingTags: [] };
  const model: NodeModel = {
    kind: 'container',
    cid: 'root',
    layout: 'stack',
    children: [
      {
        kind: 'board',
        cid: 'b',
        columnsPerRow: null,
        problems: [],
        columns: [
          {
            id: 'todo',
            title: 'To do',
            cards: [],
            add: { key: 'lane:b:todo', creation },
          },
          { id: 'done', title: 'Done', cards: [] },
        ],
      },
    ],
  };
  assert.deepEqual(findAddTarget(model, 'lane:b:todo')?.creation, creation);
  assert.equal(findAddTarget(model, 'lane:b:done'), null);
  assert.equal(findAddTarget(null, 'lane:b:todo'), null);
});

// ---------- what the model offers ----------

const specOf = (partial: Partial<ViewSpec>): ViewSpec => ({
  specVersion: 1,
  title: 'T',
  root: 'main',
  components: {},
  queries: { all: { scope: 'all' } },
  ...partial,
});

const modelOf = (spec: ViewSpec, tasks = [task('a')]): NodeModel =>
  buildModel(spec, env(tasks))!;

test('a board offers Add on its open columns and not on the done one', () => {
  const board = modelOf(
    specOf({
      components: {
        main: {
          type: 'board',
          query: 'all',
          columns: [
            { id: 'doing', title: 'Doing', tags: ['@doing'], isDone: false },
            { id: 'done', title: 'Done', isDone: true },
          ],
        },
      },
    }),
  ) as Extract<NodeModel, { kind: 'board' }>;
  const [doing, done] = board.columns;
  assert.equal(doing.add?.key, 'lane:main:doing');
  assert.deepEqual(doing.add?.creation.tagIds, ['KANBAN_IN_PROGRESS']);
  assert.equal(done.add, undefined);
});

test('an agenda day gives its day to the task, and overdue gives none', () => {
  const agenda = modelOf(
    specOf({
      components: { main: { type: 'agenda', query: 'all', days: 2, showOverdue: true } },
    }),
    [task('late', { dueDay: '2026-10-20' })],
  ) as Extract<NodeModel, { kind: 'agenda' }>;
  const byLabel = Object.fromEntries(agenda.days.map((d) => [d.label, d]));
  assert.equal(byLabel.Overdue.add, undefined);
  assert.equal(byLabel.Today.add?.creation.dueDay, '2026-10-29');
  assert.equal(byLabel.Tomorrow.add?.creation.dueDay, '2026-10-30');
});

test('an agenda of overdue tasks cannot take a new task on any day', () => {
  const agenda = modelOf(
    specOf({
      queries: { all: { due: 'overdue' } },
      components: { main: { type: 'agenda', query: 'all', days: 2 } },
    }),
  ) as Extract<NodeModel, { kind: 'agenda' }>;
  assert.deepEqual(
    agenda.days.map((d) => d.add),
    [undefined, undefined],
  );
});

test('a list offers Add once, or once per group when grouped', () => {
  const list = (groupBy?: 'project', query: Query = { scope: 'all' }) =>
    modelOf(
      specOf({
        queries: { all: query },
        components: { main: { type: 'taskList', query: 'all', groupBy } },
      }),
      [task('a'), task('b', { projectId: null })],
    ) as Extract<NodeModel, { kind: 'taskList' }>;
  assert.equal(list().groups[0].add?.key, 'lane:main:all');
  const grouped = list('project').groups;
  assert.equal(
    grouped.find((g) => g.label === 'Work')?.add?.creation.projectId,
    'p-work',
  );
  assert.equal(grouped.find((g) => g.label === 'No project')?.add, undefined);
  assert.equal(list(undefined, { text: 'plan' }).groups[0].add, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, NodeModel } from './model';
import { AgendaNode, BreakdownNode } from './parts';
import { Component, Query, ViewSpec } from './spec';
import { at, env, task } from './test-fixtures';

const view = (component: Component, query: Query = {}): ViewSpec => ({
  specVersion: 1,
  title: 'T',
  root: 'main',
  components: { main: { ...component, query: 'q' } },
  queries: { q: query },
});

const agenda = (
  component: Partial<Component>,
  tasks: ReturnType<typeof task>[],
  query: Query = {},
): AgendaNode =>
  buildModel(view({ type: 'agenda', ...component }, query), env(tasks)) as Extract<
    NodeModel,
    { kind: 'agenda' }
  >;

const breakdown = (
  component: Partial<Component>,
  tasks: ReturnType<typeof task>[],
  archived: ReturnType<typeof task>[] = [],
): BreakdownNode =>
  buildModel(
    view({ type: 'timeBreakdown', ...component }),
    env(tasks, { archivedTasks: archived }),
  ) as Extract<NodeModel, { kind: 'timeBreakdown' }>;

const MIN = 60000;

test('an agenda lists the days from the logical today, tasks under their due day', () => {
  const node = agenda({ days: 3 }, [
    task('today', { dueDay: '2026-10-29', timeEstimate: 60 * MIN }),
    // 02:00 on the 30th is still the 29th with a day that starts at 04:00.
    task('night', { dueWithTime: at('2026-10-30', 2), timeEstimate: 30 * MIN }),
    task('tomorrow', { dueDay: '2026-10-30' }),
    task('later', { dueDay: '2026-11-05' }),
    task('undated'),
  ]);
  assert.deepEqual(
    node.days.map((d) => [d.label, d.cards.map((c) => c.id), d.planned]),
    [
      ['Today', ['today', 'night'], '1h 30m'],
      ['Tomorrow', ['tomorrow'], undefined],
      [node.days[2].label, [], undefined],
    ],
  );
  assert.equal(node.days[2].key, '2026-10-31');
  // The day is the heading, so cards do not repeat their due date.
  assert.equal(node.days[0].cards[0].due, undefined);
});

test('an agenda counts only what is left to do and clamps its length', () => {
  const node = agenda({ days: 99 }, [
    task('a', { dueDay: '2026-10-29', timeEstimate: 60 * MIN, timeSpent: 20 * MIN }),
    task('done', {
      dueDay: '2026-10-29',
      timeEstimate: 60 * MIN,
      isDone: true,
    }),
  ]);
  assert.equal(node.days[0].planned, '40m');
  assert.equal(node.days.length, 14);
  assert.equal(agenda({}, []).days.length, 3);
});

test('the overdue row is opt-in and leaves out done tasks', () => {
  const tasks = [
    task('late', { dueDay: '2026-10-27' }),
    task('late-done', { dueDay: '2026-10-27', isDone: true }),
  ];
  assert.equal(agenda({}, tasks).days.length, 3);
  const withRow = agenda({ showOverdue: true }, tasks);
  assert.deepEqual(
    withRow.days.map((d) => [d.key, d.isOverdue, d.cards.map((c) => c.id)]),
    [
      ['overdue', true, ['late']],
      ['2026-10-29', false, []],
      ['2026-10-30', false, []],
      ['2026-10-31', false, []],
    ],
  );
});

const spent = (days: Record<string, number>, extra = {}): ReturnType<typeof task> =>
  task(`t${Object.keys(days).join('')}`, {
    timeSpentOnDay: Object.fromEntries(
      Object.entries(days).map(([d, m]) => [d, m * MIN]),
    ),
    ...extra,
  });

test('a breakdown by project sums the range, archived tasks included', () => {
  const node = breakdown(
    { by: 'project', range: 'last7Days' },
    [
      spent({ '2026-10-29': 60, '2026-10-20': 500 }),
      spent({ '2026-10-23': 30 }, { projectId: 'p-home' }),
    ],
    [spent({ '2026-10-26': 30 }, { isDone: true })],
  );
  // Oct 20 is outside the last 7 days (Oct 23 to Oct 29).
  assert.equal(node.total, '2h');
  assert.deepEqual(
    node.rows.map((r) => [r.label, r.value, r.percent]),
    [
      ['Work', '1h 30m', 100],
      ['Home', '30m', 33],
    ],
  );
});

test('a breakdown by day shows every day of the week, gaps included', () => {
  const node = breakdown({ by: 'day', range: 'thisWeek' }, [
    spent({ '2026-10-26': 30, '2026-10-29': 90 }),
  ]);
  assert.equal(node.rows.length, 7);
  assert.deepEqual(
    node.rows.map((r) => r.percent),
    [33, 0, 0, 100, 0, 0, 0],
  );
  assert.equal(node.rows[1].value, '');
});

test('a breakdown by tag counts a task for each of its tags', () => {
  const node = breakdown({ by: 'tag', range: 'today' }, [
    spent({ '2026-10-29': 60 }, { tagIds: ['t-doing', 't-urgent'] }),
    spent({ '2026-10-29': 30, '2026-10-28': 99 }, { id: 'x', tagIds: [] }),
  ]);
  assert.equal(node.total, '1h 30m');
  assert.deepEqual(
    node.rows.map((r) => [r.label, r.value]),
    [
      ['Doing', '1h'],
      ['Urgent', '1h'],
      ['No tag', '30m'],
    ],
  );
});

test('a breakdown with no tracked time has no rows, and rows keep project colors', () => {
  const empty = breakdown({ by: 'day' }, [task('a')]);
  assert.deepEqual([empty.total, empty.rows.length], ['0m', 0]);
  const colored = buildModel(
    view({ type: 'timeBreakdown', by: 'project', range: 'today' }),
    {
      ...env([spent({ '2026-10-29': 10 })]),
      projects: [
        { ...env([]).projects[0], theme: { primary: '#2a7de1' } },
        env([]).projects[1],
      ],
    },
  ) as BreakdownNode;
  assert.equal(colored.rows[0].color, '#2a7de1');
});

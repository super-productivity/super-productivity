import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tag } from '@super-productivity/plugin-api';
import { buildModel, NodeModel } from './model';
import { applyRecipe, applyToolCall, RECIPE_NAMES, RECIPES } from './recipes';
import { emptySpec, findDanglingRefs, validateComponent, validateQuery } from './spec';
import { at, env, TAGS, task } from './test-fixtures';

// The built-in board tags are part of the data a recipe is drawn with.
const BUILT_IN = [
  { id: 'KANBAN_IN_PROGRESS', title: 'in-progress', taskIds: [] },
  { id: 'EM_URGENT', title: 'urgent', taskIds: [] },
  { id: 'EM_IMPORTANT', title: 'important', taskIds: [] },
  { id: 't-waiting', title: 'Waiting', taskIds: [] },
] as unknown as Tag[];

const tasks = [
  task('a', {
    dueDay: '2026-10-29',
    timeEstimate: 3_600_000,
    tagIds: ['KANBAN_IN_PROGRESS'],
  }),
  task('b', { dueDay: '2026-10-27', tagIds: ['t-waiting'], projectId: 'p-work' }),
  task('c', {
    isDone: true,
    doneOn: at('2026-10-28', 12),
    timeSpentOnDay: { '2026-10-28': 1_800_000 },
  }),
  task('d', { dueDay: '2026-10-31', deadlineDay: '2026-11-02' }),
];

const walk = (node: NodeModel, visit: (n: NodeModel) => void): void => {
  visit(node);
  if (node.kind === 'container') node.children.forEach((c) => walk(c, visit));
};

test('every recipe passes the validator and draws without problems', () => {
  for (const name of RECIPE_NAMES) {
    const { spec, error } = applyRecipe(emptySpec(), { name });
    assert.equal(error, undefined, name);
    assert.ok(spec.root, `${name} has a root`);
    assert.deepEqual(findDanglingRefs(spec), [], name);
    for (const c of Object.values(spec.components)) {
      assert.deepEqual(validateComponent(c), [], name);
    }
    for (const q of Object.values(spec.queries))
      assert.deepEqual(validateQuery(q), [], name);

    const model = buildModel(spec, env(tasks, { tags: [...BUILT_IN, ...TAGS] }));
    assert.ok(model, name);
    walk(model, (n) => {
      assert.notEqual(n.kind, 'placeholder', `${name}: ${n.cid}`);
      if ('problems' in n) assert.deepEqual(n.problems, [], `${name}: ${n.cid}`);
    });
  }
});

test('a recipe replaces the whole view and keeps what it does not own', () => {
  const before = {
    ...emptySpec('Old'),
    futureField: { kept: true },
    root: 'x',
    components: { x: { type: 'text', text: 'old' } },
    queries: { gone: {} },
  };
  const { spec } = applyRecipe(before, { name: 'overdue' });
  assert.equal(spec.title, 'Overdue');
  assert.deepEqual(Object.keys(spec.components), ['list']);
  assert.deepEqual(Object.keys(spec.queries), ['late']);
  assert.deepEqual(spec.futureField, { kept: true });
  assert.equal(before.components.x.text, 'old');
});

test('scope and tag params change what the recipe asks for', () => {
  const work = applyRecipe(emptySpec(), { name: 'kanban', params: { scope: 'Work' } });
  assert.equal(work.spec.queries.open.scope, 'Work');
  const defaults = applyRecipe(emptySpec(), { name: 'kanban' });
  assert.equal(defaults.spec.queries.open.scope, '@current');
  const later = applyRecipe(emptySpec(), { name: 'waiting', params: { tag: 'Later' } });
  assert.deepEqual(later.spec.queries.waiting.tags, ['Later']);
  assert.equal(later.spec.title, 'Later');
  const plain = applyRecipe(emptySpec(), { name: 'waiting', params: { tag: '  ' } });
  assert.deepEqual(plain.spec.queries.waiting.tags, ['Waiting']);
});

test('board recipes use the aliases and a today recipe uses the one due token', () => {
  const { spec } = applyRecipe(emptySpec(), { name: 'kanban' });
  const columns = spec.components.board.columns ?? [];
  assert.deepEqual(
    columns.map((c) => [c.tags, c.notTags]),
    [
      [undefined, ['@doing']],
      [['@doing'], undefined],
      [undefined, undefined],
    ],
  );
  const today = applyRecipe(emptySpec(), { name: 'focus' }).spec;
  assert.deepEqual(today.queries.focus, {
    scope: 'all',
    due: 'today',
    isDone: false,
    sort: 'priority',
    limit: 3,
  });
});

test('an unknown recipe is an error the model can read, and the view stays as it was', () => {
  const before = emptySpec();
  const result = applyRecipe(before, { name: 'nope' });
  assert.equal(result.spec, before);
  assert.match(result.error ?? '', /name must be one of kanban, eisenhower/);
  assert.match(applyRecipe(before, undefined).error ?? '', /name must be one of/);
});

test('use_recipe is a tool call like any other, and reports the ids it made', () => {
  const result = applyToolCall(emptySpec(), 'use_recipe', { name: 'kanban' });
  assert.match(result.summary ?? '', /board \(board\).*queries open/);
  assert.equal(applyToolCall(emptySpec(), 'say', { text: 'Hi' }).say, 'Hi');
  assert.ok(RECIPES.kanban.said.length > 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStep,
  emptySpec,
  finalizeSpec,
  findDanglingRefs,
  isReadOnlySpec,
  parseSpec,
  SPEC_VERSION,
  ViewSpec,
} from './spec';

const apply = (spec: ViewSpec, ...steps: [string, unknown][]): ViewSpec =>
  steps.reduce((s, [name, input]) => {
    const r = applyStep(s, name, input);
    assert.equal(r.error, undefined, r.error);
    return r.spec;
  }, spec);

test('the first component becomes the root', () => {
  const spec = apply(emptySpec(), [
    'put_component',
    { id: 'main', props: { type: 'stack', children: [] } },
  ]);
  assert.equal(spec.root, 'main');
});

test('put merges props, null removes a field, and unknown fields survive', () => {
  let spec = apply(
    emptySpec(),
    ['put_query', { id: 'q', props: { scope: '@current' } }],
    [
      'put_component',
      { id: 'list', props: { type: 'taskList', query: 'q', futureField: 7 } },
    ],
  );
  spec = apply(spec, [
    'put_component',
    { id: 'list', props: { groupBy: 'project', title: 'Mine' } },
  ]);
  assert.deepEqual(spec.components.list, {
    type: 'taskList',
    query: 'q',
    futureField: 7,
    groupBy: 'project',
    title: 'Mine',
  });
  spec = apply(spec, ['put_component', { id: 'list', props: { title: null } }]);
  assert.equal('title' in spec.components.list, false);
  assert.equal(spec.components.list.futureField, 7);
});

test('a step never changes the spec it was given', () => {
  const before = apply(emptySpec(), ['put_query', { id: 'q', props: {} }]);
  const frozen = JSON.stringify(before);
  applyStep(before, 'put_query', { id: 'q', props: { isDone: false } });
  applyStep(before, 'remove_query', { id: 'q' });
  assert.equal(JSON.stringify(before), frozen);
});

test('invalid steps are rejected with a reason and leave the spec unchanged', () => {
  const spec = emptySpec();
  const cases: [string, unknown, RegExp][] = [
    ['put_component', { id: 'x', props: {} }, /needs a type/],
    ['put_component', { id: '1bad', props: { type: 'text', text: '' } }, /id must start/],
    [
      'put_component',
      { id: 'b', props: { type: 'board', query: 'q', columns: [] } },
      /non-empty/,
    ],
    [
      'put_component',
      { id: 'm', props: { type: 'metric', query: 'q', measure: 'sum' } },
      /measure/,
    ],
    ['put_query', { id: 'q', props: { due: 'someday' } }, /due must be one of/],
    ['put_query', { id: 'q', props: { limit: 9999 } }, /limit/],
    ['set_view', { root: 'missing' }, /not a component/],
    ['remove_component', { id: 'nope' }, /no component/],
    ['shout', {}, /unknown step/],
  ];
  for (const [name, input, re] of cases) {
    const r = applyStep(spec, name, input);
    assert.match(r.error ?? '', re, name);
    assert.equal(r.spec, spec);
  }
});

test('a component cannot list itself as a child', () => {
  const r = applyStep(emptySpec(), 'put_component', {
    id: 'loop',
    props: { type: 'stack', children: ['loop'] },
  });
  assert.match(r.error ?? '', /contain itself/);
});

test('board columns need unique ids and titles', () => {
  const r = applyStep(emptySpec(), 'put_component', {
    id: 'b',
    props: {
      type: 'board',
      query: 'q',
      columns: [
        { id: 'a', title: 'A' },
        { id: 'a', title: 'B' },
      ],
    },
  });
  assert.match(r.error ?? '', /unique/);
});

test('removing a component takes it out of every children list', () => {
  let spec = apply(
    emptySpec(),
    ['put_component', { id: 'main', props: { type: 'stack', children: ['a', 'b'] } }],
    ['put_component', { id: 'a', props: { type: 'text', text: 'A' } }],
    ['put_component', { id: 'b', props: { type: 'text', text: 'B' } }],
  );
  spec = apply(spec, ['remove_component', { id: 'a' }]);
  assert.deepEqual(spec.components.main.children, ['b']);
  assert.equal(spec.components.a, undefined);
});

test('say returns the sentence without changing the spec', () => {
  const spec = emptySpec();
  const r = applyStep(spec, 'say', { text: '  Grouped by project.  ' });
  assert.equal(r.say, 'Grouped by project.');
  assert.equal(r.spec, spec);
});

test('dangling references are found, and finalize drops dangling children', () => {
  const spec = apply(emptySpec(), [
    'put_component',
    { id: 'main', props: { type: 'stack', children: ['later'] } },
  ]);
  assert.deepEqual(findDanglingRefs(spec), [
    'main lists child "later", which does not exist',
  ]);
  assert.deepEqual(finalizeSpec(spec).components.main.children, []);
});

test('parseSpec keeps unknown top-level fields; newer specs are read-only', () => {
  const parsed = parseSpec({ ...emptySpec(), extra: { a: 1 } });
  assert.deepEqual(parsed?.extra, { a: 1 });
  assert.equal(parseSpec({ components: {} }), null);
  assert.equal(isReadOnlySpec({ ...emptySpec(), specVersion: SPEC_VERSION + 1 }), true);
  assert.equal(isReadOnlySpec(emptySpec()), false);
});

test('agenda and timeBreakdown validate their own props', () => {
  const put = (props: Record<string, unknown>): string | undefined =>
    applyStep(emptySpec(), 'put_component', { id: 'part', props }).error;
  assert.equal(
    put({ type: 'agenda', query: 'q', days: 14, showOverdue: true }),
    undefined,
  );
  assert.match(put({ type: 'agenda', query: 'q', days: 15 }) ?? '', /days/);
  assert.match(
    put({ type: 'agenda', query: 'q', showOverdue: 'yes' }) ?? '',
    /showOverdue/,
  );
  assert.equal(
    put({ type: 'timeBreakdown', query: 'q', by: 'tag', range: 'last7Days' }),
    undefined,
  );
  assert.match(put({ type: 'timeBreakdown', query: 'q', by: 'week' }) ?? '', /by must/);
  assert.match(put({ type: 'timeBreakdown', query: 'q', range: 'month' }) ?? '', /range/);
  assert.match(put({ type: 'timeBreakdown', by: 'day' }) ?? '', /query/);
});

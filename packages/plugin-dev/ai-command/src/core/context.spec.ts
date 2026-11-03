import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MATCHES, MAX_RADAR, buildContext, requestWords } from './context';
import { TODAY, snapshot, task } from './test-fixtures';

test('requestWords drops stop words, short words and duplicates', () => {
  assert.deepEqual(requestWords('Move the dentist call to tomorrow, dentist!'), [
    'dentist',
    'call',
  ]);
});

test('sends aliases, never real ids or notes', () => {
  const s = snapshot([
    task('real-id-1', { title: 'Call dentist', dueDay: TODAY, notes: 'secret' }),
  ]);
  const ctx = buildContext(s, 'dentist');
  const json = JSON.stringify(ctx.sent);
  assert.equal(json.includes('real-id-1'), false);
  assert.equal(json.includes('secret'), false);
  assert.equal(ctx.sent.tasks[0].id, 't1');
  assert.equal(ctx.aliasToId.get('t1'), 'real-id-1');
});

test('virtual tags are neither sent as names nor on tasks', () => {
  const s = snapshot([task('a', { dueDay: TODAY, tagIds: ['TODAY', 'g1'] })]);
  const ctx = buildContext(s, '');
  assert.deepEqual(ctx.sent.tags, ['errands', 'calls']);
  assert.deepEqual(ctx.sent.tasks[0].tags, ['errands']);
});

test('radar keeps today first and caps the list', () => {
  const later = Array.from({ length: MAX_RADAR }, (_, i) =>
    task(`d${i}`, { deadlineDay: '2026-11-06' }),
  );
  const s = snapshot([...later, task('today', { dueDay: TODAY })]);
  const ctx = buildContext(s, '');
  assert.equal(ctx.sent.tasks.length, MAX_RADAR);
  assert.equal(ctx.aliasToId.get('t1'), 'today');
});

test('matches by title, project and tag; done matches stay out', () => {
  const s = snapshot([
    task('a', { title: 'Buy milk' }),
    task('b', { title: 'Fix header', projectId: 'p2' }),
    task('c', { title: 'Post office', tagIds: ['g1'] }),
    task('d', { title: 'Buy bread', isDone: true }),
    task('e', { title: 'Unrelated' }),
  ]);
  const ids = (req: string): string[] => [...buildContext(s, req).matchedIds].sort();
  assert.deepEqual(ids('buy'), ['a']);
  assert.deepEqual(ids('website stuff'), ['b']);
  assert.deepEqual(ids('my errands'), ['c']);
});

test('caps matches and brings parents of matched subtasks', () => {
  const many = Array.from({ length: MAX_MATCHES + 5 }, (_, i) =>
    task(`m${i}`, { title: `Invoice ${i}` }),
  );
  const parent = task('parent', { title: 'Quarterly', subTaskIds: ['sub'] });
  const sub = task('sub', { title: 'Receipts', parentId: 'parent' });
  assert.equal(buildContext(snapshot(many), 'invoice').sent.tasks.length, MAX_MATCHES);
  const ctx = buildContext(snapshot([parent, sub]), 'receipts');
  assert.deepEqual(ctx.sent.tasks.map((t) => t.title).sort(), ['Quarterly', 'Receipts']);
  assert.equal(
    ctx.sent.tasks.find((t) => t.title === 'Receipts')?.parent,
    ctx.idToAlias.get('parent'),
  );
});

test('selection is sent and marked', () => {
  const s = snapshot([task('a', { title: 'Old thing' })], { selectionIds: ['a'] });
  const ctx = buildContext(s, 'these to tomorrow');
  assert.equal(ctx.sent.tasks[0].selected, true);
});

test('facts: estimate, priority, repeats, fixedTime, free minutes', () => {
  const s = snapshot([
    task('a', {
      dueDay: TODAY,
      timeEstimate: 1_800_000,
      priority: 3,
      repeatCfgId: 'r',
      remindAt: 1,
    }),
  ]);
  const { sent } = buildContext(s, '');
  assert.deepEqual(sent.day, {
    today: TODAY,
    weekday: 'Tuesday',
    tomorrow: '2026-11-04',
    freeMinutesToday: 480,
  });
  const t = sent.tasks[0];
  assert.equal(t.estimateMin, 30);
  assert.equal(t.priority, 'high');
  assert.equal(t.repeats, true);
  assert.equal(t.fixedTime, true);
});

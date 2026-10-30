import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardsOf, toCard } from './cards';
import { env, task } from './test-fixtures';

const MIN = 60_000;
const FIELDS = ['project', 'tags', 'estimate', 'due'] as const;

describe('cardsOf', () => {
  const parent = task('p', { subTaskIds: ['s1', 's2'] });
  const s1 = task('s1', {
    parentId: 'p',
    timeEstimate: 30 * MIN,
    timeSpent: 10 * MIN,
  });
  const s2 = task('s2', {
    parentId: 'p',
    timeEstimate: 60 * MIN,
    timeSpent: 60 * MIN,
    isDone: true,
  });

  it('nests the sub-tasks under the parent in its order', () => {
    const [card] = cardsOf([parent], [...FIELDS], env([parent, s1, s2]));
    assert.deepEqual(
      card.subTasks.map((c) => [c.id, c.isSubTask]),
      [
        ['s1', true],
        ['s2', true],
      ],
    );
    assert.deepEqual(card.subCount, { done: 1, total: 2 });
  });

  it('does not nest a sub-task the part lists on its own', () => {
    const cards = cardsOf([parent, s1], [...FIELDS], env([parent, s1, s2]));
    assert.deepEqual(
      cards[0].subTasks.map((c) => c.id),
      ['s2'],
    );
    assert.deepEqual(cards[0].subCount, { done: 1, total: 2 });
    assert.deepEqual(cards[1].subTasks, []);
  });

  it('sums the parent time from its sub-tasks, as a task row does', () => {
    const [card] = cardsOf([parent], [...FIELDS], env([parent, s1, s2]));
    assert.deepEqual(card.time, { isParent: true, spent: '1h 10m', left: '20m' });
  });

  it('shows no project chip on a sub-task', () => {
    const [card] = cardsOf([parent], [...FIELDS], env([parent, s1, s2]));
    assert.equal(card.hasProjectChip, true);
    assert.equal(card.subTasks[0].hasProjectChip, false);
    assert.deepEqual(card.subTasks[0].chips, []);
  });
});

describe('toCard time and progress', () => {
  it('shows spent over estimate and the share used', () => {
    const t = task('a', { timeEstimate: 60 * MIN, timeSpent: 15 * MIN });
    const card = toCard(t, [...FIELDS], env([t]));
    assert.deepEqual(card.time, { isParent: false, spent: '15m', estimate: '1h' });
    assert.equal(card.progress, 25);
  });

  it('caps the progress at a full bar', () => {
    const t = task('a', { timeEstimate: 30 * MIN, timeSpent: 90 * MIN });
    assert.equal(toCard(t, [...FIELDS], env([t])).progress, 100);
  });

  it('has no progress without an estimate', () => {
    const t = task('a', { timeSpent: 15 * MIN });
    const card = toCard(t, [...FIELDS], env([t]));
    assert.equal(card.progress, undefined);
    assert.deepEqual(card.time, { isParent: false, spent: '15m' });
  });

  it('has no time block when the fields leave time out', () => {
    const t = task('a', { timeEstimate: 30 * MIN, timeSpent: 15 * MIN });
    assert.equal(toCard(t, ['tags'], env([t])).time, undefined);
  });

  it('turns the time block on for the timeSpent field alone', () => {
    const t = task('a', { timeEstimate: 30 * MIN, timeSpent: 15 * MIN });
    assert.deepEqual(toCard(t, ['timeSpent'], env([t])).time, {
      isParent: false,
      spent: '15m',
    });
  });

  it('has no time block when nothing was spent or estimated', () => {
    const t = task('a');
    assert.equal(toCard(t, [...FIELDS], env([t])).time, undefined);
  });
});

describe('toCard indicators', () => {
  it('reports notes, repeat and attachments', () => {
    const t = task('a', {
      notes: 'text',
      repeatCfgId: 'r1',
      attachments: [{}, {}],
    } as never);
    const card = toCard(t, [...FIELDS], env([t]));
    assert.equal(card.hasNotes, true);
    assert.equal(card.isRepeating, true);
    assert.equal(card.attachments, 2);
  });

  it('treats whitespace notes and a missing repeat as none', () => {
    const card = toCard(task('a', { notes: '  ' }), [...FIELDS], env([]));
    assert.equal(card.hasNotes, false);
    assert.equal(card.isRepeating, false);
    assert.equal(card.attachments, 0);
  });
});

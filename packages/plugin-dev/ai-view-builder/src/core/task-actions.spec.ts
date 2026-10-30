import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Project, Tag } from '@super-productivity/plugin-api';
import { PROJECTS, TAGS, task } from './test-fixtures';
import {
  estimateChange,
  isAvailable,
  menuEntries,
  MenuCtx,
  parseDuration,
  subTaskData,
  tagToggle,
  titleChange,
} from './task-actions';

const MIN = 60_000;

const ctx = (overrides: Partial<MenuCtx> = {}): MenuCtx => ({
  task: task('a'),
  isTracking: false,
  canTrack: true,
  tags: TAGS,
  projects: PROJECTS,
  ...overrides,
});

const ids = (view: 'main' | 'tags' | 'project', c: MenuCtx): string[] =>
  menuEntries(view, c).map((e) => e.id);

describe('parseDuration', () => {
  it('reads hours, minutes and both', () => {
    assert.equal(parseDuration('1h 30m'), 90 * MIN);
    assert.equal(parseDuration('1h30m'), 90 * MIN);
    assert.equal(parseDuration('45m'), 45 * MIN);
    assert.equal(parseDuration('45min'), 45 * MIN);
    assert.equal(parseDuration('1.5h'), 90 * MIN);
    assert.equal(parseDuration('2H'), 120 * MIN);
  });

  it('reads a bare number as minutes', () => {
    assert.equal(parseDuration('25'), 25 * MIN);
    assert.equal(parseDuration(' 0 '), 0);
  });

  it('reads an empty text as no estimate', () => {
    assert.equal(parseDuration(''), 0);
    assert.equal(parseDuration('   '), 0);
  });

  it('rejects text that is not a duration', () => {
    for (const text of ['abc', 'h', 'm', '1x', '1h 2', '-5m', '1h 30', '1,5h']) {
      assert.equal(parseDuration(text), null, text);
    }
  });

  it('rejects an estimate over a thousand hours', () => {
    assert.equal(parseDuration('1000h'), 1000 * 60 * MIN);
    assert.equal(parseDuration('1001h'), null);
  });
});

describe('titleChange', () => {
  it('trims the title', () => {
    assert.deepEqual(titleChange(task('a', { title: 'Old' }), '  New  '), {
      title: 'New',
    });
  });

  it('drops an empty or unchanged title', () => {
    const t = task('a', { title: 'Same' });
    assert.equal(titleChange(t, ''), null);
    assert.equal(titleChange(t, '   '), null);
    assert.equal(titleChange(t, ' Same '), null);
  });
});

describe('estimateChange', () => {
  it('writes only a changed estimate', () => {
    const t = task('a', { timeEstimate: 30 * MIN });
    assert.deepEqual(estimateChange(t, 60 * MIN), { timeEstimate: 60 * MIN });
    assert.deepEqual(estimateChange(t, 0), { timeEstimate: 0 });
    assert.equal(estimateChange(t, 30 * MIN), null);
  });
});

describe('tagToggle', () => {
  it('adds a missing tag and keeps the others', () => {
    assert.deepEqual(tagToggle(task('a', { tagIds: ['x'] }), 'y'), {
      tagIds: ['x', 'y'],
    });
  });

  it('removes a tag the task has', () => {
    assert.deepEqual(tagToggle(task('a', { tagIds: ['x', 'y'] }), 'x'), {
      tagIds: ['y'],
    });
  });
});

describe('subTaskData', () => {
  it('sends the title and parent only, so the host copies the parent project', () => {
    assert.deepEqual(subTaskData(task('p'), ' Read diff '), {
      title: 'Read diff',
      parentId: 'p',
    });
  });

  it('drops an empty title', () => {
    assert.equal(subTaskData(task('p'), '  '), null);
  });
});

describe('isAvailable', () => {
  it('tracks only open tasks and only where the host can', () => {
    assert.equal(isAvailable('toggleTrack', task('a'), true), true);
    assert.equal(isAvailable('toggleTrack', task('a'), false), false);
    assert.equal(isAvailable('toggleTrack', task('a', { isDone: true }), true), false);
  });

  it('takes no estimate on a parent', () => {
    assert.equal(isAvailable('editEstimate', task('a'), true), true);
    assert.equal(
      isAvailable('editEstimate', task('a', { subTaskIds: ['b'] }), true),
      false,
    );
  });

  it('gives sub-tasks no sub-tasks, tags or project move', () => {
    const sub = task('s', { parentId: 'p' });
    for (const action of ['addSubTask', 'tags', 'project'] as const) {
      assert.equal(isAvailable(action, sub, true), false, action);
      assert.equal(isAvailable(action, task('a'), true), true, action);
    }
  });

  it('always offers done, open, title and delete', () => {
    const sub = task('s', { parentId: 'p', isDone: true });
    for (const action of ['toggleDone', 'open', 'editTitle', 'delete'] as const) {
      assert.equal(isAvailable(action, sub, false), true, action);
    }
  });
});

describe('menuEntries', () => {
  it('lists the safe actions in order, delete last and dangerous', () => {
    const entries = menuEntries('main', ctx());
    assert.deepEqual(
      entries.map((e) => e.id),
      [
        'toggleDone',
        'toggleTrack',
        'editTitle',
        'editEstimate',
        'addSubTask',
        'tags',
        'project',
        'open',
        'delete',
      ],
    );
    assert.equal(entries.at(-1)?.danger, true);
    assert.equal(entries.filter((e) => e.danger).length, 1);
  });

  it('words done and tracking by the task state', () => {
    const labels = (c: MenuCtx): (string | undefined)[] =>
      menuEntries('main', c)
        .filter((e) => e.id === 'toggleDone' || e.id === 'toggleTrack')
        .map((e) => e.label);
    assert.deepEqual(labels(ctx()), ['Mark as done', 'Start tracking']);
    assert.deepEqual(labels(ctx({ isTracking: true })), [
      'Mark as done',
      'Stop tracking',
    ]);
    assert.deepEqual(labels(ctx({ task: task('a', { isDone: true }) })), [
      'Mark as not done',
    ]);
  });

  it('leaves out what does not apply', () => {
    assert.ok(!ids('main', ctx({ canTrack: false })).includes('toggleTrack'));
    assert.ok(
      !ids('main', ctx({ task: task('a', { subTaskIds: ['b'] }) })).includes(
        'editEstimate',
      ),
    );
    const sub = ids('main', ctx({ task: task('s', { parentId: 'p' }) }));
    assert.deepEqual(sub, [
      'toggleDone',
      'toggleTrack',
      'editTitle',
      'editEstimate',
      'open',
      'delete',
    ]);
  });

  it('marks the tags a task has and never offers the virtual TODAY tag', () => {
    const tags = [...TAGS, { id: 'TODAY', title: 'Today' } as unknown as Tag];
    const entries = menuEntries(
      'tags',
      ctx({ tags, task: task('a', { tagIds: ['t-doing'] }) }),
    );
    assert.deepEqual(
      entries.map((e) => [e.id, e.checked]),
      [
        ['tag:t-doing', true],
        ['tag:t-urgent', false],
        ['tag:t-important', false],
      ],
    );
  });

  it('marks the current project and skips archived ones', () => {
    const projects = [
      ...PROJECTS,
      { id: 'p-old', title: 'Old', isArchived: true } as unknown as Project,
    ];
    const entries = menuEntries('project', ctx({ projects }));
    assert.deepEqual(
      entries.map((e) => [e.id, e.checked]),
      [
        ['project:p-work', true],
        ['project:p-home', false],
      ],
    );
  });
});

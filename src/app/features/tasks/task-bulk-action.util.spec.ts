import { DEFAULT_TASK, Task } from './task.model';
import {
  dedupeByRepeatCfg,
  dedupeSubtasksOfSelectedParents,
  getCommonProjectId,
  orderForMarkDone,
  resolveDoneIntent,
  resolveTagIntent,
  splitParentOnly,
} from './task-bulk-action.util';

const t = (id: string, overrides: Partial<Task> = {}): Task =>
  ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'p1',
    ...overrides,
  }) as Task;

describe('task-bulk-action.util', () => {
  describe('dedupeSubtasksOfSelectedParents', () => {
    it('drops subtasks whose parent is selected and keeps lone subtasks', () => {
      const parent = t('p', { subTaskIds: ['s1', 's2'] });
      const s1 = t('s1', { parentId: 'p' });
      const lone = t('x', { parentId: 'other' });
      expect(dedupeSubtasksOfSelectedParents([s1, parent, lone])).toEqual([parent, lone]);
    });
  });

  describe('splitParentOnly', () => {
    it('separates subtasks from top-level tasks', () => {
      const { eligible, skippedSubtasks } = splitParentOnly([
        t('a'),
        t('s', { parentId: 'a' }),
      ]);
      expect(eligible.map((x) => x.id)).toEqual(['a']);
      expect(skippedSubtasks.map((x) => x.id)).toEqual(['s']);
    });
  });

  describe('orderForMarkDone', () => {
    it('puts subtasks first and the tracked task last', () => {
      const ordered = orderForMarkDone(
        [t('current'), t('p'), t('s', { parentId: 'p' })],
        'current',
      );
      expect(ordered.map((x) => x.id)).toEqual(['s', 'p', 'current']);
    });

    it('keeps relative order otherwise', () => {
      const ordered = orderForMarkDone([t('a'), t('b'), t('c')], null);
      expect(ordered.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('resolveDoneIntent', () => {
    it('is done when any task is undone, else undone', () => {
      expect(resolveDoneIntent([t('a', { isDone: true }), t('b')])).toBe('done');
      expect(resolveDoneIntent([t('a', { isDone: true })])).toBe('undone');
    });
  });

  describe('resolveTagIntent', () => {
    it('removes only when every task has the tag', () => {
      expect(resolveTagIntent([t('a', { tagIds: ['x'] }), t('b')], 'x')).toBe('add');
      expect(
        resolveTagIntent(
          [t('a', { tagIds: ['x'] }), t('b', { tagIds: ['x', 'y'] })],
          'x',
        ),
      ).toBe('remove');
      expect(resolveTagIntent([], 'x')).toBe('add');
    });
  });

  describe('dedupeByRepeatCfg', () => {
    it('keeps one instance per repeat config and all plain tasks', () => {
      const result = dedupeByRepeatCfg([
        t('r1', { repeatCfgId: 'cfg' }),
        t('plain'),
        t('r2', { repeatCfgId: 'cfg' }),
        t('r3', { repeatCfgId: 'other' }),
      ]);
      expect(result.map((x) => x.id)).toEqual(['r1', 'plain', 'r3']);
    });
  });

  describe('getCommonProjectId', () => {
    it('returns the project only when all tasks share it', () => {
      expect(
        getCommonProjectId([t('a', { projectId: 'p' }), t('b', { projectId: 'p' })]),
      ).toBe('p');
      expect(
        getCommonProjectId([t('a', { projectId: 'p' }), t('b', { projectId: 'q' })]),
      ).toBeNull();
      expect(getCommonProjectId([])).toBeNull();
    });
  });
});

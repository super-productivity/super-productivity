import {
  reCalcTimesForParentIfParent,
  updateTimeSpentForTask,
} from './task.reducer.util';
import { DEFAULT_TASK, Task, TaskState } from '../task.model';
import { taskAdapter } from './task.adapter';

const DAY = '2025-01-01';

const mkTask = (
  id: string,
  parentId: string | undefined,
  subTaskIds: string[],
  over: Partial<Task> = {},
): Task => ({
  ...DEFAULT_TASK,
  id,
  parentId,
  subTaskIds,
  projectId: 'p1',
  ...over,
});

const buildState = (tasks: Task[]): TaskState =>
  taskAdapter.setAll(tasks, {
    ids: [],
    entities: {},
    currentTaskId: null,
    selectedTaskId: null,
    lastCurrentTaskId: null,
    isDataLoaded: true,
    taskDetailTargetPanel: null,
  });

describe('task.reducer.util time roll-up (#2657 nested sub-tasks)', () => {
  describe('reCalcTimesForParentIfParent climbs the whole ancestor chain', () => {
    it('rolls a grandchild`s time/estimate up to the root', () => {
      // root → mid → leaf
      const state = buildState([
        mkTask('root', undefined, ['mid']),
        mkTask('mid', 'root', ['leaf']),
        mkTask('leaf', 'mid', [], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
          timeEstimate: 5000,
        }),
      ]);

      const result = reCalcTimesForParentIfParent('mid', state);

      expect(result.entities['mid']!.timeSpent).toBe(1000);
      expect(result.entities['mid']!.timeSpentOnDay).toEqual({ [DAY]: 1000 });
      // mid is a leaf-parent → remaining = 5000 - 1000
      expect(result.entities['mid']!.timeEstimate).toBe(4000);

      // root rolls up from mid
      expect(result.entities['root']!.timeSpent).toBe(1000);
      expect(result.entities['root']!.timeSpentOnDay).toEqual({ [DAY]: 1000 });
    });

    it('does NOT double-subtract spent for intermediate nodes (estimate roll-up)', () => {
      const state = buildState([
        mkTask('root', undefined, ['mid']),
        mkTask('mid', 'root', ['leaf']),
        mkTask('leaf', 'mid', [], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
          timeEstimate: 5000,
        }),
      ]);

      const result = reCalcTimesForParentIfParent('mid', state);

      // root's estimate must equal mid's rolled-up estimate (4000), NOT
      // max(0, mid.est - mid.spent) = 3000 (which would double-count spent).
      expect(result.entities['root']!.timeEstimate).toBe(4000);
    });

    it('sums multiple deep leaves correctly', () => {
      // root → mid → [a, b]
      const state = buildState([
        mkTask('root', undefined, ['mid']),
        mkTask('mid', 'root', ['a', 'b']),
        mkTask('a', 'mid', [], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
          timeEstimate: 2000,
        }),
        mkTask('b', 'mid', [], {
          timeSpentOnDay: { [DAY]: 500 },
          timeSpent: 500,
          timeEstimate: 3000,
        }),
      ]);

      const result = reCalcTimesForParentIfParent('mid', state);

      // spent: 1000 + 500
      expect(result.entities['root']!.timeSpent).toBe(1500);
      // remaining: max(0,2000-1000) + max(0,3000-500) = 1000 + 2500
      expect(result.entities['root']!.timeEstimate).toBe(3500);
    });
  });

  describe('updateTimeSpentForTask climbs ancestors incrementally', () => {
    it('propagates a leaf time change to every ancestor', () => {
      // Consistent starting state: root and mid already reflect leaf's 1000.
      const state = buildState([
        mkTask('root', undefined, ['mid'], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
        }),
        mkTask('mid', 'root', ['leaf'], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
        }),
        mkTask('leaf', 'mid', [], {
          timeSpentOnDay: { [DAY]: 1000 },
          timeSpent: 1000,
        }),
      ]);

      const result = updateTimeSpentForTask('leaf', { [DAY]: 2500 }, state);

      expect(result.entities['leaf']!.timeSpent).toBe(2500);
      // +1500 delta climbs to mid and root
      expect(result.entities['mid']!.timeSpent).toBe(2500);
      expect(result.entities['root']!.timeSpent).toBe(2500);
    });
  });
});

import { TODAY_TAG } from '../../tag/tag.const';
import { fakeEntityStateFromArray } from '../../../util/fake-entity-state-from-array';
import {
  selectActiveWorkContext,
  selectStartableTasksForActiveContext,
  selectTimelineTasks,
  selectTodayTaskIds,
  selectTodayTagRepair,
  selectTrackableTasksForActiveContext,
  selectUndoneTodayTaskIds,
} from './work-context.selectors';
import { WorkContext, WorkContextType } from '../work-context.model';
import { TaskCopy } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Tests for work-context selectors.
 *
 * IMPORTANT: TODAY_TAG is a "virtual tag" - membership is determined by task.dueDay,
 * NOT by task.tagIds. TODAY_TAG.taskIds only stores ordering.
 * See: docs/ai/today-tag-architecture.md
 */
describe('workContext selectors', () => {
  // Get today's date string for tests
  const todayStr = getDbDateStr();

  describe('selectActiveWorkContext', () => {
    it('should select today tag', () => {
      const result = selectActiveWorkContext.projector(
        {
          activeId: TODAY_TAG.id,
          activeType: WorkContextType.TAG,
        } as any,
        // } as Partial<WorkContextCopy> as WorkContextCopy,
        fakeEntityStateFromArray([]),
        fakeEntityStateFromArray([TODAY_TAG]),
        fakeEntityStateFromArray([]) as any, // taskState - no tasks
        [],
      );
      expect(result).toEqual(
        jasmine.objectContaining({
          advancedCfg: {
            worklogExportSettings: {
              cols: ['DATE', 'START', 'END', 'TIME_CLOCK', 'TITLES_INCLUDING_SUB'],
              groupBy: 'DATE',
              roundEndTimeTo: null,
              roundStartTimeTo: null,
              roundWorkTimeTo: null,
              separateTasksBy: ' | ',
            },
          },
          // breakNr: {},
          // breakTime: {},
          color: null,
          // created: 1620997370531,
          icon: 'wb_sunny',
          id: 'TODAY',
          // modified: 1620997370531,
          routerLink: 'tag/TODAY',
          taskIds: [],
          theme: TODAY_TAG.theme,
          title: 'Today',
          type: 'TAG',
          // workEnd: {},
          // workStart: {},
        }),
      );
    });

    it('should use dueDay for TODAY_TAG membership (virtual tag pattern)', () => {
      // TODAY_TAG uses dueDay for membership, not tagIds
      const task1 = {
        id: 'task1',
        tagIds: [], // TODAY_TAG should NOT be in tagIds
        dueDay: todayStr, // This determines TODAY membership
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [], // TODAY_TAG should NOT be in tagIds
        dueDay: todayStr, // This determines TODAY membership
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const taskNotForToday = {
        id: 'task3',
        tagIds: [],
        dueDay: '2000-01-01', // Not today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // Tag has stale taskIds including task3 which doesn't have dueDay === today
      const todayTagWithStaleIds = {
        ...TODAY_TAG,
        taskIds: ['task3', 'task1'], // task3 is stale (wrong dueDay), task2 is missing
      };

      const result = selectActiveWorkContext.projector(
        {
          activeId: TODAY_TAG.id,
          activeType: WorkContextType.TAG,
        } as any,
        fakeEntityStateFromArray([]),
        fakeEntityStateFromArray([todayTagWithStaleIds]),
        fakeEntityStateFromArray([task1, task2, taskNotForToday]) as any,
        [],
      );

      // Should filter out task3 (stale) and auto-add task2 (missing from order)
      expect(result.taskIds).toEqual(['task1', 'task2']);
    });
  });
  describe('selectTrackableTasksForActiveContext', () => {
    it('should select tasks for project', () => {
      const M1 = {
        id: 'M1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const M2 = {
        id: 'M2',
        subTaskIds: [],
        tagIds: [],
        dueDay: todayStr,
        dueWithTime: 1234,
        reminderId: 'asd',
      } as Partial<TaskCopy> as TaskCopy;
      const ctx: Partial<WorkContext> = {
        id: TODAY_TAG.id,
        taskIds: [M1.id, M2.id],
      };
      const result = selectTrackableTasksForActiveContext.projector(
        ctx as WorkContext,
        fakeEntityStateFromArray([M2, M1]).entities,
      );
      expect(result).toEqual([
        { id: 'M1', subTaskIds: [], tagIds: [], dueDay: todayStr },
        {
          id: 'M2',
          dueWithTime: 1234,
          reminderId: 'asd',
          subTaskIds: [],
          tagIds: [],
          dueDay: todayStr,
        },
      ] as any[]);
    });
  });

  describe('selectStartableTasksForActiveContext', () => {
    it('should select tasks for project', () => {
      const M1 = {
        id: 'M1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;
      const M2 = {
        id: 'M2',
        subTaskIds: [],
        tagIds: [],
        dueDay: todayStr,
        dueWithTime: 1234,
      } as Partial<TaskCopy> as TaskCopy;

      const result = selectStartableTasksForActiveContext.projector([M1, M2]);
      expect(result).toEqual([
        {
          id: 'M2',
          dueWithTime: 1234,
          subTaskIds: [],
          tagIds: [],
          dueDay: todayStr,
        },
      ] as Partial<TaskCopy>[] as TaskCopy[]);
    });
  });

  describe('selectTimelineTasks', () => {
    it('should not show done tasks', () => {
      const P = {
        id: 'P',
        subTaskIds: ['SUB1', 'SUB_S'],
        tagIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const SUB1 = {
        id: 'SUB1',
        subTaskIds: [],
        tagIds: [],
        parentId: P.id,
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;
      const SUB_S = {
        id: 'SUB_S',
        dueWithTime: 1234,
        reminderId: 'HA',
        parentId: P.id,
        subTaskIds: [],
        tagIds: [],
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = fakeEntityStateFromArray([P, SUB1, SUB_S]) as any;
      const result = selectTimelineTasks.projector([SUB1.id, SUB_S.id], taskState);
      expect(result).toEqual({
        unPlanned: [],
        planned: [],
      } as any);
    });
  });

  describe('selectTodayTaskIds (virtual tag pattern - uses dueDay)', () => {
    it('should return empty array when no tasks have dueDay === today', () => {
      const tagState = fakeEntityStateFromArray([TODAY_TAG]);
      const taskState = fakeEntityStateFromArray([]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual([]);
    });

    it('should return tasks in stored order when all tasks have dueDay === today', () => {
      // TODAY_TAG membership is determined by dueDay, not tagIds
      const task1 = {
        id: 'task1',
        tagIds: [], // TODAY_TAG should NOT be in tagIds
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [], // TODAY_TAG should NOT be in tagIds
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithTasks = {
        ...TODAY_TAG,
        taskIds: ['task1', 'task2'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithTasks]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1', 'task2']);
    });

    it('should filter out stale taskIds (tasks that no longer have dueDay === today)', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: '2000-01-01', // No longer today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithStaleIds = {
        ...TODAY_TAG,
        taskIds: ['task1', 'task2'], // task2 is stale
      };

      const tagState = fakeEntityStateFromArray([todayTagWithStaleIds]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1']);
    });

    it('should auto-add tasks with dueDay === today but not in stored order', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagMissingTask2 = {
        ...TODAY_TAG,
        taskIds: ['task1'], // task2 missing from order
      };

      const tagState = fakeEntityStateFromArray([todayTagMissingTask2]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1', 'task2']);
    });

    it('should exclude subtasks', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithTasks = {
        ...TODAY_TAG,
        taskIds: ['parent', 'subtask1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithTasks]);
      const taskState = fakeEntityStateFromArray([parentTask, subtask]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['parent']); // subtask excluded
    });

    it('should filter out deleted tasks (taskIds referencing non-existent tasks)', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // task2 exists in TODAY_TAG.taskIds but not in taskState (deleted)
      const todayTagWithDeletedTask = {
        ...TODAY_TAG,
        taskIds: ['task1', 'deleted-task', 'also-deleted'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithDeletedTask]);
      const taskState = fakeEntityStateFromArray([task1]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1']); // deleted tasks filtered out
    });

    it('should filter out archived tasks with dueDay === today', () => {
      const activeTask = {
        id: 'active-task',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        // No 'archived' property - this is the active task
      } as Partial<TaskCopy> as TaskCopy;

      // In the app, archived tasks are stored in TimeTrackingState, not TaskState.
      // An archived task would not exist in the regular task entities.
      // This test verifies that if somehow an archived task ID is in TODAY_TAG.taskIds,
      // it gets filtered out because it doesn't exist in the active task state.
      const todayTagWithArchivedRef = {
        ...TODAY_TAG,
        taskIds: ['active-task', 'archived-task-id'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithArchivedRef]);
      // Only active task in state - archived-task-id doesn't exist
      const taskState = fakeEntityStateFromArray([activeTask]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['active-task']); // archived task ID filtered out
    });

    // Tests for dueWithTime fallback (issue #5841)
    it('should include task with dueWithTime for today but no dueDay (fallback)', () => {
      // Create a timestamp for today (e.g., 8:00 AM today)
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const taskWithDueWithTimeOnly = {
        id: 'task1',
        tagIds: [],
        dueDay: undefined, // No dueDay set
        dueWithTime: todayTimestamp, // But has dueWithTime for today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithDueWithTimeOnly]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1']); // Should be included via dueWithTime fallback
    });

    it('should include task with dueWithTime for today but stale dueDay (fallback)', () => {
      // Create a timestamp for today (e.g., 8:00 AM today)
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const taskWithStaleDueDay = {
        id: 'task1',
        tagIds: [],
        dueDay: '2000-01-01', // Stale dueDay (not today)
        dueWithTime: todayTimestamp, // But has dueWithTime for today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithStaleDueDay]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1']); // Should be included via dueWithTime fallback
    });

    it('should NOT include task with dueWithTime for tomorrow (no fallback)', () => {
      // Create a timestamp for tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      const tomorrowTimestamp = tomorrow.getTime();

      const taskWithDueWithTimeTomorrow = {
        id: 'task1',
        tagIds: [],
        dueDay: undefined,
        dueWithTime: tomorrowTimestamp, // dueWithTime is for tomorrow
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithDueWithTimeTomorrow]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual([]); // Should NOT be included
    });

    it('should prefer dueDay over dueWithTime when both are set for today', () => {
      // Create a timestamp for today
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const taskWithBoth = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr, // dueDay is today
        dueWithTime: todayTimestamp, // dueWithTime is also today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithBoth]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1']); // Should be included (no duplicates)
    });

    it('should handle mix of dueDay and dueWithTime fallback tasks', () => {
      // Create a timestamp for today (e.g., 8:00 AM today)
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const taskWithDueDay = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const taskWithDueWithTimeOnly = {
        id: 'task2',
        tagIds: [],
        dueDay: undefined,
        dueWithTime: todayTimestamp,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithTask1 = {
        ...TODAY_TAG,
        taskIds: ['task1'], // Only task1 is in stored order
      };

      const tagState = fakeEntityStateFromArray([todayTagWithTask1]);
      const taskState = fakeEntityStateFromArray([
        taskWithDueDay,
        taskWithDueWithTimeOnly,
      ]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState);
      expect(result).toEqual(['task1', 'task2']); // Both included, task2 appended
    });
  });

  describe('selectUndoneTodayTaskIds', () => {
    it('should filter out done tasks', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: false,
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;
      const task3 = {
        id: 'task3',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: false,
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = fakeEntityStateFromArray([task1, task2, task3]) as any;

      // selectUndoneTodayTaskIds takes todayTaskIds and taskState
      const result = selectUndoneTodayTaskIds.projector(
        ['task1', 'task2', 'task3'],
        taskState,
      );
      expect(result).toEqual(['task1', 'task3']);
    });

    it('should return empty array when all tasks are done', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: true,
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectUndoneTodayTaskIds.projector(['task1', 'task2'], taskState);
      expect(result).toEqual([]);
    });

    it('should handle tasks that do not exist in taskState', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        isDone: false,
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = fakeEntityStateFromArray([task1]) as any;

      // task2 doesn't exist in taskState (may have been deleted)
      const result = selectUndoneTodayTaskIds.projector(['task1', 'task2'], taskState);
      // task2 is filtered out because taskState.entities[task2]?.isDone is undefined (falsy but not false)
      expect(result).toEqual(['task1']);
    });
  });

  describe('selectTodayTagRepair (post-sync consistency check)', () => {
    it('should return null when TODAY_TAG.taskIds is consistent with tasks dueDay', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagConsistent = {
        ...TODAY_TAG,
        taskIds: ['task1', 'task2'],
      };

      const tagState = fakeEntityStateFromArray([todayTagConsistent]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toBeNull();
    });

    it('should return null when TODAY_TAG does not exist', () => {
      // Create a tag state without TODAY_TAG by using a different tag
      const otherTag = { ...TODAY_TAG, id: 'OTHER_TAG', taskIds: [] };
      const tagState = fakeEntityStateFromArray([otherTag]);
      // Remove the TODAY tag from entities to simulate it not existing
      const tagStateWithoutToday = {
        ...tagState,
        entities: { OTHER_TAG: otherTag },
      };
      const taskState = fakeEntityStateFromArray([]) as any;

      const result = selectTodayTagRepair.projector(
        tagStateWithoutToday as any,
        taskState,
      );
      expect(result).toBeNull();
    });

    it('should detect stale taskIds (tasks that no longer have dueDay === today)', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: '2000-01-01', // NOT today - should be removed
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithStaleIds = {
        ...TODAY_TAG,
        taskIds: ['task1', 'task2'], // task2 is stale
      };

      const tagState = fakeEntityStateFromArray([todayTagWithStaleIds]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task1'], // task2 removed
      });
    });

    it('should detect missing taskIds (tasks with dueDay === today not in taskIds)', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr, // Should be in today
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagMissingTask2 = {
        ...TODAY_TAG,
        taskIds: ['task1'], // task2 is missing
      };

      const tagState = fakeEntityStateFromArray([todayTagMissingTask2]);
      const taskState = fakeEntityStateFromArray([task1, task2]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task1', 'task2'], // task2 added
      });
    });

    it('should handle both stale and missing taskIds', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: '2000-01-01', // NOT today - stale
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task3 = {
        id: 'task3',
        tagIds: [],
        dueDay: todayStr, // Should be in today - missing
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithIssues = {
        ...TODAY_TAG,
        taskIds: ['task2', 'task1'], // task2 is stale, task3 is missing
      };

      const tagState = fakeEntityStateFromArray([todayTagWithIssues]);
      const taskState = fakeEntityStateFromArray([task1, task2, task3]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task1', 'task3'], // task2 removed, task3 added, order preserved for task1
      });
    });

    it('should preserve original order for valid tasks', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task2 = {
        id: 'task2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;
      const task3 = {
        id: 'task3',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // Original order: task3, task1 (task2 missing)
      const todayTagMissingOne = {
        ...TODAY_TAG,
        taskIds: ['task3', 'task1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagMissingOne]);
      const taskState = fakeEntityStateFromArray([task1, task2, task3]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task3', 'task1', 'task2'], // Preserve task3, task1 order; append task2
      });
    });

    it('should exclude subtasks from repair', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      // taskIds incorrectly includes subtask
      const todayTagWithSubtask = {
        ...TODAY_TAG,
        taskIds: ['parent', 'subtask1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithSubtask]);
      const taskState = fakeEntityStateFromArray([parentTask, subtask]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['parent'], // subtask removed
      });
    });

    it('should return null when empty and consistent', () => {
      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState);
      expect(result).toBeNull();
    });
  });
});

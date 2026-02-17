import { TODAY_TAG } from '../../tag/tag.const';
import { fakeEntityStateFromArray } from '../../../util/fake-entity-state-from-array';
import {
  selectActiveWorkContext,
  selectStartableTasksForActiveContext,
  selectTimelineTasks,
  selectTodayTaskIds,
  selectTodayTagRepair,
  selectTrackableTasksActiveContextFirst,
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
        todayStr,
        0,
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
        todayStr,
        0,
      );

      // Should filter out task3 (stale) and auto-add task2 (missing from order)
      expect(result.taskIds).toEqual(['task1', 'task2']);
    });

    describe('with startOfNextDayDiff offset', () => {
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const offsetTodayStr = '2026-02-15';

      it('should include task with dueWithTime at 2 AM next day when offset extends today', () => {
        // 2 AM on Feb 16 local time; with 4h offset: 2 AM - 4h = 10 PM Feb 15 = today
        const feb16_2am = new Date(2026, 1, 16, 2, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_2am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagWithOrder = { ...TODAY_TAG, taskIds: ['task1'] };

        const result = selectActiveWorkContext.projector(
          {
            activeId: TODAY_TAG.id,
            activeType: WorkContextType.TAG,
          } as any,
          fakeEntityStateFromArray([]),
          fakeEntityStateFromArray([todayTagWithOrder]),
          fakeEntityStateFromArray([task]) as any,
          [],
          offsetTodayStr,
          FOUR_HOURS_MS,
        );

        expect(result.taskIds).toEqual(['task1']);
      });

      it('should order tasks correctly when offset causes mixed dueDay and dueWithTime membership', () => {
        // Task with dueDay = today (Feb 15)
        const taskDueDay = {
          id: 'task-dueday',
          tagIds: [],
          dueDay: offsetTodayStr,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Task with dueWithTime at 1 AM Feb 16 (offset makes it "today")
        const feb16_1am = new Date(2026, 1, 16, 1, 0, 0, 0).getTime();
        const taskDueWithTime = {
          id: 'task-duewithtime',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_1am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Task with dueWithTime at 5 AM Feb 16 (offset does NOT make it "today")
        const feb16_5am = new Date(2026, 1, 16, 5, 0, 0, 0).getTime();
        const taskNotToday = {
          id: 'task-not-today',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_5am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagWithOrder = {
          ...TODAY_TAG,
          taskIds: ['task-duewithtime', 'task-dueday'],
        };

        const result = selectActiveWorkContext.projector(
          {
            activeId: TODAY_TAG.id,
            activeType: WorkContextType.TAG,
          } as any,
          fakeEntityStateFromArray([]),
          fakeEntityStateFromArray([todayTagWithOrder]),
          fakeEntityStateFromArray([taskDueDay, taskDueWithTime, taskNotToday]) as any,
          [],
          offsetTodayStr,
          FOUR_HOURS_MS,
        );

        // task-not-today excluded (5 AM - 4h = 1 AM Feb 16 != Feb 15)
        expect(result.taskIds).toEqual(['task-duewithtime', 'task-dueday']);
      });
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

  describe('selectTrackableTasksActiveContextFirst', () => {
    it('should not crash when a task entity has undefined subTaskIds (issue #6562)', () => {
      const taskWithUndefinedSubTaskIds = {
        id: 'broken-task',
        tagIds: [],
        subTaskIds: undefined, // Corrupted/legacy entity
      } as Partial<TaskCopy> as TaskCopy;

      const normalTask = {
        id: 'normal-task',
        tagIds: [],
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = fakeEntityStateFromArray([
        taskWithUndefinedSubTaskIds,
        normalTask,
      ]) as any;

      // Should not throw "Cannot read properties of undefined (reading 'length')"
      const result = selectTrackableTasksActiveContextFirst.projector(taskState, []);
      expect(result.length).toBe(2);
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

    it('should handle missing task entities gracefully (issue #6014)', () => {
      // Simulate state where todayIds contains IDs that don't exist in entities
      // This can happen during sync or when tasks are deleted
      const existingTask = {
        id: 'existing',
        subTaskIds: [],
        tagIds: [],
        isDone: false,
      } as Partial<TaskCopy> as TaskCopy;

      // Create task state with only one task but multiple IDs
      const taskState = {
        ids: ['existing', 'missing1', 'missing2'],
        entities: {
          existing: existingTask,
          // missing1 and missing2 are not in entities
        },
      } as any;

      // This should not throw "Cannot read properties of undefined"
      const result = selectTimelineTasks.projector(['existing', 'missing1'], taskState);

      // Should only include the existing task, not crash on missing ones
      expect(result.unPlanned.length).toBe(1);
      expect(result.unPlanned[0].id).toBe('existing');
      expect(result.planned.length).toBe(0);
    });

    it('should handle task with dueWithTime when some entities are missing (issue #6014)', () => {
      const taskWithDueTime = {
        id: 'withDueTime',
        subTaskIds: [],
        tagIds: [],
        isDone: false,
        dueWithTime: Date.now(),
      } as Partial<TaskCopy> as TaskCopy;

      const taskState = {
        ids: ['withDueTime', 'missingTask'],
        entities: {
          withDueTime: taskWithDueTime,
          // missingTask is not in entities
        },
      } as any;

      // This should not throw "Cannot read properties of undefined (reading 'dueWithTime')"
      const result = selectTimelineTasks.projector(['missingTask'], taskState);

      expect(result.planned.length).toBe(1);
      expect(result.planned[0].id).toBe('withDueTime');
    });
  });

  describe('selectTodayTaskIds (virtual tag pattern - uses dueDay)', () => {
    it('should return empty array when no tasks have dueDay === today', () => {
      const tagState = fakeEntityStateFromArray([TODAY_TAG]);
      const taskState = fakeEntityStateFromArray([]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['task1', 'task2']);
    });

    it('should exclude subtasks when parent is also in TODAY', () => {
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['parent']); // subtask excluded - shown nested under parent
    });

    it('should include subtasks as top-level when parent is NOT in TODAY', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: null, // Parent not in TODAY
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr, // Subtask in TODAY
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithTasks = {
        ...TODAY_TAG,
        taskIds: ['subtask1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithTasks]);
      const taskState = fakeEntityStateFromArray([parentTask, subtask]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['subtask1']); // subtask included as top-level item
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['task1']); // Should be included via dueWithTime fallback
    });

    it('should INCLUDE task with dueWithTime for today even when dueDay is set to different date (dueWithTime takes priority)', () => {
      // Create a timestamp for today (e.g., 8:00 AM today)
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      // This is a legacy data scenario - with mutual exclusivity, this shouldn't happen in new data
      const taskWithBothFields = {
        id: 'task1',
        tagIds: [],
        dueDay: '2000-01-01', // Legacy dueDay set to different date
        dueWithTime: todayTimestamp, // dueWithTime for today takes priority
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithBothFields]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['task1']); // dueWithTime takes priority - task IS in today
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual([]); // Should NOT be included
    });

    it('should use dueWithTime when both are set for today (dueWithTime takes priority)', () => {
      // Create a timestamp for today
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      // This is a legacy data scenario - with mutual exclusivity, both wouldn't be set
      const taskWithBoth = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr, // dueDay is today (legacy)
        dueWithTime: todayTimestamp, // dueWithTime is also today - takes priority
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithBoth]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['task1']); // Should be included via dueWithTime (no duplicates)
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

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual(['task1', 'task2']); // Both included, task2 appended
    });

    // Test for dueWithTime priority pattern
    it('task with dueWithTime for today should be in today list even with stale dueDay', () => {
      // With mutual exclusivity pattern, dueWithTime takes priority over dueDay
      // This handles legacy data where both might be set inconsistently
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      const taskWithConflictingState = {
        id: 'task1',
        tagIds: [],
        dueDay: tomorrowStr, // Legacy dueDay set to tomorrow
        dueWithTime: todayTimestamp, // But dueWithTime is for today - takes priority
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskWithConflictingState]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      // dueWithTime takes priority - task IS in today (despite stale dueDay)
      expect(result).toEqual(['task1']);
    });

    it('task scheduled for tomorrow via dialog should NOT appear in today (mutual exclusivity)', () => {
      // This tests the mutual exclusivity pattern:
      // 1. Task starts in "today" list (dueDay = today)
      // 2. User schedules it for tomorrow via schedule dialog
      // 3. After scheduling: dueWithTime is set, dueDay is cleared (undefined)
      // 4. Task should NOT appear in today's list (dueWithTime is for tomorrow)

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const tomorrowTimestamp = tomorrow.getTime();

      // Task that was scheduled for tomorrow - with mutual exclusivity, dueDay is undefined
      const taskScheduledForTomorrow = {
        id: 'task1',
        tagIds: [],
        dueDay: undefined, // Mutual exclusivity: dueDay cleared when dueWithTime is set
        dueWithTime: tomorrowTimestamp, // Scheduled for 9am tomorrow
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [], // Task was removed from today tag when scheduled for future
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([taskScheduledForTomorrow]) as any;

      const result = selectTodayTaskIds.projector(tagState, taskState, todayStr, 0);
      // Task should NOT appear in today (dueWithTime is for tomorrow)
      expect(result).toEqual([]);
    });

    // Tests for startOfNextDayDiff offset behavior
    describe('with startOfNextDayDiff offset', () => {
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const offsetTodayStr = '2026-02-15';

      it('should include task with dueWithTime at 2 AM Feb 16 when offset is 4h (2 AM - 4h = 10 PM Feb 15 = today)', () => {
        // 2 AM on Feb 16 local time
        const feb16_2am = new Date(2026, 1, 16, 2, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_2am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual(['task1']);
      });

      it('should NOT include task with dueWithTime at 5 AM Feb 16 when offset is 4h (5 AM - 4h = 1 AM Feb 16 != Feb 15)', () => {
        // 5 AM on Feb 16 local time
        const feb16_5am = new Date(2026, 1, 16, 5, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_5am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual([]);
      });

      it('should NOT include task with dueWithTime at 11 PM Feb 14 when offset is 4h (11 PM - 4h = 7 PM Feb 14 != Feb 15)', () => {
        // 11 PM on Feb 14 local time
        const feb14_11pm = new Date(2026, 1, 14, 23, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb14_11pm,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual([]);
      });

      it('should NOT include task with dueWithTime at exactly 4:00 AM Feb 16 when offset is 4h (4 AM - 4h = midnight Feb 16 != Feb 15)', () => {
        // Exactly 4:00 AM on Feb 16 local time
        // 4 AM - 4h offset = midnight Feb 16, which is Feb 16, NOT Feb 15
        const feb16_4am = new Date(2026, 1, 16, 4, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_4am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual([]);
      });

      it('should include task with dueWithTime at 3:59 AM Feb 16 when offset is 4h (3:59 AM - 4h = 11:59 PM Feb 15 = today)', () => {
        // 3:59 AM on Feb 16 local time
        // 3:59 AM - 4h offset = 11:59 PM Feb 15, which IS Feb 15 (today)
        const feb16_3_59am = new Date(2026, 1, 16, 3, 59, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_3_59am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual(['task1']);
      });

      it('should still include task with dueDay matching todayStr regardless of offset', () => {
        // dueDay is a string comparison against todayStr, offset does not affect it
        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: offsetTodayStr, // Matches todayStr directly
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagEmpty = { ...TODAY_TAG, taskIds: [] };
        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual(['task1']);
      });

      it('should handle mix of dueDay and offset-adjusted dueWithTime tasks', () => {
        // Task via dueDay (string match)
        const taskDueDay = {
          id: 'task-dueday',
          tagIds: [],
          dueDay: offsetTodayStr,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Task via dueWithTime at 1 AM Feb 16 (offset: 1 AM - 4h = 9 PM Feb 15 = today)
        const feb16_1am = new Date(2026, 1, 16, 1, 0, 0, 0).getTime();
        const taskDueWithTimeInRange = {
          id: 'task-offset-ok',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_1am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Task via dueWithTime at 6 AM Feb 16 (offset: 6 AM - 4h = 2 AM Feb 16 != Feb 15)
        const feb16_6am = new Date(2026, 1, 16, 6, 0, 0, 0).getTime();
        const taskDueWithTimeOutOfRange = {
          id: 'task-offset-out',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_6am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagWithOrder = {
          ...TODAY_TAG,
          taskIds: ['task-dueday', 'task-offset-ok'],
        };
        const tagState = fakeEntityStateFromArray([todayTagWithOrder]);
        const taskState = fakeEntityStateFromArray([
          taskDueDay,
          taskDueWithTimeInRange,
          taskDueWithTimeOutOfRange,
        ]) as any;

        const result = selectTodayTaskIds.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        // task-offset-out excluded, the other two included in stored order
        expect(result).toEqual(['task-dueday', 'task-offset-ok']);
      });
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

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
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
        todayStr,
        0,
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

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
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

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task3', 'task1', 'task2'], // Preserve task3, task1 order; append task2
      });
    });

    it('should exclude subtasks whose parent IS in Today list', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: todayStr, // Parent IS in Today
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      // taskIds incorrectly includes subtask (should only have parent)
      const todayTagWithSubtask = {
        ...TODAY_TAG,
        taskIds: ['parent', 'subtask1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithSubtask]);
      const taskState = fakeEntityStateFromArray([parentTask, subtask]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['parent'], // subtask removed - it will appear nested under parent
      });
    });

    it('should include subtasks whose parent is NOT in Today list', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: '2000-01-01', // Parent is NOT in Today
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr, // Subtask IS in Today
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      // taskIds correctly includes subtask as top-level item
      const todayTagWithSubtaskAsTopLevel = {
        ...TODAY_TAG,
        taskIds: ['subtask1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithSubtaskAsTopLevel]);
      const taskState = fakeEntityStateFromArray([parentTask, subtask]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      // No repair needed - subtask should be included because parent is not in Today
      expect(result).toBeNull();
    });

    it('should add missing subtasks whose parent is NOT in Today list', () => {
      const parentTask = {
        id: 'parent',
        tagIds: [],
        dueDay: '2000-01-01', // Parent is NOT in Today
        subTaskIds: ['subtask1'],
      } as Partial<TaskCopy> as TaskCopy;
      const subtask = {
        id: 'subtask1',
        tagIds: [],
        dueDay: todayStr, // Subtask IS in Today
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;
      const regularTask = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // taskIds is missing the subtask
      const todayTagMissingSubtask = {
        ...TODAY_TAG,
        taskIds: ['task1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagMissingSubtask]);
      const taskState = fakeEntityStateFromArray([
        parentTask,
        subtask,
        regularTask,
      ]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['task1', 'subtask1'], // subtask added because parent not in Today
      });
    });

    it('should return null when empty and consistent', () => {
      const todayTagEmpty = {
        ...TODAY_TAG,
        taskIds: [],
      };

      const tagState = fakeEntityStateFromArray([todayTagEmpty]);
      const taskState = fakeEntityStateFromArray([]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toBeNull();
    });

    it('should handle duplicate task IDs in storedTaskIds gracefully', () => {
      const task1 = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // Duplicate IDs in taskIds
      const todayTagWithDuplicates = {
        ...TODAY_TAG,
        taskIds: ['task1', 'task1', 'task1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithDuplicates]);
      const taskState = fakeEntityStateFromArray([task1]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      // All duplicates are valid (task1 has dueDay === today), so no repair needed
      // The repair logic filters by tasksForTodaySet.has(id), which returns true for all
      expect(result).toBeNull();
    });

    it('should handle task with parentId pointing to non-existent task', () => {
      // Subtask whose parent doesn't exist in taskState
      const orphanSubtask = {
        id: 'orphan-sub',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'non-existent-parent',
      } as Partial<TaskCopy> as TaskCopy;

      const todayTagWithOrphan = {
        ...TODAY_TAG,
        taskIds: ['orphan-sub'],
      };

      const tagState = fakeEntityStateFromArray([todayTagWithOrphan]);
      const taskState = fakeEntityStateFromArray([orphanSubtask]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      // Orphan subtask's parent is not in allTasksWithDueToday, so subtask IS valid
      expect(result).toBeNull();
    });

    it('should handle complex subtask hierarchy', () => {
      // Parent with dueDay today
      const parent = {
        id: 'parent',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: ['sub1'],
      } as Partial<TaskCopy> as TaskCopy;

      // Subtask of parent - should NOT be in today list (parent is)
      const sub1 = {
        id: 'sub1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      // Another parent without dueDay today
      const parent2 = {
        id: 'parent2',
        tagIds: [],
        dueDay: '2000-01-01',
        subTaskIds: ['sub2'],
      } as Partial<TaskCopy> as TaskCopy;

      // Subtask of parent2 - SHOULD be in today list (parent2 is not)
      const sub2 = {
        id: 'sub2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent2',
      } as Partial<TaskCopy> as TaskCopy;

      const todayTag = {
        ...TODAY_TAG,
        taskIds: ['parent', 'sub2'], // Correct: parent and sub2 (whose parent is not today)
      };

      const tagState = fakeEntityStateFromArray([todayTag]);
      const taskState = fakeEntityStateFromArray([parent, sub1, parent2, sub2]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      // No repair needed - parent is valid, sub2 is valid (parent2 not in today)
      expect(result).toBeNull();
    });

    it('should detect when subtask incorrectly appears alongside its parent', () => {
      const parent = {
        id: 'parent',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: ['sub1'],
      } as Partial<TaskCopy> as TaskCopy;

      const sub1 = {
        id: 'sub1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      // Incorrectly includes sub1 alongside parent
      const todayTagIncorrect = {
        ...TODAY_TAG,
        taskIds: ['parent', 'sub1'],
      };

      const tagState = fakeEntityStateFromArray([todayTagIncorrect]);
      const taskState = fakeEntityStateFromArray([parent, sub1]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['parent'], // sub1 removed - it will appear nested under parent
      });
    });

    it('should preserve ordering for valid subtasks when repairing', () => {
      // Parent NOT in today
      const parent = {
        id: 'parent',
        tagIds: [],
        dueDay: '2000-01-01',
        subTaskIds: ['sub1', 'sub2'],
      } as Partial<TaskCopy> as TaskCopy;

      const sub1 = {
        id: 'sub1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      const sub2 = {
        id: 'sub2',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
        parentId: 'parent',
      } as Partial<TaskCopy> as TaskCopy;

      const regularTask = {
        id: 'task1',
        tagIds: [],
        dueDay: todayStr,
        subTaskIds: [],
      } as Partial<TaskCopy> as TaskCopy;

      // Order: sub2, task1 (sub1 is missing)
      const todayTag = {
        ...TODAY_TAG,
        taskIds: ['sub2', 'task1'],
      };

      const tagState = fakeEntityStateFromArray([todayTag]);
      const taskState = fakeEntityStateFromArray([
        parent,
        sub1,
        sub2,
        regularTask,
      ]) as any;

      const result = selectTodayTagRepair.projector(tagState, taskState, todayStr, 0);
      expect(result).toEqual({
        needsRepair: true,
        repairedTaskIds: ['sub2', 'task1', 'sub1'], // Preserve order, append missing sub1
      });
    });

    describe('with startOfNextDayDiff offset', () => {
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const offsetTodayStr = '2026-02-15';

      it('should return null when task with offset-adjusted dueWithTime is consistent', () => {
        // 2 AM on Feb 16: with 4h offset, maps to Feb 15 (today)
        const feb16_2am = new Date(2026, 1, 16, 2, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_2am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagConsistent = {
          ...TODAY_TAG,
          taskIds: ['task1'],
        };

        const tagState = fakeEntityStateFromArray([todayTagConsistent]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTagRepair.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toBeNull();
      });

      it('should detect stale task when dueWithTime falls outside offset range', () => {
        // 5 AM on Feb 16: with 4h offset, maps to 1 AM Feb 16 != Feb 15
        const feb16_5am = new Date(2026, 1, 16, 5, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_5am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Stale: task1 is in storedTaskIds but its offset-adjusted time is NOT Feb 15
        const todayTagWithStale = {
          ...TODAY_TAG,
          taskIds: ['task1'],
        };

        const tagState = fakeEntityStateFromArray([todayTagWithStale]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTagRepair.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual({
          needsRepair: true,
          repairedTaskIds: [],
        });
      });

      it('should detect missing task when dueWithTime falls within offset range', () => {
        // 1 AM on Feb 16: with 4h offset, maps to 9 PM Feb 15 = today
        const feb16_1am = new Date(2026, 1, 16, 1, 0, 0, 0).getTime();

        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_1am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Missing: task1 belongs to today but is not in storedTaskIds
        const todayTagEmpty = {
          ...TODAY_TAG,
          taskIds: [],
        };

        const tagState = fakeEntityStateFromArray([todayTagEmpty]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTagRepair.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual({
          needsRepair: true,
          repairedTaskIds: ['task1'],
        });
      });

      it('should correctly recognize dueDay task as belonging to today with non-zero offset', () => {
        // dueDay is compared as string against todayStr; offset does not affect it
        const task = {
          id: 'task1',
          tagIds: [],
          dueDay: offsetTodayStr,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        const todayTagConsistent = {
          ...TODAY_TAG,
          taskIds: ['task1'],
        };

        const tagState = fakeEntityStateFromArray([todayTagConsistent]);
        const taskState = fakeEntityStateFromArray([task]) as any;

        const result = selectTodayTagRepair.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toBeNull();
      });

      it('should handle mixed dueDay and offset-adjusted dueWithTime tasks needing repair', () => {
        // dueDay task - belongs to today
        const taskDueDay = {
          id: 'task-dueday',
          tagIds: [],
          dueDay: offsetTodayStr,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // dueWithTime at 3 AM Feb 16 (3 AM - 4h = 11 PM Feb 15 = today)
        const feb16_3am = new Date(2026, 1, 16, 3, 0, 0, 0).getTime();
        const taskInRange = {
          id: 'task-in-range',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_3am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // dueWithTime at 6 AM Feb 16 (6 AM - 4h = 2 AM Feb 16 != Feb 15) - stale
        const feb16_6am = new Date(2026, 1, 16, 6, 0, 0, 0).getTime();
        const taskOutOfRange = {
          id: 'task-out-range',
          tagIds: [],
          dueDay: undefined,
          dueWithTime: feb16_6am,
          subTaskIds: [],
        } as Partial<TaskCopy> as TaskCopy;

        // Stored order has stale task-out-range, missing task-in-range
        const todayTag = {
          ...TODAY_TAG,
          taskIds: ['task-dueday', 'task-out-range'],
        };

        const tagState = fakeEntityStateFromArray([todayTag]);
        const taskState = fakeEntityStateFromArray([
          taskDueDay,
          taskInRange,
          taskOutOfRange,
        ]) as any;

        const result = selectTodayTagRepair.projector(
          tagState,
          taskState,
          offsetTodayStr,
          FOUR_HOURS_MS,
        );
        expect(result).toEqual({
          needsRepair: true,
          repairedTaskIds: ['task-dueday', 'task-in-range'],
        });
      });
    });
  });
});

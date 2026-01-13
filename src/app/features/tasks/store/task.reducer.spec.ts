/* eslint-disable @typescript-eslint/naming-convention */
import { Task, TaskState } from '../task.model';
import { initialTaskState, taskReducer } from './task.reducer';
import * as fromActions from './task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../../project/project.const';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';

describe('Task Reducer', () => {
  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: INBOX_PROJECT.id,
    parentId: undefined,
    timeSpentOnDay: {},
    timeEstimate: 0,
    timeSpent: 0,
    dueDay: undefined,
    dueWithTime: undefined,
    attachments: [],
    ...partial,
  });

  // Create some test tasks
  const task1 = createTask('task1');
  const task2 = createTask('task2');
  const subTask1 = createTask('subTask1', { parentId: 'task1' });
  const subTask2 = createTask('subTask2', { parentId: 'task1' });

  // Create initial state with some tasks
  const stateWithTasks: TaskState = {
    ...initialTaskState,
    ids: ['task1', 'task2', 'subTask1', 'subTask2'],
    entities: {
      task1: { ...task1, subTaskIds: ['subTask1', 'subTask2'] },
      task2,
      subTask1,
      subTask2,
    },
    currentTaskId: 'task1',
  };

  describe('unknown action', () => {
    it('should return the default state', () => {
      const action = { type: 'UNKNOWN' };
      const state = taskReducer(initialTaskState, action);

      expect(state).toBe(initialTaskState);
    });
  });

  describe('Task operations still handled by task reducer', () => {
    it('should handle unknown actions by returning current state', () => {
      const unknownAction = { type: 'UNKNOWN_ACTION' } as any;
      const state = taskReducer(stateWithTasks, unknownAction);

      expect(state).toBe(stateWithTasks);
    });
  });

  describe('Note: CRUD operations moved to meta-reducer', () => {
    it('should note that addTask is now handled by TaskSharedActions in meta-reducer', () => {
      // This test documents that addTask has been moved to the meta-reducer
      // and is no longer handled directly by the task reducer.
      // See task-shared.reducer.spec.ts for comprehensive addTask tests.
      expect(TaskSharedActions.addTask).toBeDefined();
    });

    it('should note that deleteTask is now handled by TaskSharedActions in meta-reducer', () => {
      // This test documents that deleteTask has been moved to the meta-reducer
      // and is no longer handled directly by the task reducer.
      // See task-shared.reducer.spec.ts for comprehensive deleteTask tests.
      expect(TaskSharedActions.deleteTask).toBeDefined();
    });
  });

  describe('Subtask operations', () => {
    it('should add a subtask to a parent task', () => {
      const newSubTask = createTask('subTask3');
      const action = fromActions.addSubTask({
        task: newSubTask,
        parentId: 'task1',
      });
      const state = taskReducer(stateWithTasks, action);

      expect(state.entities['task1']!.subTaskIds).toContain('subTask3');
      expect(state.entities['subTask3']).toEqual({ ...newSubTask, parentId: 'task1' });
    });
  });

  describe('moveSubTask (anchor-based)', () => {
    const createStateWithSubtasks = (): TaskState => ({
      ...initialTaskState,
      ids: ['parent1', 'parent2', 'sub1', 'sub2', 'sub3', 'sub4'],
      entities: {
        parent1: createTask('parent1', { subTaskIds: ['sub1', 'sub2', 'sub3'] }),
        parent2: createTask('parent2', { subTaskIds: ['sub4'] }),
        sub1: createTask('sub1', { parentId: 'parent1' }),
        sub2: createTask('sub2', { parentId: 'parent1' }),
        sub3: createTask('sub3', { parentId: 'parent1' }),
        sub4: createTask('sub4', { parentId: 'parent2' }),
      },
    });

    describe('reordering within same parent', () => {
      it('should move subtask to start when afterTaskId is null', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub3',
          srcTaskId: 'parent1',
          targetTaskId: 'parent1',
          afterTaskId: null,
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub3', 'sub1', 'sub2']);
      });

      it('should move subtask after specified anchor', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub3',
          srcTaskId: 'parent1',
          targetTaskId: 'parent1',
          afterTaskId: 'sub1',
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub1', 'sub3', 'sub2']);
      });

      it('should move subtask to end when anchor is last item', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent1',
          afterTaskId: 'sub3',
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub2', 'sub3', 'sub1']);
      });

      it('should handle moving item that is already at target position', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub2',
          srcTaskId: 'parent1',
          targetTaskId: 'parent1',
          afterTaskId: 'sub1',
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub1', 'sub2', 'sub3']);
      });
    });

    describe('moving between parents', () => {
      it('should move subtask to different parent at start', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent2',
          afterTaskId: null,
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub2', 'sub3']);
        expect(result.entities['parent2']!.subTaskIds).toEqual(['sub1', 'sub4']);
        expect(result.entities['sub1']!.parentId).toBe('parent2');
      });

      it('should move subtask to different parent after anchor', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent2',
          afterTaskId: 'sub4',
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub2', 'sub3']);
        expect(result.entities['parent2']!.subTaskIds).toEqual(['sub4', 'sub1']);
        expect(result.entities['sub1']!.parentId).toBe('parent2');
      });

      it('should update projectId when moving to parent with different project', () => {
        const state: TaskState = {
          ...initialTaskState,
          ids: ['parent1', 'parent2', 'sub1'],
          entities: {
            parent1: createTask('parent1', {
              subTaskIds: ['sub1'],
              projectId: 'project1',
            }),
            parent2: createTask('parent2', { subTaskIds: [], projectId: 'project2' }),
            sub1: createTask('sub1', { parentId: 'parent1', projectId: 'project1' }),
          },
        };

        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent2',
          afterTaskId: null,
        });

        const result = taskReducer(state, action);
        expect(result.entities['sub1']!.projectId).toBe('project2');
      });
    });

    describe('edge cases', () => {
      it('should handle anchor not found by appending to end', () => {
        const state = createStateWithSubtasks();
        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent1',
          afterTaskId: 'non-existent',
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual(['sub2', 'sub3', 'sub1']);
      });

      it('should handle moving to empty parent', () => {
        const state: TaskState = {
          ...initialTaskState,
          ids: ['parent1', 'parent2', 'sub1'],
          entities: {
            parent1: createTask('parent1', { subTaskIds: ['sub1'] }),
            parent2: createTask('parent2', { subTaskIds: [] }),
            sub1: createTask('sub1', { parentId: 'parent1' }),
          },
        };

        const action = fromActions.moveSubTask({
          taskId: 'sub1',
          srcTaskId: 'parent1',
          targetTaskId: 'parent2',
          afterTaskId: null,
        });

        const result = taskReducer(state, action);
        expect(result.entities['parent1']!.subTaskIds).toEqual([]);
        expect(result.entities['parent2']!.subTaskIds).toEqual(['sub1']);
      });
    });
  });

  describe('moveSubTaskUp', () => {
    it('should move subtask up one position', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskUp({
          id: 'subTask2',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask2', 'subTask1']);
    });

    it('should not change order when subtask is already at top', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskUp({
          id: 'subTask1',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask1', 'subTask2']);
    });

    it('should return unchanged state when parent not found', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskUp({
          id: 'subTask1',
          parentId: 'non-existent',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });

    it('should return unchanged state when subtask not in parent', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskUp({
          id: 'subTask1',
          parentId: 'task2',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });
  });

  describe('moveSubTaskDown', () => {
    it('should move subtask down one position', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskDown({
          id: 'subTask1',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask2', 'subTask1']);
    });

    it('should not change order when subtask is already at bottom', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskDown({
          id: 'subTask2',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask1', 'subTask2']);
    });

    it('should return unchanged state when parent not found', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskDown({
          id: 'subTask1',
          parentId: 'non-existent',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });

    it('should return unchanged state when subtask not in parent', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskDown({
          id: 'subTask1',
          parentId: 'task2',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });
  });

  describe('moveSubTaskToTop', () => {
    it('should move subtask to top of list', () => {
      const stateWithThreeSubtasks: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'sub1', 'sub2', 'sub3'],
        entities: {
          task1: createTask('task1', { subTaskIds: ['sub1', 'sub2', 'sub3'] }),
          sub1: createTask('sub1', { parentId: 'task1' }),
          sub2: createTask('sub2', { parentId: 'task1' }),
          sub3: createTask('sub3', { parentId: 'task1' }),
        },
      };

      const state = taskReducer(
        stateWithThreeSubtasks,
        fromActions.moveSubTaskToTop({
          id: 'sub3',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['sub3', 'sub1', 'sub2']);
    });

    it('should not change order when subtask is already at top', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToTop({
          id: 'subTask1',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask1', 'subTask2']);
    });

    it('should return unchanged state when parent not found', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToTop({
          id: 'subTask1',
          parentId: 'non-existent',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });

    it('should return unchanged state when subtask not in parent', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToTop({
          id: 'subTask1',
          parentId: 'task2',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });
  });

  describe('moveSubTaskToBottom', () => {
    it('should move subtask to bottom of list', () => {
      const stateWithThreeSubtasks: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'sub1', 'sub2', 'sub3'],
        entities: {
          task1: createTask('task1', { subTaskIds: ['sub1', 'sub2', 'sub3'] }),
          sub1: createTask('sub1', { parentId: 'task1' }),
          sub2: createTask('sub2', { parentId: 'task1' }),
          sub3: createTask('sub3', { parentId: 'task1' }),
        },
      };

      const state = taskReducer(
        stateWithThreeSubtasks,
        fromActions.moveSubTaskToBottom({
          id: 'sub1',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['sub2', 'sub3', 'sub1']);
    });

    it('should not change order when subtask is already at bottom', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToBottom({
          id: 'subTask2',
          parentId: 'task1',
        }),
      );

      expect(state.entities['task1']!.subTaskIds).toEqual(['subTask1', 'subTask2']);
    });

    it('should return unchanged state when parent not found', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToBottom({
          id: 'subTask1',
          parentId: 'non-existent',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });

    it('should return unchanged state when subtask not in parent', () => {
      const state = taskReducer(
        stateWithTasks,
        fromActions.moveSubTaskToBottom({
          id: 'subTask1',
          parentId: 'task2',
        }),
      );

      expect(state).toBe(stateWithTasks);
    });
  });

  describe('Current task operations', () => {
    it('should set current task', () => {
      const action = fromActions.setCurrentTask({ id: 'task2' });
      const state = taskReducer(stateWithTasks, action);

      expect(state.currentTaskId).toBe('task2');
    });

    it('should unset current task', () => {
      const action = fromActions.unsetCurrentTask();
      const state = taskReducer(stateWithTasks, action);

      expect(state.currentTaskId).toBeNull();
      expect(state.lastCurrentTaskId).toBe('task1');
    });
  });

  describe('removeTasksFromTodayTag action', () => {
    it('should maintain task order by moving removed tasks to the beginning', () => {
      const stateWithOrderedTasks: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'task2', 'task3', 'task4'],
        entities: {
          task1: createTask('task1'),
          task2: createTask('task2'),
          task3: createTask('task3'),
          task4: createTask('task4'),
        },
      };

      const action = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: ['task2', 'task4'],
      });
      const state = taskReducer(stateWithOrderedTasks, action);

      // The removed tasks should be moved to the beginning while maintaining their relative order
      expect(state.ids).toEqual(['task2', 'task4', 'task1', 'task3']);
    });
  });

  describe('TaskSharedActions.addTagToTask', () => {
    it('should add tagId to task tagIds', () => {
      const action = TaskSharedActions.addTagToTask({
        taskId: 'task1',
        tagId: 'tag1',
      });
      const state = taskReducer(stateWithTasks, action);

      expect(state.entities['task1']!.tagIds).toContain('tag1');
    });

    it('should ensure tagId uniqueness', () => {
      const stateWithTag = taskReducer(
        stateWithTasks,
        TaskSharedActions.addTagToTask({ taskId: 'task1', tagId: 'tag1' }),
      );

      const action = TaskSharedActions.addTagToTask({
        taskId: 'task1',
        tagId: 'tag1',
      });
      const state = taskReducer(stateWithTag, action);

      expect(state.entities['task1']!.tagIds.length).toBe(1);
      expect(state.entities['task1']!.tagIds).toContain('tag1');
    });
  });

  describe('Incremental parent time update optimization', () => {
    const createTaskWithTime = (
      id: string,
      timeSpentOnDay: { [key: string]: number },
      parentId?: string,
    ): Task =>
      createTask(id, {
        timeSpentOnDay,
        timeSpent: Object.values(timeSpentOnDay).reduce((a, b) => a + b, 0),
        parentId,
      });

    it('should incrementally update parent timeSpentOnDay when subtask time is added', () => {
      const parentTask = createTaskWithTime('parent', {
        '2024-01-01': 3600,
        '2024-01-02': 1800,
      });
      const subtask1 = createTaskWithTime(
        'sub1',
        { '2024-01-01': 1800, '2024-01-02': 900 },
        'parent',
      );
      const subtask2 = createTaskWithTime(
        'sub2',
        { '2024-01-01': 1800, '2024-01-02': 900 },
        'parent',
      );

      const stateWithParent: TaskState = {
        ...initialTaskState,
        ids: ['parent', 'sub1', 'sub2'],
        entities: {
          parent: { ...parentTask, subTaskIds: ['sub1', 'sub2'] },
          sub1: subtask1,
          sub2: subtask2,
        },
      };

      // Add 600ms to subtask1 on 2024-01-01
      const action = TimeTrackingActions.addTimeSpent({
        task: subtask1,
        date: '2024-01-01',
        duration: 600,
        isFromTrackingReminder: false,
      });
      const state = taskReducer(stateWithParent, action);

      // Parent should have incremental update: 3600 + 600 = 4200 for 01-01
      expect(state.entities['parent']!.timeSpentOnDay['2024-01-01']).toBe(4200);
      expect(state.entities['parent']!.timeSpentOnDay['2024-01-02']).toBe(1800);
      expect(state.entities['parent']!.timeSpent).toBe(6000); // 4200 + 1800
    });

    it('should handle adding time to a new day', () => {
      const parentTask = createTaskWithTime('parent', { '2024-01-01': 3600 });
      const subtask = createTaskWithTime('sub', { '2024-01-01': 3600 }, 'parent');

      const stateWithParent: TaskState = {
        ...initialTaskState,
        ids: ['parent', 'sub'],
        entities: {
          parent: { ...parentTask, subTaskIds: ['sub'] },
          sub: subtask,
        },
      };

      // Add time to a new day (2024-01-02)
      const action = TimeTrackingActions.addTimeSpent({
        task: subtask,
        date: '2024-01-02',
        duration: 1800,
        isFromTrackingReminder: false,
      });
      const state = taskReducer(stateWithParent, action);

      expect(state.entities['parent']!.timeSpentOnDay['2024-01-01']).toBe(3600);
      expect(state.entities['parent']!.timeSpentOnDay['2024-01-02']).toBe(1800);
      expect(state.entities['parent']!.timeSpent).toBe(5400);
    });

    it('should correctly update subtask and parent timeSpent totals', () => {
      const parentTask = createTaskWithTime('parent', { '2024-01-01': 1000 });
      const subtask = createTaskWithTime('sub', { '2024-01-01': 1000 }, 'parent');

      const stateWithParent: TaskState = {
        ...initialTaskState,
        ids: ['parent', 'sub'],
        entities: {
          parent: { ...parentTask, subTaskIds: ['sub'] },
          sub: subtask,
        },
      };

      // Add more time
      const action = TimeTrackingActions.addTimeSpent({
        task: subtask,
        date: '2024-01-01',
        duration: 500,
        isFromTrackingReminder: false,
      });
      const state = taskReducer(stateWithParent, action);

      // Subtask should have updated timeSpent
      expect(state.entities['sub']!.timeSpentOnDay['2024-01-01']).toBe(1500);
      expect(state.entities['sub']!.timeSpent).toBe(1500);

      // Parent should have incremental update
      expect(state.entities['parent']!.timeSpentOnDay['2024-01-01']).toBe(1500);
      expect(state.entities['parent']!.timeSpent).toBe(1500);
    });
  });

  describe('moveToArchive action - orphan subtask handling', () => {
    // These tests document the defensive fix for a race condition where:
    // 1. Client A adds subtask to parent
    // 2. Client B does SYNC_IMPORT before parent.subTaskIds is synced
    // 3. Client A archives parent
    // 4. Client B receives archive op with stale subTaskIds (missing the new subtask)
    // The fix ensures subtasks are looked up from state, not just from the action payload.

    beforeEach(() => {
      // Mock confirm to return false to prevent devError from throwing
      // Note: confirm may already be spied, so we use callFake on the existing spy
      if (jasmine.isSpy(window.confirm)) {
        (window.confirm as jasmine.Spy).and.returnValue(false);
      } else {
        spyOn(window, 'confirm').and.returnValue(false);
      }
      if (!jasmine.isSpy(window.alert)) {
        spyOn(window, 'alert');
      }
    });

    it('should remove subtasks even when they are in state but not in payload subTaskIds', () => {
      // State has a subtask that points to parent, but parent's subTaskIds is empty
      // This simulates the race condition scenario
      const orphanSubTask = createTask('orphan-sub', { parentId: 'task1' });
      const parentWithEmptySubTaskIds = { ...task1, subTaskIds: [] };

      const stateWithOrphan: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'orphan-sub'],
        entities: {
          task1: parentWithEmptySubTaskIds,
          'orphan-sub': orphanSubTask,
        },
      };

      // Archive action has parent with empty subTaskIds (stale data from another client)
      const action = TaskSharedActions.moveToArchive({
        tasks: [parentWithEmptySubTaskIds as any],
      });

      const state = taskReducer(stateWithOrphan, action);

      // AFTER FIX: Both parent and orphan subtask should be removed
      expect(state.ids).not.toContain('task1');
      expect(state.ids).not.toContain('orphan-sub');
      expect(state.entities['task1']).toBeUndefined();
      expect(state.entities['orphan-sub']).toBeUndefined();
    });

    it('should remove all subtasks: those in payload AND those in state', () => {
      // Parent has sub1 in subTaskIds, but sub2 is orphaned (in state but not in subTaskIds)
      const sub1 = createTask('sub1', { parentId: 'task1' });
      const sub2 = createTask('sub2', { parentId: 'task1' }); // orphan
      const parentWithOnlySub1 = { ...task1, subTaskIds: ['sub1'] };

      const stateWithMixed: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'sub1', 'sub2'],
        entities: {
          task1: parentWithOnlySub1,
          sub1: sub1,
          sub2: sub2,
        },
      };

      const action = TaskSharedActions.moveToArchive({
        tasks: [parentWithOnlySub1 as any],
      });

      const state = taskReducer(stateWithMixed, action);

      // All should be removed
      expect(state.ids).toEqual([]);
      expect(state.entities['task1']).toBeUndefined();
      expect(state.entities['sub1']).toBeUndefined();
      expect(state.entities['sub2']).toBeUndefined();
    });

    it('should clear currentTaskId if it was an orphan subtask', () => {
      const orphanSubTask = createTask('orphan-sub', { parentId: 'task1' });
      const parentWithEmptySubTaskIds = { ...task1, subTaskIds: [] };

      const stateWithOrphanAsCurrent: TaskState = {
        ...initialTaskState,
        ids: ['task1', 'orphan-sub'],
        entities: {
          task1: parentWithEmptySubTaskIds,
          'orphan-sub': orphanSubTask,
        },
        currentTaskId: 'orphan-sub', // Current task is the orphan
      };

      const action = TaskSharedActions.moveToArchive({
        tasks: [parentWithEmptySubTaskIds as any],
      });

      const state = taskReducer(stateWithOrphanAsCurrent, action);

      // Current task should be cleared since orphan subtask was removed
      expect(state.currentTaskId).toBeNull();
    });
  });
});

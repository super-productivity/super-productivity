/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration tests for bulk hydration optimization.
 *
 * These tests verify that the bulkHydrationMetaReducer correctly applies
 * multiple operations in a single dispatch, producing the same final state
 * as individual dispatches would.
 *
 * This is critical for the startup performance optimization where 500+
 * operations need to be replayed efficiently.
 */
import { ActionReducer, Action } from '@ngrx/store';
import { bulkHydrationMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyHydrationOperations } from '../../apply/bulk-hydration.action';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';

describe('Bulk Hydration Integration', () => {
  const TASKS_FEATURE = 'tasks';

  interface TaskEntity {
    id: string;
    title: string;
    notes: string;
    done: boolean;
    tagIds: string[];
    projectId: string | null;
    modified: number;
  }

  interface TaskState {
    ids: string[];
    entities: Record<string, TaskEntity>;
  }

  interface MockRootState {
    [TASKS_FEATURE]: TaskState;
  }

  const createTaskState = (tasks: Record<string, TaskEntity>): TaskState => ({
    ids: Object.keys(tasks),
    entities: tasks,
  });

  const createMockRootState = (
    tasks: Record<string, TaskEntity> = {},
  ): MockRootState => ({
    [TASKS_FEATURE]: createTaskState(tasks),
  });

  const createOperation = (
    id: string,
    opType: OpType,
    actionType: string,
    payload: unknown,
    entityId?: string,
  ): Operation => ({
    id,
    actionType: actionType as ActionType,
    opType,
    entityType: 'TASK',
    entityId,
    payload,
    clientId: 'test-client',
    vectorClock: { 'test-client': 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  /**
   * A simple reducer that handles task CRUD operations.
   * This simulates the real task reducer behavior for testing.
   */
  const taskCrudReducer: ActionReducer<MockRootState, Action> = (
    state: MockRootState | undefined,
    action: Action,
  ): MockRootState => {
    const currentState = state || createMockRootState();

    // Handle Add Task
    if (action.type === '[Task] Add Task') {
      const taskAction = action as Action & { task: TaskEntity };
      const task = taskAction.task;
      return {
        ...currentState,
        [TASKS_FEATURE]: {
          ids: [...currentState[TASKS_FEATURE].ids, task.id],
          entities: {
            ...currentState[TASKS_FEATURE].entities,
            [task.id]: task,
          },
        },
      };
    }

    // Handle Update Task
    if (action.type === '[Task] Update Task') {
      const updateAction = action as Action & {
        task: { id: string; changes: Partial<TaskEntity> };
      };
      const { id, changes } = updateAction.task;
      const existingTask = currentState[TASKS_FEATURE].entities[id];
      if (!existingTask) return currentState;

      return {
        ...currentState,
        [TASKS_FEATURE]: {
          ...currentState[TASKS_FEATURE],
          entities: {
            ...currentState[TASKS_FEATURE].entities,
            [id]: { ...existingTask, ...changes },
          },
        },
      };
    }

    // Handle Delete Task
    if (action.type === '[Task] Delete Task') {
      const deleteAction = action as Action & { task: { id: string } };
      const idToDelete = deleteAction.task.id;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [idToDelete]: _deleted, ...remainingEntities } =
        currentState[TASKS_FEATURE].entities;

      return {
        ...currentState,
        [TASKS_FEATURE]: {
          ids: currentState[TASKS_FEATURE].ids.filter((id) => id !== idToDelete),
          entities: remainingEntities,
        },
      };
    }

    return currentState;
  };

  describe('bulk dispatch equivalence', () => {
    it('should produce same state as individual dispatches for mixed operations', () => {
      // Compose the reducer chain: bulk -> lww -> taskCrud
      const composedReducer = bulkHydrationMetaReducer(
        lwwUpdateMetaReducer(taskCrudReducer),
      ) as ActionReducer<MockRootState, Action>;

      const initialState = createMockRootState({
        'existing-task': {
          id: 'existing-task',
          title: 'Existing Task',
          notes: '',
          done: false,
          tagIds: [],
          projectId: null,
          modified: 1000,
        },
      });

      // Create a sequence of operations
      const operations: Operation[] = [
        // Create a new task
        createOperation('op-1', OpType.Create, '[Task] Add Task', {
          task: {
            id: 'task-1',
            title: 'First Task',
            notes: '',
            done: false,
            tagIds: [],
            projectId: null,
            modified: 2000,
          },
        }),
        // Create another task
        createOperation('op-2', OpType.Create, '[Task] Add Task', {
          task: {
            id: 'task-2',
            title: 'Second Task',
            notes: '',
            done: false,
            tagIds: [],
            projectId: null,
            modified: 2001,
          },
        }),
        // Update first task
        createOperation(
          'op-3',
          OpType.Update,
          '[Task] Update Task',
          { task: { id: 'task-1', changes: { title: 'First Task Updated' } } },
          'task-1',
        ),
        // Update existing task
        createOperation(
          'op-4',
          OpType.Update,
          '[Task] Update Task',
          { task: { id: 'existing-task', changes: { done: true, notes: 'Completed!' } } },
          'existing-task',
        ),
        // Delete second task
        createOperation(
          'op-5',
          OpType.Delete,
          '[Task] Delete Task',
          { task: { id: 'task-2' } },
          'task-2',
        ),
      ];

      // Apply via BULK dispatch (single action)
      const bulkAction = bulkApplyHydrationOperations({ operations });
      const bulkResultState = composedReducer(initialState, bulkAction);

      // Apply via INDIVIDUAL dispatches (for comparison)
      let individualResultState = initialState;
      for (const op of operations) {
        const action = convertOpToAction(op);
        individualResultState = composedReducer(individualResultState, action);
      }

      // Both approaches should produce identical state
      expect(bulkResultState).toEqual(individualResultState);

      // Verify specific state expectations
      expect(bulkResultState[TASKS_FEATURE].ids).toContain('existing-task');
      expect(bulkResultState[TASKS_FEATURE].ids).toContain('task-1');
      expect(bulkResultState[TASKS_FEATURE].ids).not.toContain('task-2'); // deleted

      expect(bulkResultState[TASKS_FEATURE].entities['task-1'].title).toBe(
        'First Task Updated',
      );
      expect(bulkResultState[TASKS_FEATURE].entities['existing-task'].done).toBe(true);
      expect(bulkResultState[TASKS_FEATURE].entities['existing-task'].notes).toBe(
        'Completed!',
      );
    });

    it('should handle 100+ operations correctly', () => {
      const composedReducer = bulkHydrationMetaReducer(taskCrudReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState();

      // Create 100 tasks, then update half of them
      const operations: Operation[] = [];

      // Create 100 tasks
      for (let i = 0; i < 100; i++) {
        operations.push(
          createOperation('op-create-' + i, OpType.Create, '[Task] Add Task', {
            task: {
              id: `task-${i}`,
              title: `Task ${i}`,
              notes: '',
              done: false,
              tagIds: [],
              projectId: null,
              modified: 1000 + i,
            },
          }),
        );
      }

      // Update 50 tasks (mark as done)
      for (let i = 0; i < 50; i++) {
        operations.push(
          createOperation(
            'op-update-' + i,
            OpType.Update,
            '[Task] Update Task',
            { task: { id: `task-${i}`, changes: { done: true } } },
            `task-${i}`,
          ),
        );
      }

      // Delete 10 tasks
      for (let i = 90; i < 100; i++) {
        operations.push(
          createOperation(
            'op-delete-' + i,
            OpType.Delete,
            '[Task] Delete Task',
            { task: { id: `task-${i}` } },
            `task-${i}`,
          ),
        );
      }

      // Apply via bulk dispatch
      const bulkAction = bulkApplyHydrationOperations({ operations });
      const resultState = composedReducer(initialState, bulkAction);

      // Verify results
      // Should have 90 tasks (100 created - 10 deleted)
      expect(resultState[TASKS_FEATURE].ids.length).toBe(90);

      // First 50 should be done
      for (let i = 0; i < 50; i++) {
        expect(resultState[TASKS_FEATURE].entities[`task-${i}`].done).toBe(true);
      }

      // Tasks 50-89 should not be done
      for (let i = 50; i < 90; i++) {
        expect(resultState[TASKS_FEATURE].entities[`task-${i}`].done).toBe(false);
      }

      // Tasks 90-99 should not exist (deleted)
      for (let i = 90; i < 100; i++) {
        expect(resultState[TASKS_FEATURE].entities[`task-${i}`]).toBeUndefined();
      }
    });

    it('should handle sequential updates to same entity', () => {
      const composedReducer = bulkHydrationMetaReducer(taskCrudReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState();

      // Create a task then update it multiple times
      const operations: Operation[] = [
        createOperation('op-1', OpType.Create, '[Task] Add Task', {
          task: {
            id: 'task-1',
            title: 'Version 1',
            notes: '',
            done: false,
            tagIds: [],
            projectId: null,
            modified: 1000,
          },
        }),
        createOperation(
          'op-2',
          OpType.Update,
          '[Task] Update Task',
          { task: { id: 'task-1', changes: { title: 'Version 2' } } },
          'task-1',
        ),
        createOperation(
          'op-3',
          OpType.Update,
          '[Task] Update Task',
          {
            task: { id: 'task-1', changes: { title: 'Version 3', notes: 'Added notes' } },
          },
          'task-1',
        ),
        createOperation(
          'op-4',
          OpType.Update,
          '[Task] Update Task',
          { task: { id: 'task-1', changes: { title: 'Final Version', done: true } } },
          'task-1',
        ),
      ];

      const bulkAction = bulkApplyHydrationOperations({ operations });
      const resultState = composedReducer(initialState, bulkAction);

      // Should have final state from all sequential updates
      const task = resultState[TASKS_FEATURE].entities['task-1'];
      expect(task.title).toBe('Final Version');
      expect(task.notes).toBe('Added notes');
      expect(task.done).toBe(true);
    });

    it('should handle empty operations array', () => {
      const composedReducer = bulkHydrationMetaReducer(taskCrudReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState({
        'task-1': {
          id: 'task-1',
          title: 'Existing',
          notes: '',
          done: false,
          tagIds: [],
          projectId: null,
          modified: 1000,
        },
      });

      const bulkAction = bulkApplyHydrationOperations({ operations: [] });
      const resultState = composedReducer(initialState, bulkAction);

      // State should be unchanged
      expect(resultState).toBe(initialState);
    });
  });

  describe('performance characteristics', () => {
    it('should apply 500 operations synchronously without timeout', () => {
      const composedReducer = bulkHydrationMetaReducer(taskCrudReducer) as ActionReducer<
        MockRootState,
        Action
      >;

      const initialState = createMockRootState();

      // Create 500 operations
      const operations: Operation[] = [];
      for (let i = 0; i < 500; i++) {
        operations.push(
          createOperation('op-' + i, OpType.Create, '[Task] Add Task', {
            task: {
              id: `task-${i}`,
              title: `Task ${i}`,
              notes: '',
              done: false,
              tagIds: [],
              projectId: null,
              modified: 1000 + i,
            },
          }),
        );
      }

      const startTime = performance.now();
      const bulkAction = bulkApplyHydrationOperations({ operations });
      const resultState = composedReducer(initialState, bulkAction);
      const endTime = performance.now();

      // Should complete quickly (under 500ms even on slow CI)
      expect(endTime - startTime).toBeLessThan(500);

      // All 500 tasks should be created
      expect(resultState[TASKS_FEATURE].ids.length).toBe(500);
    });
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration tests for meta-reducer ordering and operation capture.
 *
 * These tests verify that operationCaptureMetaReducer correctly enqueues
 * actions for operation logging, regardless of other meta-reducers in the chain.
 *
 * NOTE: Since state diffing was removed (for performance), the meta-reducer
 * ordering is no longer critical for correctness. The operation capture
 * meta-reducer now simply enqueues actions without comparing before/after state.
 */
import { ActionReducer, Action, MetaReducer } from '@ngrx/store';
import {
  operationCaptureMetaReducer,
  setOperationCaptureService,
  setIsApplyingRemoteOps,
} from '../../capture/operation-capture.meta-reducer';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { EntityType, OpType } from '../../core/operation.types';
import { PersistentAction } from '../../core/persistent-action.interface';

describe('Meta-reducer ordering integration', () => {
  let captureService: OperationCaptureService;
  let enqueuedActions: PersistentAction[];

  // Feature name must match the actual NgRx feature name
  const TASKS_FEATURE = 'tasks';

  interface TaskState {
    ids: string[];
    entities: Record<string, { id: string; title: string }>;
  }

  interface MockRootState {
    [TASKS_FEATURE]: TaskState;
  }

  const createDeleteTaskAction = (taskId: string): PersistentAction => ({
    type: '[Task Shared] deleteTask',
    task: { id: taskId, title: 'Task to delete', subTaskIds: [], tagIds: [] },
    meta: {
      isPersistent: true,
      entityType: 'TASK' as EntityType,
      entityId: taskId,
      opType: OpType.Delete,
    },
  });

  const createTaskState = (
    tasks: Record<string, { id: string; title: string }>,
  ): MockRootState => ({
    [TASKS_FEATURE]: {
      ids: Object.keys(tasks),
      entities: tasks,
    },
  });

  /**
   * A mock meta-reducer that simulates taskSharedCrudMetaReducer behavior.
   * It modifies state BEFORE passing to inner reducers (like the real one does).
   */
  const mockTaskCrudMetaReducer: MetaReducer<MockRootState> = (
    reducer: ActionReducer<MockRootState, Action>,
  ): ActionReducer<MockRootState, Action> => {
    return (state: MockRootState | undefined, action: Action): MockRootState => {
      if (!state) return reducer(state, action);

      // Check if this is a delete task action
      if (action.type === '[Task Shared] deleteTask') {
        const deleteAction = action as PersistentAction & {
          task: { id: string };
        };
        const taskId = deleteAction.task.id;

        // Modify state by removing the task (like the real meta-reducer does)
        const remainingEntities = { ...state[TASKS_FEATURE].entities };
        delete remainingEntities[taskId];
        const modifiedState: MockRootState = {
          ...state,
          [TASKS_FEATURE]: {
            ids: state[TASKS_FEATURE].ids.filter((id) => id !== taskId),
            entities: remainingEntities,
          },
        };

        // Pass MODIFIED state to inner reducers (this is the key behavior)
        return reducer(modifiedState, action);
      }

      return reducer(state, action);
    };
  };

  /**
   * A simple passthrough reducer (simulates feature reducer that doesn't handle the action)
   */
  const passthroughReducer: ActionReducer<MockRootState, Action> = (
    state: MockRootState | undefined,
  ): MockRootState => {
    return state || createTaskState({});
  };

  beforeEach(() => {
    captureService = new OperationCaptureService();
    enqueuedActions = [];

    // Spy on enqueue to capture what actions are being passed
    spyOn(captureService, 'enqueue').and.callFake((action: PersistentAction) => {
      enqueuedActions.push(action);
    });

    setOperationCaptureService(captureService);
    // Reset sync state to prevent test pollution from previous tests
    setIsApplyingRemoteOps(false);
  });

  afterEach(() => {
    captureService.clear();
    // Ensure sync state is reset after each test
    setIsApplyingRemoteOps(false);
  });

  describe('action capture with meta-reducer chain', () => {
    it('should enqueue action when operationCaptureMetaReducer is outermost', () => {
      // Compose: operationCapture wraps taskCrud wraps passthrough
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task to delete' },
      });

      const action = createDeleteTaskAction('task-1');

      // Execute the composed reducer
      const resultState = composedReducer(initialState, action);

      // Verify the result state has the task removed
      expect(resultState[TASKS_FEATURE].ids).not.toContain('task-1');
      expect(resultState[TASKS_FEATURE].entities['task-1']).toBeUndefined();

      // Verify enqueue was called with the action
      expect(captureService.enqueue).toHaveBeenCalledWith(action);
      expect(enqueuedActions.length).toBe(1);
      expect(enqueuedActions[0].meta.entityId).toBe('task-1');
    });

    it('should enqueue action when operationCaptureMetaReducer is innermost', () => {
      // Compose: taskCrud wraps operationCapture wraps passthrough
      // NOTE: Since we no longer diff state, ordering doesn't affect correctness
      const composedReducer = mockTaskCrudMetaReducer(
        operationCaptureMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task to delete' },
      });

      const action = createDeleteTaskAction('task-1');

      // Execute the composed reducer
      const resultState = composedReducer(initialState, action);

      // The task should still be removed from final state
      expect(resultState[TASKS_FEATURE].ids).not.toContain('task-1');

      // enqueue should still be called with the action
      expect(captureService.enqueue).toHaveBeenCalledWith(action);
      expect(enqueuedActions.length).toBe(1);
    });

    it('should capture multiple deletions correctly', () => {
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task 1' },
        'task-2': { id: 'task-2', title: 'Task 2' },
        'task-3': { id: 'task-3', title: 'Task 3' },
      });

      // Delete first task
      const state = composedReducer(initialState, createDeleteTaskAction('task-1'));

      // Delete second task
      const finalState = composedReducer(state, createDeleteTaskAction('task-2'));

      // Final state should only have task-3
      expect(finalState[TASKS_FEATURE].ids).toEqual(['task-3']);

      // Should have enqueued 2 actions
      expect(enqueuedActions.length).toBe(2);
      expect(enqueuedActions[0].meta.entityId).toBe('task-1');
      expect(enqueuedActions[1].meta.entityId).toBe('task-2');
    });
  });

  describe('remote action filtering', () => {
    it('should NOT enqueue remote actions', () => {
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task to delete' },
      });

      // Create a remote action (from sync)
      const remoteAction: PersistentAction = {
        ...createDeleteTaskAction('task-1'),
        meta: {
          ...createDeleteTaskAction('task-1').meta,
          isRemote: true,
        },
      };

      composedReducer(initialState, remoteAction);

      // Should NOT enqueue remote actions
      expect(captureService.enqueue).not.toHaveBeenCalled();
      expect(enqueuedActions.length).toBe(0);
    });
  });

  describe('sync blocking', () => {
    it('should NOT enqueue actions when applying remote operations', () => {
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task to delete' },
      });

      // Simulate sync in progress
      setIsApplyingRemoteOps(true);

      const action = createDeleteTaskAction('task-1');
      composedReducer(initialState, action);

      // Should NOT enqueue when sync is in progress
      expect(captureService.enqueue).not.toHaveBeenCalled();
    });

    it('should resume capturing after sync completes', () => {
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const initialState = createTaskState({
        'task-1': { id: 'task-1', title: 'Task 1' },
        'task-2': { id: 'task-2', title: 'Task 2' },
      });

      // Start sync
      setIsApplyingRemoteOps(true);

      // Action during sync - should not be captured
      const state = composedReducer(initialState, createDeleteTaskAction('task-1'));
      expect(enqueuedActions.length).toBe(0);

      // End sync
      setIsApplyingRemoteOps(false);

      // Action after sync - should be captured
      composedReducer(state, createDeleteTaskAction('task-2'));
      expect(enqueuedActions.length).toBe(1);
      expect(enqueuedActions[0].meta.entityId).toBe('task-2');
    });
  });

  describe('state immutability', () => {
    it('should work with NgRx immutability pattern', () => {
      const composedReducer = operationCaptureMetaReducer(
        mockTaskCrudMetaReducer(passthroughReducer),
      );

      const task1 = { id: 'task-1', title: 'Task 1' };
      const task2 = { id: 'task-2', title: 'Task 2' };

      const initialState = createTaskState({
        'task-1': task1,
        'task-2': task2,
      });

      const action = createDeleteTaskAction('task-1');
      const resultState = composedReducer(initialState, action);

      // Verify different references for changed slice
      expect(resultState[TASKS_FEATURE]).not.toBe(initialState[TASKS_FEATURE]);
      expect(resultState[TASKS_FEATURE].entities).not.toBe(
        initialState[TASKS_FEATURE].entities,
      );

      // Verify the action was enqueued
      expect(enqueuedActions.length).toBe(1);
    });
  });
});

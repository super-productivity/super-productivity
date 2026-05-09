import { Action } from '@ngrx/store';
import { bulkHydrationMetaReducer } from './bulk-hydration.meta-reducer';
import { bulkApplyHydrationOperations } from './bulk-hydration.action';
import { ActionType, Operation, OpType } from '../core/operation.types';
import { RootState } from '../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { Task } from '../../features/tasks/task.model';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';

// Set to true to run stress tests (10k+ operations)
// These tests take 1-2 seconds each and are skipped by default to speed up test runs
const RUN_STRESS_TESTS = false;

describe('bulkHydrationMetaReducer', () => {
  // Helper to conditionally run stress tests
  const stressTest = RUN_STRESS_TESTS ? it : xit;

  // Track all reducer calls for verification
  let reducerCalls: { state: unknown; action: Action }[];
  let mockReducer: jasmine.Spy;

  const TASK_ID = 'task1';
  const TASK_ID_2 = 'task2';
  const PROJECT_ID = 'project1';
  const TAG_ID = 'tag1';

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: TASK_ID,
      title: 'Test Task',
      notes: '',
      timeEstimate: 0,
      timeSpent: 0,
      timeSpentOnDay: {},
      reminderId: null,
      plannedAt: null,
      dueDay: null,
      dueWithTime: null,
      projectId: null,
      issueId: null,
      issueProviderId: null,
      issueType: null,
      issueLastUpdated: null,
      issuePoints: null,
      issueAttachmentNr: null,
      issueWasUpdated: false,
      issueTimeTracked: null,
      issueLinkType: null,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      attachmentIds: [],
      done: false,
      doneOn: null,
      modified: 1000,
      created: 1000,
      repeatCfgId: null,
      issueData: null,
      isDone: false,
      _showSubTasksMode: 2,
      ...overrides,
    }) as Task;

  const createMockProject = (overrides: Partial<Project> = {}): Project =>
    ({
      id: PROJECT_ID,
      title: 'Test Project',
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
      isHiddenFromMenu: false,
      isArchived: false,
      isEnableBacklog: false,
      issueIntegrationCfgs: {},
      theme: {},
      ...overrides,
    }) as Project;

  const createMockTag = (overrides: Partial<Tag> = {}): Tag =>
    ({
      id: TAG_ID,
      title: 'Test Tag',
      taskIds: [],
      color: '#ff0000',
      icon: null,
      ...overrides,
    }) as Tag;

  const createMockState = (): Partial<RootState> =>
    ({
      [TASK_FEATURE_NAME]: {
        ids: [TASK_ID],
        entities: {
          [TASK_ID]: createMockTask(),
        },
        currentTaskId: null,
        selectedTaskId: null,
        taskDetailTargetPanel: null,
        isDataLoaded: true,
        lastCurrentTaskId: null,
      },
      [PROJECT_FEATURE_NAME]: {
        ids: [PROJECT_ID],
        entities: {
          [PROJECT_ID]: createMockProject(),
        },
      },
      [TAG_FEATURE_NAME]: {
        ids: [TAG_ID],
        entities: {
          [TAG_ID]: createMockTag(),
        },
      },
    }) as Partial<RootState>;

  const createMockOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: 'op-1',
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: TASK_ID,
    actionType: '[Task] Update Task' as ActionType,
    payload: { task: { id: TASK_ID, changes: { title: 'Updated Title' } } },
    vectorClock: { client1: 1 },
    clientId: 'client1',
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  beforeEach(() => {
    reducerCalls = [];
    // Create a mock reducer that tracks calls and simulates state updates
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => {
      reducerCalls.push({ state, action });

      // Simulate updating task title for Update operations
      if (action.type === '[Task] Update Task' && state) {
        const taskState = (state as Partial<RootState>)[TASK_FEATURE_NAME];
        if (taskState && action.task?.changes?.title) {
          return {
            ...state,
            [TASK_FEATURE_NAME]: {
              ...taskState,
              entities: {
                ...taskState.entities,
                [action.task.id]: {
                  ...taskState.entities[action.task.id],
                  ...action.task.changes,
                },
              },
            },
          };
        }
      }

      // Simulate adding a new task for Create operations
      if (action.type === '[Task] Add Task' && state && action.task) {
        const taskState = (state as Partial<RootState>)[TASK_FEATURE_NAME];
        if (taskState) {
          return {
            ...state,
            [TASK_FEATURE_NAME]: {
              ...taskState,
              ids: [...(taskState.ids as string[]), action.task.id],
              entities: {
                ...taskState.entities,
                [action.task.id]: action.task,
              },
            },
          };
        }
      }

      return state;
    });
  });

  describe('non-bulk actions', () => {
    it('should pass through non-bulk actions unchanged', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const action = { type: '[Task] Update Task', task: { id: TASK_ID, changes: {} } };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledOnceWith(state, action);
    });

    it('should pass through other action types', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const action = { type: '[Project] Add Project', project: { id: 'proj-1' } };

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledOnceWith(state, action);
    });
  });

  describe('bulkApplyHydrationOperations action', () => {
    it('should apply single operation correctly', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const operation = createMockOperation({
        payload: { task: { id: TASK_ID, changes: { title: 'New Title' } } },
      });
      const action = bulkApplyHydrationOperations({ operations: [operation] });

      const result = reducer(state, action);

      // Reducer should be called once for the operation's action
      expect(mockReducer).toHaveBeenCalledTimes(1);
      const calledAction = reducerCalls[0].action;
      expect(calledAction.type).toBe('[Task] Update Task');
      // Result should have updated title
      const taskState = (result as Partial<RootState>)[TASK_FEATURE_NAME];
      expect(taskState?.entities[TASK_ID]?.title).toBe('New Title');
    });

    it('should apply multiple operations in sequence', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const operations = [
        createMockOperation({
          id: 'op-1',
          payload: { task: { id: TASK_ID, changes: { title: 'First Update' } } },
        }),
        createMockOperation({
          id: 'op-2',
          payload: { task: { id: TASK_ID, changes: { title: 'Second Update' } } },
        }),
        createMockOperation({
          id: 'op-3',
          payload: { task: { id: TASK_ID, changes: { title: 'Third Update' } } },
        }),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      const result = reducer(state, action);

      // Reducer should be called 3 times (once per operation)
      expect(mockReducer).toHaveBeenCalledTimes(3);

      // Final state should reflect the last update
      const taskState = (result as Partial<RootState>)[TASK_FEATURE_NAME];
      expect(taskState?.entities[TASK_ID]?.title).toBe('Third Update');
    });

    it('should handle empty operations array', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const action = bulkApplyHydrationOperations({ operations: [] });

      const result = reducer(state, action);

      // No operations means no reducer calls
      expect(mockReducer).not.toHaveBeenCalled();
      expect(result).toBe(state);
    });

    it('should pass state through reducer chain for each operation', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const operations = [
        createMockOperation({
          id: 'op-1',
          payload: { task: { id: TASK_ID, changes: { title: 'Update 1' } } },
        }),
        createMockOperation({
          id: 'op-2',
          payload: { task: { id: TASK_ID, changes: { title: 'Update 2' } } },
        }),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // First call should receive original state
      expect(reducerCalls[0].state).toBe(state);

      // Second call should receive updated state from first call
      const firstResultState = reducerCalls[1].state as Partial<RootState>;
      expect(firstResultState[TASK_FEATURE_NAME]?.entities[TASK_ID]?.title).toBe(
        'Update 1',
      );
    });

    it('should add isRemote: true meta to converted actions', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const operation = createMockOperation();
      const action = bulkApplyHydrationOperations({ operations: [operation] });

      reducer(state, action);

      const calledAction = reducerCalls[0].action as { meta?: { isRemote?: boolean } };
      expect(calledAction.meta?.isRemote).toBe(true);
    });

    it('should handle Create operations', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const newTask = createMockTask({ id: TASK_ID_2, title: 'New Task' });
      const operation = createMockOperation({
        id: 'op-create',
        opType: OpType.Create,
        entityId: TASK_ID_2,
        actionType: '[Task] Add Task' as ActionType,
        payload: { task: newTask },
      });
      const action = bulkApplyHydrationOperations({ operations: [operation] });

      const result = reducer(state, action);

      // Verify the task was added
      const taskState = (result as Partial<RootState>)[TASK_FEATURE_NAME];
      expect(taskState?.ids).toContain(TASK_ID_2);
      expect(taskState?.entities[TASK_ID_2]).toBeDefined();
    });

    it('should apply 500+ operations efficiently', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // Create 500 operations
      const operations: Operation[] = [];
      for (let i = 0; i < 500; i++) {
        operations.push(
          createMockOperation({
            id: `op-${i}`,
            payload: { task: { id: TASK_ID, changes: { title: `Update ${i}` } } },
          }),
        );
      }
      const action = bulkApplyHydrationOperations({ operations });

      const startTime = performance.now();
      const result = reducer(state, action);
      const endTime = performance.now();

      // Should complete in reasonable time (synchronous, no async overhead)
      expect(endTime - startTime).toBeLessThan(1000); // 1 second max

      // All operations should have been applied
      expect(mockReducer).toHaveBeenCalledTimes(500);

      // Final state should reflect last update
      const taskState = (result as Partial<RootState>)[TASK_FEATURE_NAME];
      expect(taskState?.entities[TASK_ID]?.title).toBe('Update 499');
    });

    /**
     * Stress test: 10,000+ operations
     *
     * This test validates that the bulk hydration system can handle extremely
     * large operation batches without:
     * - Blocking the main thread for too long
     * - Causing memory issues
     * - Performance degradation (O(n) expected, not O(n²))
     *
     * Use case: User syncing after extended offline period with many changes.
     *
     * NOTE: Skipped by default to speed up test runs. Set RUN_STRESS_TESTS=true to enable.
     */
    stressTest(
      'should handle 10,000+ operations without blocking main thread for too long',
      () => {
        const reducer = bulkHydrationMetaReducer(mockReducer);
        const state = createMockState();

        // Create 10,000 operations - mix of different types for realistic scenario
        const operations: Operation[] = [];
        for (let i = 0; i < 10000; i++) {
          // Alternate between update and create operations for variety
          if (i % 10 === 0) {
            // Every 10th operation: create a new task
            const newTaskId = `task-${i}`;
            operations.push(
              createMockOperation({
                id: `op-create-${i}`,
                opType: OpType.Create,
                entityId: newTaskId,
                actionType: '[Task] Add Task' as ActionType,
                payload: { task: createMockTask({ id: newTaskId, title: `Task ${i}` }) },
              }),
            );
          } else {
            // Regular update operation
            operations.push(
              createMockOperation({
                id: `op-update-${i}`,
                payload: { task: { id: TASK_ID, changes: { title: `Update ${i}` } } },
              }),
            );
          }
        }
        const action = bulkApplyHydrationOperations({ operations });

        const startTime = performance.now();
        const result = reducer(state, action);
        const endTime = performance.now();
        const elapsedMs = endTime - startTime;

        // Should complete in under 5 seconds even with 10k ops
        // This is generous to account for CI variability
        expect(elapsedMs).toBeLessThan(5000);

        // Log performance for visibility in test output
        console.log(
          `[STRESS TEST] 10,000 operations completed in ${elapsedMs.toFixed(2)}ms`,
        );

        // All operations should have been applied
        expect(mockReducer).toHaveBeenCalledTimes(10000);

        // Final state should reflect last update
        const taskState = (result as Partial<RootState>)[TASK_FEATURE_NAME];
        expect(taskState?.entities[TASK_ID]?.title).toBe('Update 9999');

        // Verify some created tasks exist
        expect(taskState?.entities['task-0']).toBeDefined();
        expect(taskState?.entities['task-9990']).toBeDefined();
      },
    );

    // Stress test: Skip by default, set RUN_STRESS_TESTS=true to enable
    stressTest(
      'should maintain O(n) performance - 20k ops should take ~2x 10k ops',
      () => {
        const reducer = bulkHydrationMetaReducer(mockReducer);

        // Measure 5k ops
        const state5k = createMockState();
        const ops5k: Operation[] = [];
        for (let i = 0; i < 5000; i++) {
          ops5k.push(
            createMockOperation({
              id: `op-5k-${i}`,
              payload: { task: { id: TASK_ID, changes: { title: `Update ${i}` } } },
            }),
          );
        }

        const start5k = performance.now();
        reducer(state5k, bulkApplyHydrationOperations({ operations: ops5k }));
        const time5k = performance.now() - start5k;

        // Reset mock
        mockReducer.calls.reset();

        // Measure 20k ops
        const state20k = createMockState();
        const ops20k: Operation[] = [];
        for (let i = 0; i < 20000; i++) {
          ops20k.push(
            createMockOperation({
              id: `op-20k-${i}`,
              payload: { task: { id: TASK_ID, changes: { title: `Update ${i}` } } },
            }),
          );
        }

        const start20k = performance.now();
        reducer(state20k, bulkApplyHydrationOperations({ operations: ops20k }));
        const time20k = performance.now() - start20k;

        console.log(
          `[PERF TEST] 5k ops: ${time5k.toFixed(2)}ms, 20k ops: ${time20k.toFixed(2)}ms, ratio: ${(time20k / time5k).toFixed(2)}x`,
        );

        // 20k should be roughly 4x 5k (linear scaling)
        // We allow up to 20x to account for overhead, cache effects, and CI variability
        // macOS CI has shown ratios up to ~15.5x, so we need a generous threshold
        const ratio = time20k / time5k;
        expect(ratio).toBeLessThan(20);
      },
    );
  });

  describe('undefined state handling', () => {
    it('should handle undefined state for bulk action', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const operation = createMockOperation();
      const action = bulkApplyHydrationOperations({ operations: [operation] });

      // Should not throw
      expect(() => reducer(undefined, action)).not.toThrow();
      expect(mockReducer).toHaveBeenCalled();
    });

    it('should handle undefined state for non-bulk action', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const action = { type: '[Task] Some Action' };

      reducer(undefined, action);

      expect(mockReducer).toHaveBeenCalledWith(undefined, action);
    });
  });

  describe('action type preservation', () => {
    it('should preserve operation action types through conversion', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();
      const operations = [
        createMockOperation({
          id: 'op-1',
          actionType: '[Task] Update Task' as ActionType,
        }),
        createMockOperation({
          id: 'op-2',
          actionType: '[Task] Delete Task' as ActionType,
          opType: OpType.Delete,
        }),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      expect(reducerCalls[0].action.type).toBe('[Task] Update Task');
      expect(reducerCalls[1].action.type).toBe('[Task] Delete Task');
    });
  });

  describe('error scenarios', () => {
    it('should propagate errors from reducer', () => {
      const errorReducer = jasmine
        .createSpy('errorReducer')
        .and.throwError('Reducer error');
      const reducer = bulkHydrationMetaReducer(errorReducer);
      const state = createMockState();
      const operation = createMockOperation();
      const action = bulkApplyHydrationOperations({ operations: [operation] });

      expect(() => reducer(state, action)).toThrowError('Reducer error');
    });

    it('should stop processing on first error', () => {
      let callCount = 0;
      const errorReducer = jasmine.createSpy('errorReducer').and.callFake(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Second operation failed');
        }
        return createMockState();
      });
      const reducer = bulkHydrationMetaReducer(errorReducer);
      const state = createMockState();
      const operations = [
        createMockOperation({ id: 'op-1' }),
        createMockOperation({ id: 'op-2' }),
        createMockOperation({ id: 'op-3' }),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      expect(() => reducer(state, action)).toThrowError('Second operation failed');
      // Should have called reducer twice (second call threw)
      expect(callCount).toBe(2);
    });
  });

  // =========================================================================
  // Archive + LWW Update same-batch filtering (Bug B defense-in-depth)
  // =========================================================================
  describe('archive + LWW Update same-batch filtering', () => {
    const createMoveToArchiveOp = (entityIds: string[]): Operation =>
      createMockOperation({
        id: `archive-op-${entityIds.join('-')}`,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: entityIds[0],
        entityIds,
        payload: {
          actionPayload: {
            tasks: entityIds.map((id) => ({ id, title: `Task ${id}` })),
          },
          entityChanges: [],
        },
      });

    const createLwwUpdateOp = (entityId: string): Operation =>
      createMockOperation({
        id: `lww-update-${entityId}`,
        actionType: `[TASK] LWW Update` as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId,
        payload: { id: entityId, title: 'LWW Updated Title' },
      });

    it('should skip LWW Update for entity archived in same batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const operations = [createMoveToArchiveOp([TASK_ID]), createLwwUpdateOp(TASK_ID)];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Only the archive op should be applied (1 call), LWW Update skipped
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    });

    it('should apply LWW Update for non-archived entity normally', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // Archive task-1, LWW Update targets task-2 (different entity)
      const operations = [createMoveToArchiveOp([TASK_ID]), createLwwUpdateOp(TASK_ID_2)];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Both ops should be applied
      expect(mockReducer).toHaveBeenCalledTimes(2);
    });

    it('should NOT skip moveToArchive op itself', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const operations = [createMoveToArchiveOp([TASK_ID])];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    });

    it('should apply non-LWW-Update ops for archived entities normally', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // Archive task-1, then a regular Update for task-1 (not LWW Update)
      const regularUpdate = createMockOperation({
        id: 'regular-update',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: TASK_ID,
        payload: { task: { id: TASK_ID, changes: { title: 'Regular Update' } } },
      });
      const operations = [createMoveToArchiveOp([TASK_ID]), regularUpdate];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Both ops should be applied — only LWW Update pattern is filtered
      expect(mockReducer).toHaveBeenCalledTimes(2);
    });

    it('should skip LWW Update even when it appears BEFORE moveToArchive in the batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // LWW Update comes first, moveToArchive comes second — pre-scan should still catch it
      const operations = [createLwwUpdateOp(TASK_ID), createMoveToArchiveOp([TASK_ID])];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Only the archive op should be applied (LWW Update skipped)
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    });

    it('should skip multiple LWW Updates when multi-entity archive is in same batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // Archive both task1 and task2, plus LWW Updates for each
      const operations = [
        createMoveToArchiveOp([TASK_ID, TASK_ID_2]),
        createLwwUpdateOp(TASK_ID),
        createLwwUpdateOp(TASK_ID_2),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Only the archive op should be applied, both LWW Updates skipped
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    });

    it('should skip LWW Update for entity deleted (not archived) in same batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const deleteOp = createMockOperation({
        id: 'delete-op',
        actionType: ActionType.TASK_SHARED_DELETE,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: TASK_ID,
        payload: {
          actionPayload: {
            task: { id: TASK_ID, tagIds: [], subTaskIds: [], subTasks: [] },
          },
          entityChanges: [],
        },
      });

      const operations = [deleteOp, createLwwUpdateOp(TASK_ID)];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Only the delete op should be applied, LWW Update skipped
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_DELETE);
    });

    it('should skip LWW Update for entity in deleteTasks (TASK_SHARED_DELETE_MULTIPLE) batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const deleteMultipleOp = createMockOperation({
        id: 'delete-multiple-op',
        actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: TASK_ID,
        entityIds: [TASK_ID, TASK_ID_2],
        payload: {
          actionPayload: { taskIds: [TASK_ID, TASK_ID_2] },
          entityChanges: [],
        },
      });

      const operations = [
        deleteMultipleOp,
        createLwwUpdateOp(TASK_ID),
        createLwwUpdateOp(TASK_ID_2),
      ];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Only the delete op should be applied, both LWW Updates skipped
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_DELETE_MULTIPLE);
    });

    it('should filter using entityId fallback when entityIds array is missing', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      // Archive op with only entityId, no entityIds — fallback should still filter
      const archiveOpEntityIdOnly = createMockOperation({
        id: 'archive-entityid-only',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: TASK_ID,
        payload: {
          actionPayload: { tasks: [{ id: TASK_ID, title: 'Task' }] },
          entityChanges: [],
        },
      });
      // Remove entityIds to test the fallback
      delete (archiveOpEntityIdOnly as any).entityIds;

      const operations = [archiveOpEntityIdOnly, createLwwUpdateOp(TASK_ID)];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // With entityId fallback, the LWW Update should be skipped
      expect(mockReducer).toHaveBeenCalledTimes(1);
      expect(reducerCalls[0].action.type).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    });
  });

  // =========================================================================
  // Issue #7330: TAG/PROJECT LWW Updates whose taskIds payload references
  // entities being archived/deleted in the SAME batch must have those task
  // IDs stripped before the action reaches lwwUpdateMetaReducer. The orphan
  // filter inside lwwUpdateMetaReducer only checks current taskState.ids, so
  // when a TAG LWW Update is processed before the TASK archive in the same
  // batch, the task is still present and not filtered — leaving TODAY_TAG
  // (or any tag) referencing a now-archived task.
  //
  // Reporter symptom: "archived/completed tasks reappear in today's view"
  // after wake from hibernate.
  // =========================================================================
  describe('TAG/PROJECT LWW Updates referencing same-batch archives (#7330)', () => {
    const TAG_LWW_TYPE = '[TAG] LWW Update';
    const PROJECT_LWW_TYPE = '[PROJECT] LWW Update';

    const createMoveToArchiveOp = (entityIds: string[]): Operation =>
      createMockOperation({
        id: `archive-op-${entityIds.join('-')}`,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: entityIds[0],
        entityIds,
        payload: {
          actionPayload: {
            tasks: entityIds.map((id) => ({ id, title: `Task ${id}` })),
          },
          entityChanges: [],
        },
      });

    it('strips archiving task IDs from a TAG LWW Update taskIds payload', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const tagLwwOp = createMockOperation({
        id: 'tag-lww',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, TASK_ID_2],
          color: '#000',
          icon: null,
        },
      });
      const archiveOp = createMoveToArchiveOp([TASK_ID]);

      const operations = [tagLwwOp, archiveOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      // Both ops should reach the inner reducer (TAG LWW Update is not
      // skipped — only TASK LWW Updates are skipped wholesale).
      expect(mockReducer).toHaveBeenCalledTimes(2);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      expect(tagAction).toBeDefined();
      // The archiving TASK_ID must be stripped; TASK_ID_2 stays.
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });

    it('strips archiving task IDs from a PROJECT LWW Update taskIds + backlogTaskIds', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const projectLwwOp = createMockOperation({
        id: 'project-lww',
        actionType: PROJECT_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'PROJECT',
        entityId: PROJECT_ID,
        payload: {
          id: PROJECT_ID,
          title: 'Inbox',
          taskIds: [TASK_ID, TASK_ID_2],
          backlogTaskIds: [TASK_ID, 'task3'],
        },
      });
      const archiveOp = createMoveToArchiveOp([TASK_ID]);

      const operations = [projectLwwOp, archiveOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const projectAction = reducerCalls.find((c) => c.action.type === PROJECT_LWW_TYPE)
        ?.action as { taskIds?: string[]; backlogTaskIds?: string[] } | undefined;
      expect(projectAction).toBeDefined();
      expect(projectAction!.taskIds).toEqual([TASK_ID_2]);
      expect(projectAction!.backlogTaskIds).toEqual(['task3']);
    });

    // Order independence is structural — the pre-scan loop builds the archive
    // Set before the apply loop runs. This test guards that invariant
    // explicitly: if a future refactor moved Set-collection into the apply
    // loop, this case would regress.
    it('also strips when the archive op precedes the TAG LWW Update in the batch', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const tagLwwOp = createMockOperation({
        id: 'tag-lww-after-archive',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, TASK_ID_2],
          color: '#000',
          icon: null,
        },
      });
      const archiveOp = createMoveToArchiveOp([TASK_ID]);

      const operations = [archiveOp, tagLwwOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });

    // moveToArchive only declares top-level task IDs in op.entityIds, but the
    // reducer cascades to subtasks via taskIdsToArchive = [t.id, ...t.subTasks.map(st => st.id)].
    // The pre-scan must harvest subtask IDs from the archive payload too.
    it('strips subtask IDs (cascade) referenced by a TAG LWW Update', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const SUB_TASK_ID = 'sub-task-1';
      const tagLwwOp = createMockOperation({
        id: 'tag-lww-with-subtask',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, SUB_TASK_ID, TASK_ID_2],
          color: '#000',
          icon: null,
        },
      });
      // Archive op carries the parent + its subTasks. entityIds is [parent]
      // only, but the reducer also archives the subTasks, so any LWW payload
      // referencing those subtasks must be cleaned.
      const archiveOpWithSubtasks: Operation = createMockOperation({
        id: 'archive-op-with-subs',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: {
          actionPayload: {
            tasks: [
              {
                id: TASK_ID,
                title: 'Parent',
                subTasks: [{ id: SUB_TASK_ID, title: 'Sub' }],
              },
            ],
          },
          entityChanges: [],
        },
      });

      const operations = [tagLwwOp, archiveOpWithSubtasks];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      // Both parent (TASK_ID) and subtask (SUB_TASK_ID) should be stripped.
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });

    // deleteTasks (DELETE_MULTIPLE) only carries flat taskIds in its payload.
    // The reducer cascades to subtasks via state lookup at apply time, so the
    // pre-scan must do the same — otherwise a co-batched TAG/PROJECT LWW
    // Update can retain subtask IDs deleted by the bulk delete.
    it('strips subtask IDs (cascade) when a deleteTasks op references parents with subtasks via state lookup', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const SUB_TASK_ID = 'sub-of-bulk-deleted';
      const state = {
        ...createMockState(),
        [TASK_FEATURE_NAME]: {
          ids: [TASK_ID, SUB_TASK_ID],
          entities: {
            [TASK_ID]: createMockTask({
              id: TASK_ID,
              subTaskIds: [SUB_TASK_ID],
            }),
            [SUB_TASK_ID]: createMockTask({
              id: SUB_TASK_ID,
              parentId: TASK_ID,
            }),
          },
          currentTaskId: null,
          selectedTaskId: null,
          taskDetailTargetPanel: null,
          isDataLoaded: true,
          lastCurrentTaskId: null,
        },
      } as Partial<RootState>;

      const tagLwwOp = createMockOperation({
        id: 'tag-lww-bulk-delete',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, SUB_TASK_ID, TASK_ID_2],
          color: '#000',
          icon: null,
        },
      });
      // deleteTasks payload only carries flat taskIds — no embedded subtask
      // info. The cascade must be derived from state.
      const deleteMultipleOp = createMockOperation({
        id: 'delete-multiple-bulk',
        actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: TASK_ID,
        entityIds: [TASK_ID],
        payload: {
          actionPayload: { taskIds: [TASK_ID] },
          entityChanges: [],
        },
      });

      const operations = [tagLwwOp, deleteMultipleOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      // Both parent (TASK_ID) and subtask (SUB_TASK_ID) must be stripped.
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });

    // The strip helper is the canonical cleanup point for taskIds — non-string
    // entries (type violations from a malformed remote payload) must not be
    // preserved verbatim into the consumer reducer.
    it('drops non-string ids from a TAG LWW Update taskIds payload', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const tagLwwOp = createMockOperation({
        id: 'tag-lww-malformed',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, 123, null, TASK_ID_2, undefined],
          color: '#000',
          icon: null,
        },
      });
      const archiveOp = createMoveToArchiveOp([TASK_ID]);

      const operations = [tagLwwOp, archiveOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      // Only the live TASK_ID_2 string remains; archived TASK_ID stripped,
      // non-string entries (123, null, undefined) dropped.
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });

    // deleteTask carries a single task with subTasks/subTaskIds. The reducer
    // cascades to subtasks, so subtask IDs must be stripped from co-batched
    // TAG/PROJECT LWW Update payloads.
    it('strips subtask IDs (cascade) when a deleteTask op carries subtasks', () => {
      const reducer = bulkHydrationMetaReducer(mockReducer);
      const state = createMockState();

      const SUB_TASK_ID = 'sub-of-deleted';
      const tagLwwOp = createMockOperation({
        id: 'tag-lww-delete-subtask',
        actionType: TAG_LWW_TYPE as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: TAG_ID,
        payload: {
          id: TAG_ID,
          title: 'Today',
          taskIds: [TASK_ID, SUB_TASK_ID, TASK_ID_2],
          color: '#000',
          icon: null,
        },
      });
      const deleteOp: Operation = createMockOperation({
        id: 'delete-op-with-subs',
        actionType: ActionType.TASK_SHARED_DELETE,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: TASK_ID,
        payload: {
          actionPayload: {
            task: {
              id: TASK_ID,
              title: 'Parent',
              subTasks: [{ id: SUB_TASK_ID, title: 'Sub' }],
              subTaskIds: [SUB_TASK_ID],
            },
          },
          entityChanges: [],
        },
      });

      const operations = [tagLwwOp, deleteOp];
      const action = bulkApplyHydrationOperations({ operations });

      reducer(state, action);

      const tagAction = reducerCalls.find((c) => c.action.type === TAG_LWW_TYPE)
        ?.action as { taskIds?: string[] } | undefined;
      expect(tagAction!.taskIds).toEqual([TASK_ID_2]);
    });
  });
});

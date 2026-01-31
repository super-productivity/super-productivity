/* eslint-disable @typescript-eslint/naming-convention */
import {
  operationCaptureMetaReducer,
  setOperationCaptureService,
  getOperationCaptureService,
  setIsApplyingRemoteOps,
  bufferDeferredAction,
  getDeferredActions,
  clearDeferredActions,
} from './operation-capture.meta-reducer';
import { OperationCaptureService } from './operation-capture.service';
import { Action } from '@ngrx/store';
import { PersistentAction } from '../core/persistent-action.interface';
import { EntityType, OpType } from '../core/operation.types';
import { RootState } from '../../root-store/root-state';

describe('operationCaptureMetaReducer', () => {
  let mockCaptureService: jasmine.SpyObj<OperationCaptureService>;
  let mockReducer: jasmine.Spy;

  const createMockAction = (
    overrides: Partial<PersistentAction> = {},
  ): PersistentAction => ({
    type: '[TaskShared] Update Task',
    meta: {
      isPersistent: true,
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      opType: OpType.Update,
    },
    task: { id: 'task-1', changes: { title: 'Updated' } },
    ...overrides,
  });

  const createNonPersistentAction = (): Action => ({
    type: '[Layout] Toggle Sidebar',
  });

  const mockState = {
    task: {
      ids: ['task-1'],
      entities: { 'task-1': { id: 'task-1', title: 'Test' } },
    },
  } as unknown as RootState;

  const mockModifiedState = {
    task: {
      ids: ['task-1'],
      entities: { 'task-1': { id: 'task-1', title: 'Updated' } },
    },
  } as unknown as RootState;

  beforeEach(() => {
    mockCaptureService = jasmine.createSpyObj('OperationCaptureService', [
      'enqueue',
      'dequeue',
      'getQueueSize',
      'clear',
    ]);

    mockReducer = jasmine.createSpy('reducer').and.returnValue(mockModifiedState);

    setOperationCaptureService(mockCaptureService);
    // Reset sync state and deferred buffer to prevent test pollution
    setIsApplyingRemoteOps(false);
    clearDeferredActions();
  });

  afterEach(() => {
    // Ensure sync state and deferred buffer are reset after each test
    setIsApplyingRemoteOps(false);
    clearDeferredActions();
  });

  describe('setOperationCaptureService', () => {
    it('should set the capture service instance', () => {
      const newCaptureService = jasmine.createSpyObj('OperationCaptureService', [
        'enqueue',
      ]);

      setOperationCaptureService(newCaptureService);

      expect(getOperationCaptureService()).toBe(newCaptureService);
    });
  });

  describe('getOperationCaptureService', () => {
    it('should return the current capture service instance', () => {
      expect(getOperationCaptureService()).toBe(mockCaptureService);
    });
  });

  describe('meta-reducer behavior', () => {
    it('should pass action to inner reducer', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      wrappedReducer(mockState, action);

      expect(mockReducer).toHaveBeenCalledWith(mockState, action);
    });

    it('should return result from inner reducer', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);

      const result = wrappedReducer(mockState, createMockAction());

      expect(result).toBe(mockModifiedState);
    });

    it('should enqueue action for persistent local actions', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      wrappedReducer(mockState, action);

      // Should call enqueue with just the action (no state params)
      expect(mockCaptureService.enqueue).toHaveBeenCalledWith(action);
    });

    it('should NOT process remote actions', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction({
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
          isRemote: true,
        },
      });

      wrappedReducer(mockState, action);

      expect(mockCaptureService.enqueue).not.toHaveBeenCalled();
    });

    it('should NOT process non-persistent actions', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createNonPersistentAction();

      wrappedReducer(mockState, action);

      expect(mockCaptureService.enqueue).not.toHaveBeenCalled();
    });

    it('should process even when state is undefined (initial state)', () => {
      // Since we no longer need state for diffing, we can enqueue for all persistent actions
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      wrappedReducer(undefined, action);

      expect(mockCaptureService.enqueue).toHaveBeenCalledWith(action);
    });

    it('should work without service (graceful degradation)', () => {
      setOperationCaptureService(null as any);
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      expect(() => wrappedReducer(mockState, action)).not.toThrow();
      expect(mockReducer).toHaveBeenCalledWith(mockState, action);
    });

    it('should handle errors in capture service gracefully', () => {
      mockCaptureService.enqueue.and.throwError('Test error');
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      // Should not throw - errors are caught and logged
      expect(() => wrappedReducer(mockState, action)).not.toThrow();
      // Should still return correct state
      expect(wrappedReducer(mockState, action)).toBe(mockModifiedState);
    });
  });

  describe('enqueue ordering', () => {
    it('should call reducer before enqueuing action', () => {
      const callOrder: string[] = [];

      mockReducer.and.callFake(() => {
        callOrder.push('reducer');
        return mockModifiedState;
      });

      mockCaptureService.enqueue.and.callFake(() => {
        callOrder.push('enqueue');
      });

      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      wrappedReducer(mockState, createMockAction());

      // Reducer should be called first, then enqueue
      expect(callOrder).toEqual(['reducer', 'enqueue']);
    });
  });

  describe('action type filtering', () => {
    it('should process various persistent action types', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const actionTypes = [
        '[TaskShared] Add Task',
        '[TaskShared] Delete Task',
        '[Tag] Update Tag',
        '[Project] Add Project',
        '[SimpleCounter] Update Simple Counter',
      ];

      actionTypes.forEach((type) => {
        mockCaptureService.enqueue.calls.reset();
        const action = createMockAction({ type });
        wrappedReducer(mockState, action);
        expect(mockCaptureService.enqueue).toHaveBeenCalled();
      });
    });
  });

  describe('deferred action buffer', () => {
    describe('bufferDeferredAction', () => {
      it('should add action to the buffer', () => {
        const action = createMockAction();

        bufferDeferredAction(action);

        const buffered = getDeferredActions();
        expect(buffered).toEqual([action]);
      });

      it('should preserve order when buffering multiple actions', () => {
        const action1 = createMockAction({ type: '[TaskShared] Add Task' });
        const action2 = createMockAction({ type: '[TaskShared] Update Task' });
        const action3 = createMockAction({ type: '[TaskShared] Delete Task' });

        bufferDeferredAction(action1);
        bufferDeferredAction(action2);
        bufferDeferredAction(action3);

        const buffered = getDeferredActions();
        expect(buffered).toEqual([action1, action2, action3]);
      });
    });

    describe('getDeferredActions', () => {
      it('should return empty array when buffer is empty', () => {
        const buffered = getDeferredActions();
        expect(buffered).toEqual([]);
      });

      it('should clear buffer after returning actions', () => {
        const action = createMockAction();
        bufferDeferredAction(action);

        const firstCall = getDeferredActions();
        const secondCall = getDeferredActions();

        expect(firstCall).toEqual([action]);
        expect(secondCall).toEqual([]);
      });
    });

    describe('clearDeferredActions', () => {
      it('should empty the buffer', () => {
        const action = createMockAction();
        bufferDeferredAction(action);

        clearDeferredActions();

        expect(getDeferredActions()).toEqual([]);
      });
    });
  });

  describe('sync buffering (user interaction during sync)', () => {
    /**
     * When remote operations are being applied (sync replay), user interactions
     * should be BUFFERED (not immediately captured) so they can be processed
     * after sync completes with fresh vector clocks.
     *
     * The problem being solved:
     * 1. User syncs after 12 hours, many operations need to be applied
     * 2. User interacts with the app during sync (creates a task, clicks done, etc.)
     * 3. If captured immediately, these operations have superseded vector clocks
     * 4. When uploaded, these ops conflict with recently-downloaded remote ops
     *
     * The solution:
     * Buffer actions during sync and process them after sync completes.
     * This gives them fresh vector clocks that include the remote operations.
     */
    it('should BUFFER (not capture) local operations when applying remote operations', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      // Simulate sync in progress
      setIsApplyingRemoteOps(true);

      wrappedReducer(mockState, action);

      // Should NOT immediately capture - sync is in progress
      expect(mockCaptureService.enqueue).not.toHaveBeenCalled();

      // But action should be buffered for later processing
      const buffered = getDeferredActions();
      expect(buffered).toEqual([action]);
    });

    it('should buffer multiple actions during sync', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action1 = createMockAction({ type: '[TaskShared] Add Task' });
      const action2 = createMockAction({ type: '[TaskShared] Update Task' });

      setIsApplyingRemoteOps(true);

      wrappedReducer(mockState, action1);
      wrappedReducer(mockState, action2);

      expect(mockCaptureService.enqueue).not.toHaveBeenCalled();

      const buffered = getDeferredActions();
      expect(buffered).toEqual([action1, action2]);
    });

    it('should resume immediate capturing after sync completes', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const syncAction = createMockAction({ type: '[TaskShared] Add Task' });
      const normalAction = createMockAction({ type: '[TaskShared] Update Task' });

      // During sync - action is buffered
      setIsApplyingRemoteOps(true);
      wrappedReducer(mockState, syncAction);
      expect(mockCaptureService.enqueue).not.toHaveBeenCalled();

      // After sync - actions are captured immediately
      setIsApplyingRemoteOps(false);
      wrappedReducer(mockState, normalAction);
      expect(mockCaptureService.enqueue).toHaveBeenCalledWith(normalAction);

      // Verify the sync action was buffered
      const buffered = getDeferredActions();
      expect(buffered).toEqual([syncAction]);
    });

    it('should NOT buffer remote actions (they are already from sync)', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const remoteAction = createMockAction({
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
          isRemote: true,
        },
      });

      setIsApplyingRemoteOps(true);
      wrappedReducer(mockState, remoteAction);

      // Should not be buffered - remote actions are from sync, not user
      expect(getDeferredActions()).toEqual([]);
    });

    it('should still allow reducer to process state changes during sync', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      setIsApplyingRemoteOps(true);
      const result = wrappedReducer(mockState, action);

      // State should still be modified even though operation is buffered
      expect(mockReducer).toHaveBeenCalledWith(mockState, action);
      expect(result).toBe(mockModifiedState);
    });
  });
});

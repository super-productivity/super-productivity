/* eslint-disable @typescript-eslint/naming-convention */
import {
  operationCaptureMetaReducer,
  setOperationCaptureService,
  getOperationCaptureService,
  setIsApplyingRemoteOps,
  bufferDeferredAction,
  getDeferredActions,
  clearDeferredActions,
  DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD,
} from './operation-capture.meta-reducer';
import { OperationCaptureService } from './operation-capture.service';
import { Action } from '@ngrx/store';
import { PersistentAction } from '../core/persistent-action.interface';
import { EntityType, OpType } from '../core/operation.types';
import { RootState } from '../../root-store/root-state';
import {
  isReducerRejectedAction,
  reducerFailureGuardMetaReducer,
} from '../../root-store/meta/reducer-failure-guard.meta-reducer';

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
      'incrementPending',
      'decrementPending',
      'getPendingCount',
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
        'incrementPending',
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

    it('should capture action for persistent local actions', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      wrappedReducer(mockState, action);

      // Should increment the pending counter with just the action (no state params)
      expect(mockCaptureService.incrementPending).toHaveBeenCalledWith(action);
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

      expect(mockCaptureService.incrementPending).not.toHaveBeenCalled();
    });

    it('should NOT process non-persistent actions', () => {
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createNonPersistentAction();

      wrappedReducer(mockState, action);

      expect(mockCaptureService.incrementPending).not.toHaveBeenCalled();
    });

    it('should process even when state is undefined (initial state)', () => {
      // Since we no longer need state for diffing, we can enqueue for all persistent actions
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      wrappedReducer(undefined, action);

      expect(mockCaptureService.incrementPending).toHaveBeenCalledWith(action);
    });

    it('should work without service (graceful degradation)', () => {
      setOperationCaptureService(null as any);
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      expect(() => wrappedReducer(mockState, action)).not.toThrow();
      expect(mockReducer).toHaveBeenCalledWith(mockState, action);
    });

    it('should handle errors in capture service gracefully', () => {
      mockCaptureService.incrementPending.and.throwError('Test error');
      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      const action = createMockAction();

      // Should not throw - errors are caught and logged
      expect(() => wrappedReducer(mockState, action)).not.toThrow();
      // Should still return correct state
      expect(wrappedReducer(mockState, action)).toBe(mockModifiedState);
    });
  });

  describe('capture ordering', () => {
    it('should call reducer before capturing action', () => {
      const callOrder: string[] = [];

      mockReducer.and.callFake(() => {
        callOrder.push('reducer');
        return mockModifiedState;
      });

      mockCaptureService.incrementPending.and.callFake(() => {
        callOrder.push('capture');
      });

      const wrappedReducer = operationCaptureMetaReducer(mockReducer);
      wrappedReducer(mockState, createMockAction());

      // Reducer should be called first, then capture
      expect(callOrder).toEqual(['reducer', 'capture']);
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
        mockCaptureService.incrementPending.calls.reset();
        const action = createMockAction({ type });
        wrappedReducer(mockState, action);
        expect(mockCaptureService.incrementPending).toHaveBeenCalled();
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

      it('should return a non-destructive snapshot until actions are acknowledged', () => {
        const action = createMockAction();
        bufferDeferredAction(action);

        const firstCall = getDeferredActions();
        const secondCall = getDeferredActions();

        expect(firstCall).toEqual([action]);
        expect(secondCall).toEqual([action]);
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

    describe('buffer limits', () => {
      // devError shows a native alert + confirm (and throws if confirm returns
      // true), so force confirm to return false. src/test.ts installs a
      // PERMANENT global confirm spy (jasmine.createSpy, never auto-restored),
      // so reset its accumulated calls per test and restore the global
      // returnValue(true) default afterwards.
      const spyNativeDialogs = (): jasmine.Spy => {
        if (!jasmine.isSpy(window.alert)) {
          spyOn(window, 'alert');
        }
        const confirmSpy = jasmine.isSpy(window.confirm)
          ? (window.confirm as jasmine.Spy)
          : spyOn(window, 'confirm');
        confirmSpy.calls.reset();
        confirmSpy.and.returnValue(false);
        return confirmSpy;
      };

      afterEach(() => {
        if (jasmine.isSpy(window.confirm)) {
          (window.confirm as jasmine.Spy).and.returnValue(true);
        }
      });

      const createManyActions = (count: number): PersistentAction[] =>
        Array.from({ length: count }, (_, i) =>
          createMockAction({ type: `[Test] Action ${i}` }),
        );

      it('should preserve ALL actions in order past the reload-warning threshold', () => {
        spyNativeDialogs();
        const actions = createManyActions(DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD + 50);

        actions.forEach((a) => bufferDeferredAction(a));

        // Nothing may be dropped: each buffered action's state change was
        // already accepted into NgRx — dropping = permanent unsyncable divergence.
        expect(getDeferredActions()).toEqual(actions);
      });

      it('should fire devError at the reload-warning threshold without dropping', () => {
        const confirmSpy = spyNativeDialogs();
        const actions = createManyActions(DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD);
        const reloadWarningCalls = (): unknown[][] =>
          confirmSpy.calls
            .allArgs()
            .filter((args) => /consider reloading/.test(String(args[0])));

        actions.slice(0, -1).forEach((a) => bufferDeferredAction(a));
        expect(reloadWarningCalls().length).toBe(0);

        bufferDeferredAction(actions[actions.length - 1]);
        expect(reloadWarningCalls().length).toBe(1);

        expect(getDeferredActions()).toEqual(actions);
      });

      it('should fire the reload warning only once per stuck window (no per-action spam)', () => {
        const confirmSpy = spyNativeDialogs();
        const actions = createManyActions(
          DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD + 200,
        );
        const reloadWarningCalls = (): unknown[][] =>
          confirmSpy.calls
            .allArgs()
            .filter((args) => /consider reloading/.test(String(args[0])));

        actions.forEach((a) => bufferDeferredAction(a));

        // In dev builds devError opens a blocking dialog; firing it on every
        // buffered action past the threshold would freeze the session exactly
        // when sync is stuck.
        expect(reloadWarningCalls().length).toBe(1);
        expect(getDeferredActions()).toEqual(actions);
      });

      it('should warn again after the buffer drained and a new stuck window crosses the threshold', () => {
        const confirmSpy = spyNativeDialogs();
        const reloadWarningCalls = (): unknown[][] =>
          confirmSpy.calls
            .allArgs()
            .filter((args) => /consider reloading/.test(String(args[0])));

        createManyActions(DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD).forEach((a) =>
          bufferDeferredAction(a),
        );
        expect(reloadWarningCalls().length).toBe(1);

        clearDeferredActions();

        createManyActions(DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD).forEach((a) =>
          bufferDeferredAction(a),
        );
        expect(reloadWarningCalls().length).toBe(2);
      });

      // The developer confirms "Throw" on a buffer warning; the guard's own
      // devError prompt is then declined. The throw rejects the action and
      // keeps the pre-dispatch state, so buffering it would later upload an op
      // for a change NgRx never committed (#10195).
      [
        { warning: 'soft', alreadyBuffered: 10 },
        {
          warning: 'reload',
          alreadyBuffered: DEFERRED_ACTIONS_RELOAD_WARNING_THRESHOLD - 1,
        },
      ].forEach(({ warning, alreadyBuffered }) => {
        it(`should not buffer an action rejected via the ${warning}-warning throw`, () => {
          const confirmSpy = spyNativeDialogs();
          createManyActions(alreadyBuffered).forEach((a) => bufferDeferredAction(a));
          confirmSpy.and.returnValues(true, false);
          setIsApplyingRemoteOps(true);
          const guarded = reducerFailureGuardMetaReducer(
            operationCaptureMetaReducer(mockReducer),
          );
          const action = createMockAction();

          expect(guarded(mockState, action)).toBe(mockState);
          expect(isReducerRejectedAction(action)).toBe(true);
          expect(getDeferredActions().length).toBe(alreadyBuffered);
        });
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
      expect(mockCaptureService.incrementPending).not.toHaveBeenCalled();

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

      expect(mockCaptureService.incrementPending).not.toHaveBeenCalled();

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
      expect(mockCaptureService.incrementPending).not.toHaveBeenCalled();

      // After sync - actions are captured immediately
      setIsApplyingRemoteOps(false);
      wrappedReducer(mockState, normalAction);
      expect(mockCaptureService.incrementPending).toHaveBeenCalledWith(normalAction);

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

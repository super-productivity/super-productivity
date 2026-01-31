import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationApplierService } from './operation-applier.service';
import { Operation, OpType, EntityType, ActionType } from '../core/operation.types';
import { ArchiveOperationHandler } from './archive-operation-handler.service';
import { HydrationStateService } from './hydration-state.service';
import { remoteArchiveDataApplied } from '../../features/archive/store/archive.actions';
import { bulkApplyOperations } from './bulk-hydration.action';
import { OperationLogEffects } from '../capture/operation-log.effects';

describe('OperationApplierService', () => {
  let service: OperationApplierService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockArchiveOperationHandler: jasmine.SpyObj<ArchiveOperationHandler>;
  let mockHydrationState: jasmine.SpyObj<HydrationStateService>;
  let mockOperationLogEffects: jasmine.SpyObj<OperationLogEffects>;

  const createMockOperation = (
    id: string,
    entityType: EntityType = 'TASK',
    opType: OpType = OpType.Update,
    payload: unknown = {},
    entityId?: string,
  ): Operation => ({
    id,
    // Cast: Using test placeholder action type
    actionType: '[Test] Action' as ActionType as ActionType,
    opType,
    entityType,
    entityId,
    payload,
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockArchiveOperationHandler = jasmine.createSpyObj('ArchiveOperationHandler', [
      'handleOperation',
    ]);
    mockHydrationState = jasmine.createSpyObj('HydrationStateService', [
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
      'startPostSyncCooldown',
    ]);
    mockOperationLogEffects = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);

    mockArchiveOperationHandler.handleOperation.and.returnValue(Promise.resolve());
    mockOperationLogEffects.processDeferredActions.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        OperationApplierService,
        { provide: Store, useValue: mockStore },
        { provide: ArchiveOperationHandler, useValue: mockArchiveOperationHandler },
        { provide: HydrationStateService, useValue: mockHydrationState },
        { provide: OperationLogEffects, useValue: mockOperationLogEffects },
      ],
    });

    service = TestBed.inject(OperationApplierService);
  });

  describe('applyOperations with bulk dispatch', () => {
    it('should dispatch bulkApplyOperations with single operation', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      const result = await service.applyOperations([op]);

      // One bulk dispatch (no remoteArchiveDataApplied since Update is not archive-affecting)
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);

      const dispatchedAction = mockStore.dispatch.calls.first().args[0] as unknown as {
        type: string;
        operations: Operation[];
      };
      expect(dispatchedAction.type).toBe(bulkApplyOperations.type);
      expect(dispatchedAction.operations).toEqual([op]);

      expect(result.appliedOps).toEqual([op]);
      expect(result.failedOp).toBeUndefined();
    });

    it('should dispatch bulkApplyOperations with multiple operations', async () => {
      const ops = [
        createMockOperation('op-1', 'TASK', OpType.Update, { title: 'First' }),
        createMockOperation('op-2', 'TASK', OpType.Update, { title: 'Second' }),
        createMockOperation('op-3', 'TASK', OpType.Update, { title: 'Third' }),
      ];

      const result = await service.applyOperations(ops);

      // One bulk dispatch (no remoteArchiveDataApplied since Updates are not archive-affecting)
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);

      const dispatchedAction = mockStore.dispatch.calls.first().args[0] as unknown as {
        type: string;
        operations: Operation[];
      };
      expect(dispatchedAction.type).toBe(bulkApplyOperations.type);
      expect(dispatchedAction.operations).toEqual(ops);
      expect(dispatchedAction.operations.length).toBe(3);

      expect(result.appliedOps).toEqual(ops);
      expect(result.failedOp).toBeUndefined();
    });

    it('should handle empty operations array', async () => {
      const result = await service.applyOperations([]);

      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(result.appliedOps).toEqual([]);
      expect(result.failedOp).toBeUndefined();
    });

    it('should process archive operations after bulk dispatch', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op]);

      // Archive handler is called after bulk dispatch
      expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle SYNC_IMPORT operations correctly', async () => {
      const archiveYoungData = { task: { ids: ['t1'], entities: {} } };
      const archiveOldData = { task: { ids: ['t2'], entities: {} } };

      const op: Operation = {
        id: 'sync-import-1',
        clientId: 'remoteClient',
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'sync-import-1',
        payload: {
          appDataComplete: {
            archiveYoung: archiveYoungData,
            archiveOld: archiveOldData,
          },
        },
        vectorClock: { remoteClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.applyOperations([op]);

      // Verify bulk dispatch contains the operation
      const bulkAction = mockStore.dispatch.calls.first().args[0] as unknown as {
        type: string;
        operations: Operation[];
      };
      expect(bulkAction.type).toBe(bulkApplyOperations.type);
      expect(bulkAction.operations[0].id).toBe('sync-import-1');

      // Verify archiveOperationHandler was called
      expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(1);
      const handlerAction = mockArchiveOperationHandler.handleOperation.calls.first()
        .args[0] as any;
      expect(handlerAction.type).toBe('[SP_ALL] Load(import) all data');
      expect(handlerAction.meta.isRemote).toBe(true);
    });
  });

  describe('error paths', () => {
    it('should return failed op when archiveOperationHandler throws', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });
      const archiveError = new Error('Archive write failed');

      mockArchiveOperationHandler.handleOperation.and.rejectWith(archiveError);

      const result = await service.applyOperations([op]);

      // Bulk dispatch succeeded, archive handling failed
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
      expect(result.appliedOps).toEqual([]);
      expect(result.failedOp).toBeDefined();
      expect(result.failedOp!.op).toBe(op);
      expect(result.failedOp!.error).toBe(archiveError);
    });
  });

  describe('hydration state tracking', () => {
    it('should call startApplyingRemoteOps at start', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op]);

      expect(mockHydrationState.startApplyingRemoteOps).toHaveBeenCalledTimes(1);
      expect(mockHydrationState.endApplyingRemoteOps).toHaveBeenCalledTimes(1);
    });

    it('should call endApplyingRemoteOps even on error', async () => {
      const op = createMockOperation('op-1');
      const testError = new Error('Test failure');

      mockArchiveOperationHandler.handleOperation.and.rejectWith(testError);

      await service.applyOperations([op]);

      expect(mockHydrationState.startApplyingRemoteOps).toHaveBeenCalledTimes(1);
      expect(mockHydrationState.endApplyingRemoteOps).toHaveBeenCalledTimes(1);
    });

    it('should call hydration state methods correctly for multiple ops', async () => {
      const ops = [
        createMockOperation('op-1'),
        createMockOperation('op-2'),
        createMockOperation('op-3'),
      ];

      await service.applyOperations(ops);

      expect(mockHydrationState.startApplyingRemoteOps).toHaveBeenCalledTimes(1);
      expect(mockHydrationState.endApplyingRemoteOps).toHaveBeenCalledTimes(1);
      // Single bulk dispatch
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLocalHydration option', () => {
    it('should skip archiveOperationHandler when isLocalHydration is true', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      await service.applyOperations([op], { isLocalHydration: true });

      expect(mockArchiveOperationHandler.handleOperation).not.toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should call archiveOperationHandler when isLocalHydration is false', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      await service.applyOperations([op], { isLocalHydration: false });

      expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(1);
    });

    it('should not start post-sync cooldown when isLocalHydration is true', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op], { isLocalHydration: true });

      expect(mockHydrationState.startPostSyncCooldown).not.toHaveBeenCalled();
    });

    it('should start post-sync cooldown when isLocalHydration is false', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op], { isLocalHydration: false });

      expect(mockHydrationState.startPostSyncCooldown).toHaveBeenCalledTimes(1);
    });
  });

  describe('archive reload trigger', () => {
    it('should dispatch remoteArchiveDataApplied for archive-affecting operations', async () => {
      // moveToArchive is an archive-affecting action
      const op: Operation = {
        id: 'op-1',
        clientId: 'testClient',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { tasks: [] },
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.applyOperations([op]);

      // Bulk dispatch + remoteArchiveDataApplied
      expect(mockStore.dispatch).toHaveBeenCalledTimes(2);
      const dispatchCalls = mockStore.dispatch.calls.allArgs();
      const archiveDataAppliedCalls = dispatchCalls.filter(
        (args) =>
          (args[0] as unknown as { type: string }).type === remoteArchiveDataApplied.type,
      );
      expect(archiveDataAppliedCalls.length).toBe(1);
    });

    it('should not dispatch remoteArchiveDataApplied for non-archive-affecting operations', async () => {
      // A regular task update is not archive-affecting
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      await service.applyOperations([op]);

      const dispatchCalls = mockStore.dispatch.calls.allArgs();
      const archiveDataAppliedCalls = dispatchCalls.filter(
        (args) =>
          (args[0] as unknown as { type: string }).type === remoteArchiveDataApplied.type,
      );
      expect(archiveDataAppliedCalls.length).toBe(0);
    });

    it('should not dispatch remoteArchiveDataApplied when isLocalHydration is true', async () => {
      // Even for archive-affecting operations, skip during local hydration
      const op: Operation = {
        id: 'op-1',
        clientId: 'testClient',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { tasks: [] },
        vectorClock: { testClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.applyOperations([op], { isLocalHydration: true });

      const dispatchCalls = mockStore.dispatch.calls.allArgs();
      const archiveDataAppliedCalls = dispatchCalls.filter(
        (args) =>
          (args[0] as unknown as { type: string }).type === remoteArchiveDataApplied.type,
      );
      expect(archiveDataAppliedCalls.length).toBe(0);
    });

    it('should dispatch remoteArchiveDataApplied once for batch with archive-affecting ops', async () => {
      const ops: Operation[] = [
        createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' }),
        {
          id: 'op-2',
          clientId: 'testClient',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { tasks: [] },
          vectorClock: { testClient: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        createMockOperation('op-3', 'TASK', OpType.Update, { title: 'Test2' }),
      ];

      await service.applyOperations(ops);

      // Only dispatched once at the end, not per operation
      const dispatchCalls = mockStore.dispatch.calls.allArgs();
      const archiveDataAppliedCalls = dispatchCalls.filter(
        (args) =>
          (args[0] as unknown as { type: string }).type === remoteArchiveDataApplied.type,
      );
      expect(archiveDataAppliedCalls.length).toBe(1);
    });
  });

  describe('event loop yield after dispatch', () => {
    it('should yield to event loop after bulk dispatch', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      let setTimeoutCalledWithZero = false;
      const originalSetTimeout = window.setTimeout.bind(window);
      spyOn(window, 'setTimeout').and.callFake(((fn: () => void, ms?: number) => {
        if (ms === 0) setTimeoutCalledWithZero = true;
        return originalSetTimeout(fn, ms);
      }) as typeof window.setTimeout);

      await service.applyOperations([op]);

      expect(setTimeoutCalledWithZero).toBe(true);
    });

    it('should not yield to event loop when no operations are applied', async () => {
      let setTimeoutCalledWithZero = false;
      spyOn(window, 'setTimeout').and.callFake(((fn: () => void, ms?: number) => {
        if (ms === 0) setTimeoutCalledWithZero = true;
        return 0;
      }) as typeof window.setTimeout);

      await service.applyOperations([]);

      expect(setTimeoutCalledWithZero).toBe(false);
    });

    it('should yield to event loop even with isLocalHydration true', async () => {
      const op = createMockOperation('op-1', 'TASK', OpType.Update, { title: 'Test' });

      let setTimeoutCalledWithZero = false;
      const originalSetTimeout = window.setTimeout.bind(window);
      spyOn(window, 'setTimeout').and.callFake(((fn: () => void, ms?: number) => {
        if (ms === 0) setTimeoutCalledWithZero = true;
        return originalSetTimeout(fn, ms);
      }) as typeof window.setTimeout);

      await service.applyOperations([op], { isLocalHydration: true });

      expect(setTimeoutCalledWithZero).toBe(true);
    });
  });

  describe('partial archive failure', () => {
    it('should return partial success when archive fails midway through batch', async () => {
      const ops = [
        createMockOperation('op-1', 'TASK', OpType.Update, { title: 'First' }),
        createMockOperation('op-2', 'TASK', OpType.Update, { title: 'Second' }),
        createMockOperation('op-3', 'TASK', OpType.Update, { title: 'Third' }),
        createMockOperation('op-4', 'TASK', OpType.Update, { title: 'Fourth' }),
        createMockOperation('op-5', 'TASK', OpType.Update, { title: 'Fifth' }),
      ];

      const archiveError = new Error('Archive write failed on op-3');
      let callCount = 0;
      mockArchiveOperationHandler.handleOperation.and.callFake(() => {
        callCount++;
        if (callCount === 3) {
          return Promise.reject(archiveError);
        }
        return Promise.resolve();
      });

      const result = await service.applyOperations(ops);

      // Bulk dispatch succeeded (all ops applied to NgRx state)
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);

      // But archive handling failed on op-3
      expect(result.appliedOps.length).toBe(2); // op-1 and op-2 succeeded
      expect(result.failedOp).toBeDefined();
      expect(result.failedOp!.op.id).toBe('op-3');
      expect(result.failedOp!.error).toBe(archiveError);

      // Archive handler was called 3 times (op-1, op-2, op-3)
      expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('effects isolation (key architectural benefit)', () => {
    it('should only dispatch bulkApplyOperations, not individual action types', async () => {
      const ops = [
        createMockOperation('op-1', 'TASK', OpType.Update, { title: 'First' }),
        createMockOperation('op-2', 'TASK', OpType.Update, { title: 'Second' }),
      ];

      await service.applyOperations(ops);

      // Only ONE dispatch call with bulkApplyOperations
      expect(mockStore.dispatch).toHaveBeenCalledTimes(1);

      const dispatchedAction = mockStore.dispatch.calls.first().args[0] as unknown as {
        type: string;
      };

      // The dispatched action is bulkApplyOperations, NOT individual [Test] Action
      expect(dispatchedAction.type).toBe(bulkApplyOperations.type);
      expect(dispatchedAction.type).not.toBe('[Test] Action');

      // This means effects listening for '[Test] Action' will NOT fire
      // Only effects listening for '[OperationLog] Bulk Apply Operations' would fire
      // (and no effect should listen for that)
    });

    it('should dispatch all operations in single bulk action', async () => {
      const ops = [
        createMockOperation('op-1', 'TASK', OpType.Update, { title: 'A' }),
        createMockOperation('op-2', 'PROJECT', OpType.Create, { name: 'B' }),
        createMockOperation('op-3', 'TAG', OpType.Delete, {}),
      ];

      await service.applyOperations(ops);

      const dispatchedAction = mockStore.dispatch.calls.first().args[0] as unknown as {
        type: string;
        operations: Operation[];
      };

      // All 3 operations bundled in single dispatch
      expect(dispatchedAction.operations.length).toBe(3);
      expect(dispatchedAction.operations[0].entityType).toBe('TASK');
      expect(dispatchedAction.operations[1].entityType).toBe('PROJECT');
      expect(dispatchedAction.operations[2].entityType).toBe('TAG');
    });
  });

  describe('multiple archive-affecting operations', () => {
    it('should handle multiple archive-affecting ops and dispatch remoteArchiveDataApplied once', async () => {
      const ops: Operation[] = [
        {
          id: 'op-1',
          clientId: 'testClient',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { tasks: [] },
          vectorClock: { testClient: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        createMockOperation('op-2', 'TASK', OpType.Update, { title: 'Non-archive' }),
        {
          id: 'op-3',
          clientId: 'testClient',
          actionType: ActionType.TASK_SHARED_RESTORE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-2',
          payload: { task: {}, subTasks: [] },
          vectorClock: { testClient: 2 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      await service.applyOperations(ops);

      // Bulk dispatch + ONE remoteArchiveDataApplied (not two)
      expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

      const dispatchCalls = mockStore.dispatch.calls.allArgs();
      const archiveDataAppliedCalls = dispatchCalls.filter(
        (args) =>
          (args[0] as unknown as { type: string }).type === remoteArchiveDataApplied.type,
      );
      expect(archiveDataAppliedCalls.length).toBe(1);

      // Archive handler called for all 3 ops
      expect(mockArchiveOperationHandler.handleOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('deferred actions processing', () => {
    /**
     * When users interact with the app during sync (creating tasks, etc.),
     * those actions are buffered by the meta-reducer. After sync completes,
     * we need to process those buffered actions so they get persisted with
     * fresh vector clocks.
     */
    it('should call processDeferredActions after sync completes', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op]);

      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalledTimes(1);
    });

    it('should call processDeferredActions after endApplyingRemoteOps', async () => {
      const callOrder: string[] = [];

      mockHydrationState.endApplyingRemoteOps.and.callFake(() => {
        callOrder.push('endApplyingRemoteOps');
      });

      mockOperationLogEffects.processDeferredActions.and.callFake(() => {
        callOrder.push('processDeferredActions');
        return Promise.resolve();
      });

      const op = createMockOperation('op-1');
      await service.applyOperations([op]);

      expect(callOrder).toEqual(['endApplyingRemoteOps', 'processDeferredActions']);
    });

    it('should call startPostSyncCooldown before endApplyingRemoteOps to close timing gap', async () => {
      const callOrder: string[] = [];

      mockHydrationState.startPostSyncCooldown.and.callFake(() => {
        callOrder.push('startPostSyncCooldown');
      });

      mockHydrationState.endApplyingRemoteOps.and.callFake(() => {
        callOrder.push('endApplyingRemoteOps');
      });

      mockOperationLogEffects.processDeferredActions.and.callFake(() => {
        callOrder.push('processDeferredActions');
        return Promise.resolve();
      });

      const op = createMockOperation('op-1');
      await service.applyOperations([op]);

      // Cooldown starts BEFORE ending remote ops to prevent the timing gap
      // where isInSyncWindow() returns false and selector-based effects can fire.
      expect(callOrder).toEqual([
        'startPostSyncCooldown',
        'endApplyingRemoteOps',
        'processDeferredActions',
      ]);
    });

    it('should call processDeferredActions even when archive handling fails', async () => {
      const op = createMockOperation('op-1');
      const archiveError = new Error('Archive write failed');

      mockArchiveOperationHandler.handleOperation.and.rejectWith(archiveError);

      await service.applyOperations([op]);

      // Even though archive failed, deferred actions should still be processed
      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalledTimes(1);
    });

    it('should call processDeferredActions for local hydration', async () => {
      const op = createMockOperation('op-1');

      await service.applyOperations([op], { isLocalHydration: true });

      // Even for local hydration, deferred actions should be processed
      // (though there usually won't be any during startup)
      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalledTimes(1);
    });

    it('should not call processDeferredActions when no operations are applied', async () => {
      await service.applyOperations([]);

      // No operations means we don't enter the try block at all
      expect(mockOperationLogEffects.processDeferredActions).not.toHaveBeenCalled();
    });
  });
});

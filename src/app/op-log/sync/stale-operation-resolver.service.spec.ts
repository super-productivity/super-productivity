import { TestBed } from '@angular/core/testing';
import { StaleOperationResolverService } from './stale-operation-resolver.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { LockService } from './lock.service';
import { SnackService } from '../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { ActionType, Operation, OpType, EntityType } from '../core/operation.types';
import { VectorClock } from '../../core/util/vector-clock';

describe('StaleOperationResolverService', () => {
  let service: StaleOperationResolverService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockConflictResolutionService: jasmine.SpyObj<ConflictResolutionService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };

  const TEST_CLIENT_ID = 'test-client-123';

  const createMockOperation = (
    id: string,
    entityType: EntityType,
    entityId: string | undefined,
    vectorClock: VectorClock,
    timestamp: number = Date.now(),
  ): Operation => ({
    id,
    actionType: `[${entityType}] Update Task` as ActionType,
    opType: OpType.Update,
    entityType,
    entityId,
    payload: { someData: 'test' },
    clientId: 'original-client',
    vectorClock,
    timestamp,
    schemaVersion: 1,
  });

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'markRejected',
      'appendWithVectorClockUpdate',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockConflictResolutionService = jasmine.createSpyObj('ConflictResolutionService', [
      'getCurrentEntityState',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve(TEST_CLIENT_ID)),
    };

    // Default mocks
    mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
    mockOpLogStore.markRejected.and.returnValue(Promise.resolve());
    mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(Promise.resolve(1));
    // Mock lock service to execute the callback immediately
    mockLockService.request.and.callFake(
      (_lockName: string, callback: () => Promise<any>) => callback(),
    );

    TestBed.configureTestingModule({
      providers: [
        StaleOperationResolverService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: ConflictResolutionService, useValue: mockConflictResolutionService },
        { provide: LockService, useValue: mockLockService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });

    service = TestBed.inject(StaleOperationResolverService);
  });

  describe('resolveStaleLocalOps', () => {
    it('should acquire sp_op_log lock before writing operations', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(mockLockService.request).toHaveBeenCalledTimes(1);
      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should execute all operations within the lock callback', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1', title: 'Test Task' };
      const callOrder: string[] = [];

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      // Track call order to verify operations happen inside lock
      mockLockService.request.and.callFake(
        async (_lockName: string, callback: () => Promise<any>) => {
          callOrder.push('lock-start');
          const result = await callback();
          callOrder.push('lock-end');
          return result;
        },
      );
      mockOpLogStore.markRejected.and.callFake(async () => {
        callOrder.push('markRejected');
      });
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(async () => {
        callOrder.push('appendWithVectorClockUpdate');
        return 1;
      });

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      // Verify write operations happen inside the lock
      expect(callOrder).toEqual([
        'lock-start',
        'markRejected',
        'appendWithVectorClockUpdate',
        'lock-end',
      ]);
    });

    it('should return 0 when staleOps array is empty', async () => {
      const result = await service.resolveStaleLocalOps([]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should return 0 when no client ID is available', async () => {
      mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const result = await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should skip ops without entityId and not create new ops for them', async () => {
      const staleOpWithoutEntityId = createMockOperation('op-1', 'TASK', undefined, {
        clientA: 1,
      });

      const result = await service.resolveStaleLocalOps([
        { opId: 'op-1', op: staleOpWithoutEntityId },
      ]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
    });

    it('should create LWW Update op for a single stale op', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 5 }, 1000);
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 3, clientB: 2 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      const result = await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(result).toBe(1);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      expect(appendedOp.actionType).toBe('[TASK] LWW Update');
      expect(appendedOp.opType).toBe(OpType.Update);
      expect(appendedOp.entityType).toBe('TASK');
      expect(appendedOp.entityId).toBe('task-1');
      expect(appendedOp.payload).toEqual(entityState);
      expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
      expect(appendedOp.timestamp).toBe(1000); // Preserved from original
    });

    it('should create single merged op for multiple stale ops on same entity', async () => {
      const staleOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 3 },
        1000,
      );
      const staleOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-1',
        { clientA: 4 },
        2000,
      );
      const staleOp3 = createMockOperation(
        'op-3',
        'TASK',
        'task-1',
        { clientA: 5 },
        1500,
      );
      const entityState = { id: 'task-1', title: 'Latest State' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientB: 10 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      const result = await service.resolveStaleLocalOps([
        { opId: 'op-1', op: staleOp1 },
        { opId: 'op-2', op: staleOp2 },
        { opId: 'op-3', op: staleOp3 },
      ]);

      expect(result).toBe(1); // Only ONE new op for all 3 stale ops
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Timestamp should be max of all stale ops (2000)
      expect(appendedOp.timestamp).toBe(2000);
    });

    it('should create separate ops for different entities', async () => {
      const staleOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 1 },
        1000,
      );
      const staleOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-2',
        { clientA: 2 },
        2000,
      );

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.callFake(
        (entityType: EntityType, entityId: string) => {
          return Promise.resolve({ id: entityId, title: `Entity ${entityId}` });
        },
      );

      const result = await service.resolveStaleLocalOps([
        { opId: 'op-1', op: staleOp1 },
        { opId: 'op-2', op: staleOp2 },
      ]);

      expect(result).toBe(2);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should mark ops as rejected but not create new op when entity not found', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'deleted-task', { clientA: 1 });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(undefined),
      );

      const result = await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
      // Should notify user that local changes were discarded
      expect(mockSnackService.open).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          translateParams: { count: 1 },
        }),
      );
    });

    it('should merge snapshot vector clock when provided', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const snapshotVectorClock: VectorClock = { clientX: 100, clientY: 50 };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 5 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps(
        [{ opId: 'op-1', op: staleOp }],
        undefined,
        snapshotVectorClock,
      );

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Clock should include entries from global clock, snapshot clock, stale op clock, and be incremented
      expect(appendedOp.vectorClock['clientX']).toBe(100);
      expect(appendedOp.vectorClock['clientY']).toBe(50);
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });

    it('should merge extra clocks from force download', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const extraClocks: VectorClock[] = [{ clientP: 20 }, { clientQ: 30, clientP: 25 }];

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }], extraClocks);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Should have max of all merged clocks
      expect(appendedOp.vectorClock['clientP']).toBe(25); // max(20, 25)
      expect(appendedOp.vectorClock['clientQ']).toBe(30);
    });

    it('should preserve maximum timestamp from stale ops (not use Date.now())', async () => {
      const oldTimestamp = 1609459200000; // 2021-01-01
      const staleOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 1 },
        oldTimestamp,
      );
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      expect(appendedOp.timestamp).toBe(oldTimestamp);
      // Verify it's NOT a recent timestamp
      expect(appendedOp.timestamp).toBeLessThan(Date.now() - 1000000);
    });

    it('should create vector clock that dominates global clock and stale op clocks', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', {
        clientA: 10,
        clientB: 5,
      });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 8, clientC: 15 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // New clock should be incremented and dominate all known clocks
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10); // max of 10 and 8
      expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1); // Incremented
    });

    it('should use LWW Update action type for created ops', async () => {
      const staleOp = createMockOperation('op-1', 'PROJECT', 'project-1', { clientA: 1 });
      const entityState = { id: 'project-1', title: 'My Project' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      expect(appendedOp.actionType).toBe('[PROJECT] LWW Update');
    });

    it('should show snack notification when ops are created', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          translateParams: { localWins: 1, remoteWins: 0 },
        }),
      );
    });

    it('should handle mixed scenario: some entities found, some not', async () => {
      const staleOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-exists',
        { clientA: 1 },
        1000,
      );
      const staleOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-deleted',
        { clientA: 2 },
        2000,
      );
      const staleOp3 = createMockOperation(
        'op-3',
        'TASK',
        'task-exists-2',
        { clientA: 3 },
        3000,
      );

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.callFake(
        (_entityType: EntityType, entityId: string) => {
          if (entityId === 'task-deleted') {
            return Promise.resolve(undefined);
          }
          return Promise.resolve({ id: entityId });
        },
      );

      const result = await service.resolveStaleLocalOps([
        { opId: 'op-1', op: staleOp1 },
        { opId: 'op-2', op: staleOp2 },
        { opId: 'op-3', op: staleOp3 },
      ]);

      expect(result).toBe(2); // Only 2 new ops (for existing entities)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']); // All 3 rejected
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should append ops with local source', async () => {
      const staleOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveStaleLocalOps([{ opId: 'op-1', op: staleOp }]);

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.any(Object),
        'local',
      );
    });

    it('should generate unique UUIDs for new ops', async () => {
      const staleOp1 = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const staleOp2 = createMockOperation('op-2', 'TASK', 'task-2', { clientA: 2 });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve({ id: 'test' }),
      );

      await service.resolveStaleLocalOps([
        { opId: 'op-1', op: staleOp1 },
        { opId: 'op-2', op: staleOp2 },
      ]);

      const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
      const op1 = calls[0].args[0] as Operation;
      const op2 = calls[1].args[0] as Operation;

      expect(op1.id).not.toBe(op2.id);
      expect(op1.id).not.toBe('op-1'); // New ID, not reusing original
      expect(op2.id).not.toBe('op-2');
    });
  });
});

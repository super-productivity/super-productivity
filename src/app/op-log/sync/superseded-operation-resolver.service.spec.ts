import { TestBed } from '@angular/core/testing';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { LockService } from './lock.service';
import { SnackService } from '../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { ActionType, Operation, OpType, EntityType } from '../core/operation.types';
import { VectorClock } from '../../core/util/vector-clock';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';

describe('SupersededOperationResolverService', () => {
  let service: SupersededOperationResolverService;
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
      'getProtectedClientIds',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockConflictResolutionService = jasmine.createSpyObj('ConflictResolutionService', [
      'getCurrentEntityState',
      'mergeAndIncrementClocks',
      'createLWWUpdateOp',
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
    mockOpLogStore.getProtectedClientIds.and.returnValue(Promise.resolve([]));
    // Mock lock service to execute the callback immediately
    mockLockService.request.and.callFake(
      (_lockName: string, callback: () => Promise<any>) => callback(),
    );
    // Mock merged clock methods - merged from LWWOperationFactory
    mockConflictResolutionService.mergeAndIncrementClocks.and.callFake(
      (clocks: VectorClock[], clientId: string) => {
        const merged: VectorClock = {};
        for (const clock of clocks) {
          for (const [k, v] of Object.entries(clock)) {
            merged[k] = Math.max(merged[k] || 0, v);
          }
        }
        merged[clientId] = (merged[clientId] || 0) + 1;
        return merged;
      },
    );
    mockConflictResolutionService.createLWWUpdateOp.and.callFake(
      (
        entityType: EntityType,
        entityId: string,
        entityState: unknown,
        clientId: string,
        vectorClock: VectorClock,
        timestamp: number,
      ) => ({
        id: 'generated-id-' + Math.random().toString(36).substring(7),
        actionType: `[${entityType}] LWW Update` as ActionType,
        opType: OpType.Update,
        entityType,
        entityId,
        payload: entityState,
        clientId,
        vectorClock,
        timestamp,
        schemaVersion: 1,
      }),
    );

    TestBed.configureTestingModule({
      providers: [
        SupersededOperationResolverService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: ConflictResolutionService, useValue: mockConflictResolutionService },
        { provide: LockService, useValue: mockLockService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });

    service = TestBed.inject(SupersededOperationResolverService);
  });

  describe('resolveSupersededLocalOps', () => {
    it('should acquire sp_op_log lock before writing operations', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      expect(mockLockService.request).toHaveBeenCalledTimes(1);
      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should execute all operations within the lock callback', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
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

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      // Verify write operations happen inside the lock
      expect(callOrder).toEqual([
        'lock-start',
        'markRejected',
        'appendWithVectorClockUpdate',
        'lock-end',
      ]);
    });

    it('should return 0 when supersededOps array is empty', async () => {
      const result = await service.resolveSupersededLocalOps([]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should return 0 when no client ID is available', async () => {
      mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should skip ops without entityId and not create new ops for them', async () => {
      const supersededOpWithoutEntityId = createMockOperation('op-1', 'TASK', undefined, {
        clientA: 1,
      });

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOpWithoutEntityId },
      ]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
    });

    it('should create LWW Update op for a single superseded op', async () => {
      const supersededOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 5 },
        1000,
      );
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 3, clientB: 2 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

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

    it('should create single merged op for multiple superseded ops on same entity', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 3 },
        1000,
      );
      const supersededOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-1',
        { clientA: 4 },
        2000,
      );
      const supersededOp3 = createMockOperation(
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

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
        { opId: 'op-3', op: supersededOp3 },
      ]);

      expect(result).toBe(1); // Only ONE new op for all 3 superseded ops
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Timestamp should be max of all superseded ops (2000)
      expect(appendedOp.timestamp).toBe(2000);
    });

    it('should create separate ops for different entities', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 1 },
        1000,
      );
      const supersededOp2 = createMockOperation(
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

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
      ]);

      expect(result).toBe(2);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2']);
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should mark ops as rejected but not create new op when entity not found', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'deleted-task', {
        clientA: 1,
      });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(undefined),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

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
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const snapshotVectorClock: VectorClock = { clientX: 100, clientY: 50 };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 5 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps(
        [{ opId: 'op-1', op: supersededOp }],
        undefined,
        snapshotVectorClock,
      );

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Clock should include entries from global clock, snapshot clock, superseded op clock, and be incremented
      expect(appendedOp.vectorClock['clientX']).toBe(100);
      expect(appendedOp.vectorClock['clientY']).toBe(50);
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });

    it('should merge extra clocks from force download', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const extraClocks: VectorClock[] = [{ clientP: 20 }, { clientQ: 30, clientP: 25 }];

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps(
        [{ opId: 'op-1', op: supersededOp }],
        extraClocks,
      );

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // Should have max of all merged clocks
      expect(appendedOp.vectorClock['clientP']).toBe(25); // max(20, 25)
      expect(appendedOp.vectorClock['clientQ']).toBe(30);
    });

    it('should preserve maximum timestamp from superseded ops (not use Date.now())', async () => {
      const oldTimestamp = 1609459200000; // 2021-01-01
      const supersededOp = createMockOperation(
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

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      expect(appendedOp.timestamp).toBe(oldTimestamp);
      // Verify it's NOT a recent timestamp
      expect(appendedOp.timestamp).toBeLessThan(Date.now() - 1000000);
    });

    it('should create vector clock that dominates global clock and superseded op clocks', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', {
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

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      // New clock should be incremented and dominate all known clocks
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10); // max of 10 and 8
      expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1); // Incremented
    });

    it('should use LWW Update action type for created ops', async () => {
      const supersededOp = createMockOperation('op-1', 'PROJECT', 'project-1', {
        clientA: 1,
      });
      const entityState = { id: 'project-1', title: 'My Project' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
        .args[0] as Operation;
      expect(appendedOp.actionType).toBe('[PROJECT] LWW Update');
    });

    it('should show snack notification when ops are created', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          translateParams: { localWins: 1, remoteWins: 0 },
        }),
      );
    });

    it('should handle mixed scenario: some entities found, some not', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-exists',
        { clientA: 1 },
        1000,
      );
      const supersededOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-deleted',
        { clientA: 2 },
        2000,
      );
      const supersededOp3 = createMockOperation(
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

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
        { opId: 'op-3', op: supersededOp3 },
      ]);

      expect(result).toBe(2); // Only 2 new ops (for existing entities)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']); // All 3 rejected
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should append ops with local source', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.any(Object),
        'local',
      );
    });

    it('should generate unique UUIDs for new ops', async () => {
      const supersededOp1 = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const supersededOp2 = createMockOperation('op-2', 'TASK', 'task-2', { clientA: 2 });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve({ id: 'test' }),
      );

      await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
      ]);

      const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
      const op1 = calls[0].args[0] as Operation;
      const op2 = calls[1].args[0] as Operation;

      expect(op1.id).not.toBe(op2.id);
      expect(op1.id).not.toBe('op-1'); // New ID, not reusing original
      expect(op2.id).not.toBe('op-2');
    });

    describe('moveToArchive operation handling', () => {
      const createMockMoveToArchiveOperation = (
        id: string,
        entityIds: string[],
        vectorClock: VectorClock,
        timestamp: number = Date.now(),
      ): Operation => ({
        id,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: entityIds[0],
        entityIds,
        payload: {
          actionPayload: {
            tasks: entityIds.map((eid) => ({ id: eid, title: `Task ${eid}` })),
          },
          entityChanges: [],
        },
        clientId: 'original-client',
        vectorClock,
        timestamp,
        schemaVersion: 1,
      });

      it('should re-create moveToArchive op instead of discarding it', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 3, clientB: 2 }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        expect(result).toBe(1);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-archive-1']);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
        expect(appendedOp.opType).toBe(OpType.Update);
        expect(appendedOp.entityType).toBe('TASK');
      });

      it('should preserve original payload exactly', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.payload).toEqual(archiveOp.payload);
      });

      it('should preserve entityId and entityIds in new operation', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2', 'task-3'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.entityId).toBe('task-1');
        expect(appendedOp.entityIds).toEqual(['task-1', 'task-2', 'task-3']);
      });

      it('should create merged vector clock that dominates global and original clocks', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 10, clientB: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 8, clientC: 15 }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10);
        expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
        expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
      });

      it('should preserve original timestamp', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 5 },
          1609459200000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.timestamp).toBe(1609459200000);
      });

      it('should NOT call getCurrentEntityState for moveToArchive ops', async () => {
        const archiveOp = createMockMoveToArchiveOperation('op-archive-1', ['task-1'], {
          clientA: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        expect(
          mockConflictResolutionService.getCurrentEntityState,
        ).not.toHaveBeenCalled();
      });

      it('should handle mixed batch: moveToArchive + regular ops', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );
        const regularOp = createMockOperation(
          'op-regular',
          'TASK',
          'task-3',
          { clientA: 3 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-3', title: 'Regular Task' }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive', op: archiveOp },
          { opId: 'op-regular', op: regularOp },
        ]);

        expect(result).toBe(2);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
          'op-archive',
          'op-regular',
        ]);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        const archiveResult = ops.find(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );
        const regularResult = ops.find(
          (op) => op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );

        expect(archiveResult).toBeDefined();
        expect(archiveResult!.entityIds).toEqual(['task-1', 'task-2']);
        expect(regularResult).toBeDefined();
        expect(regularResult!.entityId).toBe('task-3');
      });

      it('should use current clientId (not original) for re-created moveToArchive op', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 5 },
          1000,
        );
        // Original op has clientId='original-client' (from createMockMoveToArchiveOperation)
        // Current client is TEST_CLIENT_ID

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
        expect(appendedOp.clientId).not.toBe('original-client');
      });

      it('should merge snapshotVectorClock and extraClocks into moveToArchive vector clock', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { archive: 1 },
          1000,
        );
        const snapshotVectorClock: VectorClock = { snapshot: 5 };
        const extraClocks: VectorClock[] = [{ extra: 3 }];

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps(
          [{ opId: 'op-archive-1', op: archiveOp }],
          extraClocks,
          snapshotVectorClock,
        );

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        // Clock should include entries from snapshot, extra, archive op, and be incremented
        expect(appendedOp.vectorClock['snapshot']).toBe(5);
        expect(appendedOp.vectorClock['extra']).toBe(3);
        expect(appendedOp.vectorClock['archive']).toBeGreaterThanOrEqual(1);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
      });

      it('should use CURRENT_SCHEMA_VERSION for re-created op', async () => {
        const archiveOp = createMockMoveToArchiveOperation('op-archive-1', ['task-1'], {
          clientA: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      });

      it('should handle multiple moveToArchive ops in the same batch independently', async () => {
        const archiveOp1 = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 3 },
          1000,
        );
        const archiveOp2 = createMockMoveToArchiveOperation(
          'op-archive-2',
          ['task-2', 'task-3'],
          { clientA: 5 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp1 },
          { opId: 'op-archive-2', op: archiveOp2 },
        ]);

        expect(result).toBe(2);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
          'op-archive-1',
          'op-archive-2',
        ]);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        expect(ops[0].entityIds).toEqual(['task-1']);
        expect(ops[1].entityIds).toEqual(['task-2', 'task-3']);
        expect(ops[0].id).not.toBe(ops[1].id);
      });
    });

    describe('DELETE operation handling', () => {
      const createMockDeleteOperation = (
        id: string,
        entityType: EntityType,
        entityId: string,
        vectorClock: VectorClock,
        timestamp: number = Date.now(),
      ): Operation => ({
        id,
        actionType: `[${entityType}] Delete Task` as ActionType,
        opType: OpType.Delete,
        entityType,
        entityId,
        payload: { id: entityId, title: 'Deleted Task' }, // Entity data for potential undo
        clientId: 'original-client',
        vectorClock,
        timestamp,
        schemaVersion: 1,
      });

      it('should create replacement DELETE op for superseded DELETE operation', async () => {
        const supersededDeleteOp = createMockDeleteOperation(
          'op-1',
          'TASK',
          'task-1',
          {
            clientA: 5,
          },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 3, clientB: 2 }),
        );
        // Entity doesn't exist - it was deleted
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve(undefined),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        expect(result).toBe(1);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1']);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.opType).toBe(OpType.Delete);
        expect(appendedOp.actionType).toBe('[TASK] Delete Task');
        expect(appendedOp.entityType).toBe('TASK');
        expect(appendedOp.entityId).toBe('task-1');
        expect(appendedOp.payload).toEqual({ id: 'task-1', title: 'Deleted Task' });
        expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
        expect(appendedOp.timestamp).toBe(1000);
        // Should NOT call getCurrentEntityState for DELETE ops
        expect(
          mockConflictResolutionService.getCurrentEntityState,
        ).not.toHaveBeenCalled();
      });

      it('should create single replacement DELETE for multiple superseded DELETE ops on same entity', async () => {
        const supersededDeleteOp1 = createMockDeleteOperation(
          'op-1',
          'TASK',
          'task-1',
          { clientA: 3 },
          1000,
        );
        const supersededDeleteOp2 = createMockDeleteOperation(
          'op-2',
          'TASK',
          'task-1',
          { clientA: 4 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientB: 10 }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp1 },
          { opId: 'op-2', op: supersededDeleteOp2 },
        ]);

        expect(result).toBe(1); // Only ONE new op for both superseded DELETE ops
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2']);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.opType).toBe(OpType.Delete);
        // Timestamp should be max of all superseded ops (2000)
        expect(appendedOp.timestamp).toBe(2000);
      });

      it('should preserve actionType and payload from original DELETE op', async () => {
        const customPayload = {
          id: 'task-1',
          title: 'Important Task',
          notes: 'some notes',
        };
        const supersededDeleteOp: Operation = {
          id: 'op-1',
          actionType: '[TASK] Delete Task' as ActionType,
          opType: OpType.Delete,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: customPayload,
          clientId: 'original-client',
          vectorClock: { clientA: 1 },
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.actionType).toBe('[TASK] Delete Task');
        expect(appendedOp.payload).toEqual(customPayload);
      });

      it('should merge vector clocks properly for DELETE ops', async () => {
        const supersededDeleteOp = createMockDeleteOperation('op-1', 'TASK', 'task-1', {
          clientA: 10,
          clientB: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 8, clientC: 15 }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        // New clock should dominate all known clocks
        expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10);
        expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
        expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
      });

      it('should handle DELETE ops alongside UPDATE ops for different entities', async () => {
        const supersededDeleteOp = createMockDeleteOperation(
          'op-1',
          'TASK',
          'deleted-task',
          { clientA: 1 },
          1000,
        );
        const supersededUpdateOp = createMockOperation(
          'op-2',
          'TASK',
          'existing-task',
          { clientA: 2 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'existing-task', title: 'Existing' }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
          { opId: 'op-2', op: supersededUpdateOp },
        ]);

        expect(result).toBe(2); // One DELETE op + one UPDATE op
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1', 'op-2']);
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        const deleteOp = ops.find((op) => op.entityId === 'deleted-task');
        const updateOp = ops.find((op) => op.entityId === 'existing-task');

        expect(deleteOp?.opType).toBe(OpType.Delete);
        expect(updateOp?.opType).toBe(OpType.Update);
      });

      it('should show conflict resolution snack for DELETE ops', async () => {
        const supersededDeleteOp = createMockDeleteOperation('op-1', 'TASK', 'task-1', {
          clientA: 1,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            translateParams: { localWins: 1, remoteWins: 0 },
          }),
        );
      });
    });

    describe('vector clock pruning', () => {
      const createLargeClock = (
        prefix: string,
        count: number,
        valueStart: number = 1,
      ): VectorClock => {
        const clock: VectorClock = {};
        for (let i = 1; i <= count; i++) {
          clock[`${prefix}-${i}`] = valueStart + i - 1;
        }
        return clock;
      };

      it('should prune merged clock to MAX_VECTOR_CLOCK_SIZE for entity resolution ops', async () => {
        const globalClock = createLargeClock('global', 6, 1);
        const opClock = createLargeClock('op', 6, 10);
        const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', opClock, 1000);

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should prune merged clock to MAX_VECTOR_CLOCK_SIZE for moveToArchive ops', async () => {
        const globalClock = createLargeClock('global', 6, 1);
        const opClock = createLargeClock('op', 6, 10);

        const archiveOp: Operation = {
          id: 'op-archive',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          entityIds: ['task-1'],
          payload: {
            actionPayload: { tasks: [{ id: 'task-1' }] },
            entityChanges: [],
          },
          clientId: 'original-client',
          vectorClock: opClock,
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-archive', op: archiveOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should prune merged clock to MAX_VECTOR_CLOCK_SIZE for DELETE ops', async () => {
        const globalClock = createLargeClock('global', 6, 1);
        const opClock = createLargeClock('op', 6, 10);

        const deleteOp: Operation = {
          id: 'op-delete',
          actionType: '[TASK] Delete Task' as ActionType,
          opType: OpType.Delete,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { id: 'task-1' },
          clientId: 'original-client',
          vectorClock: opClock,
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-delete', op: deleteOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should always preserve current client ID during pruning', async () => {
        // Global clock has 10 high-value clients; TEST_CLIENT_ID will have the lowest counter
        const globalClock = createLargeClock('high', 10, 100);
        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { extra: 200 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should preserve protected client IDs during pruning', async () => {
        const protectedId = 'protected-sync-import-client';
        mockOpLogStore.getProtectedClientIds.and.returnValue(
          Promise.resolve([protectedId]),
        );

        // Protected client has the lowest counter, should still be preserved
        const globalClock: VectorClock = { [protectedId]: 1 };
        for (let i = 1; i <= 10; i++) {
          globalClock[`high-${i}`] = i * 100;
        }
        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { extra: 50 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock[protectedId]).toBeDefined();
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should preserve existingClock client IDs even when protectedClientIds fill MAX slots', async () => {
        // Simulate the sync loop scenario: 10 protected IDs from SYNC_IMPORT fill all slots,
        // but the server's existingClock has client ID "serverEntityClient" that must be preserved
        // to prevent the replacement op from being seen as CONCURRENT.
        const protectedIds = Array.from(
          { length: MAX_VECTOR_CLOCK_SIZE },
          (_, i) => `protected-${i}`,
        );
        mockOpLogStore.getProtectedClientIds.and.returnValue(
          Promise.resolve(protectedIds),
        );

        const globalClock: VectorClock = {};
        for (const id of protectedIds) {
          globalClock[id] = 5;
        }
        globalClock['serverEntityClient'] = 7; // Server entity clock entry

        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { [TEST_CLIENT_ID]: 1 },
          1000,
        );

        const existingClock: VectorClock = { serverEntityClient: 7, [TEST_CLIENT_ID]: 1 };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededOp, existingClock },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        // serverEntityClient MUST be preserved — without it the server sees CONCURRENT → rejection loop
        expect(appendedOp.vectorClock['serverEntityClient']).toBe(7);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should preserve existingClock client IDs for moveToArchive ops', async () => {
        const protectedIds = Array.from(
          { length: MAX_VECTOR_CLOCK_SIZE },
          (_, i) => `protected-${i}`,
        );
        mockOpLogStore.getProtectedClientIds.and.returnValue(
          Promise.resolve(protectedIds),
        );

        const globalClock: VectorClock = {};
        for (const id of protectedIds) {
          globalClock[id] = 5;
        }
        globalClock['serverEntityClient'] = 7;

        const archiveOp: Operation = {
          id: 'op-archive',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          entityIds: ['task-1'],
          payload: {
            actionPayload: { tasks: [{ id: 'task-1' }] },
            entityChanges: [],
          },
          clientId: 'original-client',
          vectorClock: { [TEST_CLIENT_ID]: 1 },
          timestamp: 1000,
          schemaVersion: 1,
        };

        const existingClock: VectorClock = { serverEntityClient: 7, [TEST_CLIENT_ID]: 1 };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive', op: archiveOp, existingClock },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockUpdate.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock['serverEntityClient']).toBe(7);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        expect(Object.keys(appendedOp.vectorClock).length).toBeLessThanOrEqual(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });
    });
  });
});

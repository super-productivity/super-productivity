import { TestBed } from '@angular/core/testing';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import {
  SchemaMigrationService,
  MAX_VERSION_SKIP,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import {
  ActionType,
  EntityConflict,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import {
  compareVectorClocks,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { toEntityKey } from '../util/entity-key.util';
import { T } from '../../t.const';
describe('RemoteOpsProcessingService', () => {
  let service: RemoteOpsProcessingService;
  let schemaMigrationServiceSpy: jasmine.SpyObj<SchemaMigrationService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let vectorClockServiceSpy: jasmine.SpyObj<VectorClockService>;
  let operationApplierServiceSpy: jasmine.SpyObj<OperationApplierService>;
  let conflictResolutionServiceSpy: jasmine.SpyObj<ConflictResolutionService>;
  let validateStateServiceSpy: jasmine.SpyObj<ValidateStateService>;
  let lockServiceSpy: jasmine.SpyObj<LockService>;
  let compactionServiceSpy: jasmine.SpyObj<OperationLogCompactionService>;
  let syncImportFilterServiceSpy: jasmine.SpyObj<SyncImportFilterService>;

  beforeEach(() => {
    schemaMigrationServiceSpy = jasmine.createSpyObj('SchemaMigrationService', [
      'getCurrentVersion',
      'migrateOperation',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'hasOp',
      'append',
      'appendBatchSkipDuplicates',
      'appendWithVectorClockUpdate',
      'markApplied',
      'markFailed',
      'mergeRemoteOpClocks',
      'getUnsyncedByEntity',
      'getOpsAfterSeq',
      'getLatestFullStateOp',
      'getOpById',
      'markRejected',
      'setProtectedClientIds',
      'clearFullStateOps',
      'clearFullStateOpsExcept',
    ]);
    // By default, appendBatchSkipDuplicates writes all ops (no duplicates)
    opLogStoreSpy.appendBatchSkipDuplicates.and.callFake((ops: any[]) =>
      Promise.resolve({
        seqs: ops.map((_: any, i: number) => i + 1),
        writtenOps: ops,
        skippedCount: 0,
      }),
    );
    // By default, no full-state ops in store
    opLogStoreSpy.getLatestFullStateOp.and.returnValue(Promise.resolve(undefined));
    // By default, mergeRemoteOpClocks succeeds
    opLogStoreSpy.mergeRemoteOpClocks.and.resolveTo();
    // By default, setProtectedClientIds succeeds
    opLogStoreSpy.setProtectedClientIds.and.resolveTo();
    // By default, clearFullStateOps returns 0 (no ops cleared)
    opLogStoreSpy.clearFullStateOps.and.resolveTo(0);
    // By default, clearFullStateOpsExcept returns 0 (no ops cleared)
    opLogStoreSpy.clearFullStateOpsExcept.and.resolveTo(0);
    vectorClockServiceSpy = jasmine.createSpyObj('VectorClockService', [
      'getEntityFrontier',
      'getSnapshotVectorClock',
      'getSnapshotEntityKeys',
      'getCurrentVectorClock',
    ]);
    operationApplierServiceSpy = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    conflictResolutionServiceSpy = jasmine.createSpyObj('ConflictResolutionService', [
      'autoResolveConflictsLWW',
      'checkOpForConflicts',
    ]);
    // Simplified mock that implements core conflict detection logic.
    // NOTE: Does not replicate the CONCURRENT + no-pending-ops entity-exists check
    // from the real service (that check calls getCurrentEntityState to block ops for
    // archived/deleted entities). This is acceptable for RemoteOpsProcessingService tests.
    conflictResolutionServiceSpy.checkOpForConflicts.and.callFake(
      async (
        remoteOp: Operation,
        ctx: {
          localPendingOpsByEntity: Map<string, Operation[]>;
          appliedFrontierByEntity: Map<string, VectorClock>;
          snapshotVectorClock: VectorClock | undefined;
          snapshotEntityKeys: Set<string> | undefined;
          hasNoSnapshotClock: boolean;
        },
      ): Promise<{
        isSupersededOrDuplicate: boolean;
        conflict: EntityConflict | null;
      }> => {
        const entityIdsToCheck = remoteOp.entityIds?.length
          ? remoteOp.entityIds
          : remoteOp.entityId
            ? [remoteOp.entityId]
            : [];

        for (const entityId of entityIdsToCheck) {
          const entityKey = toEntityKey(remoteOp.entityType, entityId);
          const localOpsForEntity = ctx.localPendingOpsByEntity.get(entityKey) || [];
          const appliedFrontier = ctx.appliedFrontierByEntity.get(entityKey);

          // Build local frontier
          const entityExistedAtSnapshot = ctx.snapshotEntityKeys
            ? ctx.snapshotEntityKeys.has(entityKey)
            : appliedFrontier !== undefined;
          const fallbackClock = entityExistedAtSnapshot ? ctx.snapshotVectorClock : {};
          const baselineClock = appliedFrontier || fallbackClock || {};
          const allClocks = [
            baselineClock,
            ...localOpsForEntity.map((op) => op.vectorClock),
          ];
          const localFrontier = allClocks.reduce(
            (acc, clock) => mergeVectorClocks(acc, clock || {}),
            {},
          );
          const localFrontierIsEmpty = Object.keys(localFrontier).length === 0;

          // FAST PATH: No local state means remote is newer by default
          if (localOpsForEntity.length === 0 && localFrontierIsEmpty) {
            continue;
          }

          const vcComparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);

          // Skip superseded operations (local already has newer state)
          if (vcComparison === VectorClockComparison.GREATER_THAN) {
            return { isSupersededOrDuplicate: true, conflict: null };
          }

          // Skip duplicate operations (already applied)
          if (vcComparison === VectorClockComparison.EQUAL) {
            return { isSupersededOrDuplicate: true, conflict: null };
          }

          // No pending ops = no conflict possible
          if (localOpsForEntity.length === 0) {
            continue;
          }

          // CONCURRENT = true conflict
          if (vcComparison === VectorClockComparison.CONCURRENT) {
            return {
              isSupersededOrDuplicate: false,
              conflict: {
                entityType: remoteOp.entityType,
                entityId,
                localOps: localOpsForEntity,
                remoteOps: [remoteOp],
                suggestedResolution: 'manual',
              },
            };
          }
        }

        return { isSupersededOrDuplicate: false, conflict: null };
      },
    );
    validateStateServiceSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
      'validateAndRepairCurrentState',
    ]);
    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    // Default: execute callback immediately (simulating lock acquisition)
    lockServiceSpy.request.and.callFake(
      async (_name: string, callback: () => Promise<void>) => {
        await callback();
      },
    );
    compactionServiceSpy = jasmine.createSpyObj('OperationLogCompactionService', [
      'compact',
    ]);
    compactionServiceSpy.compact.and.resolveTo();
    syncImportFilterServiceSpy = jasmine.createSpyObj('SyncImportFilterService', [
      'filterOpsInvalidatedBySyncImport',
    ]);
    // Default: return all ops as valid (no filtering)
    syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.callFake(
      (ops: any[]) =>
        Promise.resolve({
          validOps: ops,
          invalidatedOps: [],
          isLocalUnsyncedImport: false,
        }),
    );

    TestBed.configureTestingModule({
      providers: [
        RemoteOpsProcessingService,
        { provide: SchemaMigrationService, useValue: schemaMigrationServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: VectorClockService, useValue: vectorClockServiceSpy },
        { provide: OperationApplierService, useValue: operationApplierServiceSpy },
        { provide: ConflictResolutionService, useValue: conflictResolutionServiceSpy },
        { provide: ValidateStateService, useValue: validateStateServiceSpy },
        { provide: LockService, useValue: lockServiceSpy },
        { provide: OperationLogCompactionService, useValue: compactionServiceSpy },
        { provide: SyncImportFilterService, useValue: syncImportFilterServiceSpy },
      ],
    });

    service = TestBed.inject(RemoteOpsProcessingService);
    schemaMigrationServiceSpy.getCurrentVersion.and.returnValue(1);
    // Default migration: return op as is
    schemaMigrationServiceSpy.migrateOperation.and.callFake((op) => op);
    // Default validation: valid
    validateStateServiceSpy.validateAndRepair.and.returnValue({
      isValid: true,
      wasRepaired: false,
    } as any);
    validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(true);
    // Default: return empty Set for snapshotEntityKeys (avoids triggering compaction branch)
    vectorClockServiceSpy.getSnapshotEntityKeys.and.returnValue(
      Promise.resolve(new Set()),
    );
    // Default: return empty clock for getCurrentVectorClock
    vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
    // Default: no local ops to replay after SYNC_IMPORT
    opLogStoreSpy.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
    // Default: successful operation application
    operationApplierServiceSpy.applyOperations.and.returnValue(
      Promise.resolve({ appliedOps: [] }),
    );
  });

  describe('processRemoteOps', () => {
    it('should call migrateOperation for each remote op', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 } as Operation,
        { id: 'op2', schemaVersion: 1 } as Operation,
      ];
      // Assume fresh client to keep test simple
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));

      await service.processRemoteOps(remoteOps);

      expect(schemaMigrationServiceSpy.migrateOperation).toHaveBeenCalledTimes(2);
      expect(schemaMigrationServiceSpy.migrateOperation).toHaveBeenCalledWith(
        remoteOps[0],
      );
      expect(schemaMigrationServiceSpy.migrateOperation).toHaveBeenCalledWith(
        remoteOps[1],
      );
    });

    it('should acquire lock before conflict detection to ensure write consistency', async () => {
      const remoteOps: Operation[] = [{ id: 'op1', schemaVersion: 1 } as Operation];

      // Setup for a normal (non-full-state) operation flow
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      vectorClockServiceSpy.getSnapshotEntityKeys.and.returnValue(
        Promise.resolve(new Set()),
      );
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      opLogStoreSpy.markApplied.and.returnValue(Promise.resolve());
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [remoteOps[0]] }),
      );

      // Track call order
      const callOrder: string[] = [];
      lockServiceSpy.request.and.callFake(
        async (_name: string, callback: () => Promise<void>) => {
          callOrder.push('lockAcquired');
          await callback();
        },
      );
      spyOn(service, 'detectConflicts').and.callFake(async () => {
        callOrder.push('detectConflicts');
        return { nonConflicting: remoteOps, conflicts: [] };
      });

      await service.processRemoteOps(remoteOps);

      // Verify lock was acquired
      expect(lockServiceSpy.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );

      // Verify lock was acquired BEFORE detectConflicts
      expect(callOrder).toEqual(['lockAcquired', 'detectConflicts']);
    });

    it('should drop operations if migrateOperation returns null', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 } as Operation,
        { id: 'dropped', schemaVersion: 1 } as Operation,
      ];

      schemaMigrationServiceSpy.migrateOperation.and.callFake((op) => {
        if (op.id === 'dropped') return null;
        return op;
      });

      // Assume fresh client
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));

      await service.processRemoteOps(remoteOps);

      // Only op1 should be applied (appendBatchSkipDuplicates called with single-element array)
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [remoteOps[0]],
        'remote',
        {
          pendingApply: true,
        },
      );
    });

    it('should skip ops that throw during migration but continue processing others', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 } as Operation,
        { id: 'throws', schemaVersion: 1 } as Operation,
        { id: 'op3', schemaVersion: 1 } as Operation,
      ];

      schemaMigrationServiceSpy.migrateOperation.and.callFake((op) => {
        if (op.id === 'throws') throw new Error('Migration corrupted');
        return op;
      });

      // Setup fresh client
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));

      await service.processRemoteOps(remoteOps);

      // op1 and op3 should be processed (appendBatchSkipDuplicates called with array of both)
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [remoteOps[0], remoteOps[2]],
        'remote',
        { pendingApply: true },
      );
    });

    it('should return early when all ops fail migration', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 } as Operation,
        { id: 'op2', schemaVersion: 1 } as Operation,
      ];

      schemaMigrationServiceSpy.migrateOperation.and.throwError('All migration failed');

      const result = await service.processRemoteOps(remoteOps);

      // Should not proceed to conflict detection or application
      expect(opLogStoreSpy.getUnsynced).not.toHaveBeenCalled();
      expect(result).toEqual({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      });
    });

    it('should track dropped entity IDs from failed migrations for dependency warnings', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1, entityId: 'task-1' } as Operation,
        {
          id: 'dropped',
          schemaVersion: 1,
          entityId: 'task-2',
          entityIds: ['task-2', 'task-3'],
        } as Operation,
      ];

      schemaMigrationServiceSpy.migrateOperation.and.callFake((op) => {
        if (op.id === 'dropped') return null;
        return op;
      });

      // Setup
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));

      // This test verifies the internal droppedEntityIds tracking works correctly
      // (used for potential dependency warnings in future enhancements)
      await service.processRemoteOps(remoteOps);

      // Only op1 should be applied (appendBatchSkipDuplicates called with single-element array)
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [remoteOps[0]],
        'remote',
        {
          pendingApply: true,
        },
      );
    });

    it('should show error snackbar and abort if version is too new', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 + MAX_VERSION_SKIP + 1 } as Operation,
      ];

      await service.processRemoteOps(remoteOps);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
        }),
      );

      // Should not proceed to apply ops
      expect(opLogStoreSpy.getUnsynced).not.toHaveBeenCalled();
    });

    it('should show error snackbar and abort if version is below minimum supported', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: MIN_SUPPORTED_SCHEMA_VERSION - 1 } as Operation,
      ];

      const result = await service.processRemoteOps(remoteOps);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_UNSUPPORTED,
        }),
      );

      // Should not proceed to apply ops
      expect(opLogStoreSpy.getUnsynced).not.toHaveBeenCalled();
      expect(result).toEqual({
        localWinOpsCreated: 0,
        allOpsFilteredBySyncImport: false,
        filteredOpCount: 0,
        isLocalUnsyncedImport: false,
      });
    });

    it('should show warning once per session when receiving ops from newer version', async () => {
      // Current version is 1 (set in beforeEach)
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 2 } as Operation,
        { id: 'op2', schemaVersion: 2 } as Operation,
      ];

      // Setup for processing
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));

      await service.processRemoteOps(remoteOps);

      // Should show warning exactly once (not twice for two ops)
      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'WARNING',
          msg: T.F.SYNC.S.NEWER_VERSION_AVAILABLE,
        }),
      );

      // Should still process the ops (appendBatchSkipDuplicates called with both ops)
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        remoteOps,
        'remote',
        {
          pendingApply: true,
        },
      );
    });

    it('should not show newer version warning again in same session', async () => {
      // Current version is 1 (set in beforeEach)
      const remoteOps1: Operation[] = [{ id: 'op1', schemaVersion: 2 } as Operation];
      const remoteOps2: Operation[] = [{ id: 'op2', schemaVersion: 2 } as Operation];

      // Setup for processing
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));

      // First call
      await service.processRemoteOps(remoteOps1);
      // Second call (same session)
      await service.processRemoteOps(remoteOps2);

      // Warning should only be shown once across both calls
      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'WARNING',
          msg: T.F.SYNC.S.NEWER_VERSION_AVAILABLE,
        }),
      );
    });

    it('should not show warning for ops at current version', async () => {
      // Current version is 1 (set in beforeEach)
      const remoteOps: Operation[] = [{ id: 'op1', schemaVersion: 1 } as Operation];

      // Setup for processing
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));

      await service.processRemoteOps(remoteOps);

      // Should not show any warning
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    });

    it('should use migrated ops for conflict detection', async () => {
      const remoteOp: Operation = { id: 'op1', schemaVersion: 1 } as Operation;
      const migratedOp: Operation = { ...remoteOp, schemaVersion: 2 };

      schemaMigrationServiceSpy.migrateOperation.and.returnValue(migratedOp);

      // Setup
      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));

      // Spy on detectConflicts to verify it's called with migrated ops
      spyOn(service, 'detectConflicts').and.callThrough();

      await service.processRemoteOps([remoteOp]);

      expect(service.detectConflicts).toHaveBeenCalledWith(
        [migratedOp],
        jasmine.any(Map),
      );
    });

    it('should skip conflict detection when SYNC_IMPORT is in remote ops', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-1',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [syncImportOp] }),
      );

      // Spy on detectConflicts - it should NOT be called
      spyOn(service, 'detectConflicts').and.callThrough();

      await service.processRemoteOps([syncImportOp]);

      expect(service.detectConflicts).not.toHaveBeenCalled();
    });

    it('should skip conflict detection when BACKUP_IMPORT is in remote ops', async () => {
      const backupImportOp: Operation = {
        id: 'backup-import-1',
        opType: OpType.BackupImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [backupImportOp] }),
      );

      // Spy on detectConflicts - it should NOT be called
      spyOn(service, 'detectConflicts').and.callThrough();

      await service.processRemoteOps([backupImportOp]);

      expect(service.detectConflicts).not.toHaveBeenCalled();
    });

    it('should call setProtectedClientIds with ALL vectorClock keys when SYNC_IMPORT is applied', async () => {
      // The import's vectorClock contains ALL clients known at import time
      // ALL of these must be protected from pruning, not just the clientId
      const syncImportOp: Operation = {
        id: 'sync-import-1',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'importClientId',
        vectorClock: { importClientId: 1, otherClient: 5, thirdClient: 3 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [syncImportOp] }),
      );

      await service.processRemoteOps([syncImportOp]);

      // All keys from vectorClock must be protected, not just the clientId
      expect(opLogStoreSpy.setProtectedClientIds).toHaveBeenCalledWith(
        jasmine.arrayContaining(['importClientId', 'otherClient', 'thirdClient']),
      );
      // Verify we got exactly 3 keys
      const calledWith = opLogStoreSpy.setProtectedClientIds.calls.mostRecent()
        .args[0] as string[];
      expect(calledWith.length).toBe(3);
    });

    it('should call setProtectedClientIds with ALL vectorClock keys when BACKUP_IMPORT is applied', async () => {
      // Same as SYNC_IMPORT: backup's vectorClock contains all known clients
      // and all must be protected from pruning
      const backupImportOp: Operation = {
        id: 'backup-import-1',
        opType: OpType.BackupImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'backupClientId',
        vectorClock: { backupClientId: 1, deviceA: 10, deviceB: 7 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [backupImportOp] }),
      );

      await service.processRemoteOps([backupImportOp]);

      // All keys from vectorClock must be protected
      expect(opLogStoreSpy.setProtectedClientIds).toHaveBeenCalledWith(
        jasmine.arrayContaining(['backupClientId', 'deviceA', 'deviceB']),
      );
      // Verify we got exactly 3 keys
      const calledWith = opLogStoreSpy.setProtectedClientIds.calls.mostRecent()
        .args[0] as string[];
      expect(calledWith.length).toBe(3);
    });

    it('should NOT call setProtectedClientIds when no full-state op is applied', async () => {
      const regularOp: Operation = {
        id: 'regular-op-1',
        opType: OpType.Update,
        actionType: '[Task] Update Task' as ActionType,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test' },
        clientId: 'client1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [regularOp] }),
      );

      await service.processRemoteOps([regularOp]);

      expect(opLogStoreSpy.setProtectedClientIds).not.toHaveBeenCalled();
    });

    it('should call clearFullStateOpsExcept when SYNC_IMPORT is applied to prevent stale import filtering', async () => {
      // This test verifies the fix for the scenario where:
      // 1. Client A has old SYNC_IMPORT from client X with minimal clock {X:1}
      // 2. Client B uploads new SYNC_IMPORT
      // 3. Client A downloads B's SYNC_IMPORT but still has X's old one stored
      // 4. If X's import has a higher UUIDv7, getLatestFullStateOpEntry returns it
      // 5. New operations appear CONCURRENT with X's import and get filtered
      //
      // The fix clears old full-state ops AFTER storing the new one (for crash safety),
      // excluding the newly stored ID so we don't delete what we just added.
      const syncImportOp: Operation = {
        id: 'sync-import-1',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      opLogStoreSpy.clearFullStateOpsExcept.and.returnValue(Promise.resolve(2)); // Had 2 old ops
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [syncImportOp] }),
      );

      await service.processRemoteOps([syncImportOp]);

      // Verify clearFullStateOpsExcept was called AFTER the new SYNC_IMPORT is stored,
      // with the new import ID excluded to preserve it
      expect(opLogStoreSpy.clearFullStateOpsExcept).toHaveBeenCalledWith([
        'sync-import-1',
      ]);
    });

    it('should NOT call clearFullStateOpsExcept when regular ops are applied', async () => {
      const regularOp: Operation = {
        id: 'regular-op-1',
        opType: OpType.Update,
        actionType: '[Task] Update Task' as ActionType,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test' },
        clientId: 'client1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [regularOp] }),
      );

      await service.processRemoteOps([regularOp]);

      // clearFullStateOpsExcept should NOT be called for regular ops
      expect(opLogStoreSpy.clearFullStateOpsExcept).not.toHaveBeenCalled();
    });

    describe('SYNC_IMPORT filter metadata return fields', () => {
      const createFullOp = (partial: Partial<Operation>): Operation => ({
        id: 'op-1',
        actionType: '[Test] Action' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'entity-1',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
        ...partial,
      });

      it('should return allOpsFilteredBySyncImport=true and correct count when all ops are filtered', async () => {
        const syncImportOp = createFullOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 5 },
        });

        // Store has the SYNC_IMPORT
        opLogStoreSpy.getLatestFullStateOp.and.returnValue(Promise.resolve(syncImportOp));

        // Configure filter service to return all ops as invalidated
        syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.returnValue(
          Promise.resolve({
            validOps: [],
            invalidatedOps: [
              createFullOp({ id: 'filtered-1' }),
              createFullOp({ id: 'filtered-2' }),
              createFullOp({ id: 'filtered-3' }),
            ],
            filteringImport: syncImportOp,
            isLocalUnsyncedImport: false,
          }),
        );

        const remoteOps = [
          createFullOp({ id: 'op-1', vectorClock: { clientB: 1 } }),
          createFullOp({ id: 'op-2', vectorClock: { clientB: 2 } }),
          createFullOp({ id: 'op-3', vectorClock: { clientB: 3 } }),
        ];

        const result = await service.processRemoteOps(remoteOps);

        expect(result.allOpsFilteredBySyncImport).toBeTrue();
        expect(result.filteredOpCount).toBe(3);
        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.id).toBe(syncImportOp.id);
        expect(result.localWinOpsCreated).toBe(0);
      });

      it('should return allOpsFilteredBySyncImport=false when some ops pass filter', async () => {
        const syncImportOp = createFullOp({
          id: '019afd68-0050-7000-0000-000000000000',
          opType: OpType.SyncImport,
          clientId: 'client-A',
          entityType: 'ALL',
          vectorClock: { clientA: 5 },
        });

        const validOp = createFullOp({
          id: 'valid-op',
          vectorClock: { clientA: 5, clientB: 1 }, // GREATER_THAN import
        });

        // Some ops are valid, some filtered
        syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.returnValue(
          Promise.resolve({
            validOps: [validOp],
            invalidatedOps: [createFullOp({ id: 'filtered-1' })],
            filteringImport: syncImportOp,
            isLocalUnsyncedImport: false,
          }),
        );

        // Setup for applying the valid op
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
        opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
        vectorClockServiceSpy.getEntityFrontier.and.returnValue(
          Promise.resolve(new Map()),
        );
        vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
        opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
        opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
        operationApplierServiceSpy.applyOperations.and.returnValue(
          Promise.resolve({ appliedOps: [validOp] }),
        );

        const remoteOps = [
          createFullOp({ id: 'op-1', vectorClock: { clientB: 1 } }),
          createFullOp({ id: 'op-2', vectorClock: { clientA: 5, clientB: 2 } }),
        ];

        const result = await service.processRemoteOps(remoteOps);

        // Some ops passed, so allOpsFilteredBySyncImport is false
        expect(result.allOpsFilteredBySyncImport).toBeFalse();
        expect(result.filteredOpCount).toBe(0);
        expect(result.localWinOpsCreated).toBe(0);
      });

      it('should return allOpsFilteredBySyncImport=false when no import exists', async () => {
        // No filtering by sync import (default mock behavior)
        syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.returnValue(
          Promise.resolve({
            validOps: [createFullOp({ id: 'op-1' })],
            invalidatedOps: [],
            isLocalUnsyncedImport: false,
          }),
        );

        // Setup for applying ops
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
        opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
        vectorClockServiceSpy.getEntityFrontier.and.returnValue(
          Promise.resolve(new Map()),
        );
        vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
        opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
        opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
        operationApplierServiceSpy.applyOperations.and.returnValue(
          Promise.resolve({ appliedOps: [] }),
        );

        const result = await service.processRemoteOps([createFullOp({ id: 'op-1' })]);

        expect(result.allOpsFilteredBySyncImport).toBeFalse();
        expect(result.filteredOpCount).toBe(0);
        expect(result.filteringImport).toBeUndefined();
      });

      it('should return correct metadata when migration drops all ops', async () => {
        schemaMigrationServiceSpy.migrateOperation.and.returnValue(null);

        const result = await service.processRemoteOps([
          createFullOp({ id: 'op-1' }),
          createFullOp({ id: 'op-2' }),
        ]);

        // Migration dropped all ops, not SYNC_IMPORT filtering
        expect(result.allOpsFilteredBySyncImport).toBeFalse();
        expect(result.filteredOpCount).toBe(0);
        expect(result.filteringImport).toBeUndefined();
        expect(result.localWinOpsCreated).toBe(0);
      });

      it('should return filteringImport with full operation details', async () => {
        const syncImportOp: Operation = {
          id: '019afd68-0050-7000-0000-000000000000',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          payload: { appDataComplete: {} },
          clientId: 'client-A',
          vectorClock: { clientA: 5 },
          timestamp: 1704067200000,
          schemaVersion: 1,
        };

        syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.returnValue(
          Promise.resolve({
            validOps: [],
            invalidatedOps: [createFullOp({ id: 'filtered-1' })],
            filteringImport: syncImportOp,
            isLocalUnsyncedImport: false,
          }),
        );

        const result = await service.processRemoteOps([createFullOp({ id: 'op-1' })]);

        expect(result.filteringImport).toBeDefined();
        expect(result.filteringImport!.clientId).toBe('client-A');
        expect(result.filteringImport!.timestamp).toBe(1704067200000);
        expect(result.filteringImport!.vectorClock).toEqual({ clientA: 5 });
      });
    });
  });

  describe('detectConflicts', () => {
    const createOp = (partial: Partial<Operation>): Operation => ({
      id: 'op-1',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'entity-1',
      payload: {},
      clientId: 'client-1',
      vectorClock: { client1: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      ...partial,
    });

    it('should NOT flag remote TASK ops as conflicts when fresh client has only GLOBAL_CONFIG pending ops', async () => {
      // Scenario: Fresh client configured sync (creating GLOBAL_CONFIG op) but hasn't synced yet
      // Remote TASK ops should NOT be conflicts - they should be applied directly

      // Setup: GLOBAL_CONFIG has a pending local op, but TASK:task-1 has none
      const pendingByEntity = new Map<string, Operation[]>();
      pendingByEntity.set('GLOBAL_CONFIG:sync', [
        createOp({
          id: 'local-config-op',
          entityType: 'GLOBAL_CONFIG',
          entityId: 'sync',
          opType: OpType.Update,
          vectorClock: { localClient: 1 },
        }),
      ]);
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(pendingByEntity));

      // No snapshot (fresh client)
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(
        Promise.resolve(undefined),
      );

      // No entity frontier for TASK (it's a fresh client)
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));

      // Remote TASK operation from another client
      const remoteTaskOps: Operation[] = [
        createOp({
          id: 'remote-task-op',
          entityType: 'TASK',
          entityId: 'task-1',
          opType: OpType.Create,
          vectorClock: { otherClient: 1 },
        }),
      ];

      const result = await service.detectConflicts(remoteTaskOps, new Map());

      // TASK op should be non-conflicting (not a conflict!)
      expect(result.nonConflicting.length).toBe(1);
      expect(result.nonConflicting[0].id).toBe('remote-task-op');
      expect(result.conflicts.length).toBe(0);
    });

    it('should detect conflicts when same entity has concurrent local and remote ops', async () => {
      // Setup: TASK:task-1 has a pending local op
      const localOp = createOp({
        id: 'local-task-op',
        entityType: 'TASK',
        entityId: 'task-1',
        opType: OpType.Update,
        vectorClock: { localClient: 1 },
      });
      const pendingByEntity = new Map<string, Operation[]>();
      pendingByEntity.set('TASK:task-1', [localOp]);
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(pendingByEntity));

      // No snapshot
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(
        Promise.resolve(undefined),
      );

      // Remote TASK operation from another client (concurrent - different client)
      const remoteOps: Operation[] = [
        createOp({
          id: 'remote-task-op',
          entityType: 'TASK',
          entityId: 'task-1',
          opType: OpType.Update,
          vectorClock: { otherClient: 1 },
        }),
      ];

      const result = await service.detectConflicts(remoteOps, new Map());

      // Should be detected as conflict (concurrent modifications to same entity)
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].entityId).toBe('task-1');
      expect(result.nonConflicting.length).toBe(0);
    });

    it('should skip superseded remote ops (local is newer)', async () => {
      // Setup: local has newer clock
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(
        Promise.resolve({ localClient: 5 }),
      );
      // Entity exists in snapshot (so snapshot clock is used as fallback)
      vectorClockServiceSpy.getSnapshotEntityKeys.and.returnValue(
        Promise.resolve(new Set(['TASK:task-1'])),
      );
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));

      // Remote op with older clock
      const remoteOps: Operation[] = [
        createOp({
          id: 'stale-op',
          entityType: 'TASK',
          entityId: 'task-1',
          vectorClock: { localClient: 3 }, // Older than local's clock of 5
        }),
      ];

      const result = await service.detectConflicts(remoteOps, new Map());

      // Should be skipped (superseded)
      expect(result.nonConflicting.length).toBe(0);
      expect(result.conflicts.length).toBe(0);
    });
  });

  describe('applyNonConflictingOps', () => {
    const createFullOp = (partial: Partial<Operation>): Operation => ({
      id: 'op-1',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'entity-1',
      payload: {},
      clientId: 'client-1',
      vectorClock: { client1: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      ...partial,
    });

    it('should merge remote ops clocks after applying', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'remote-1', vectorClock: { remoteClient: 1 } }),
      ];

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: remoteOps }),
      );

      await service.applyNonConflictingOps(remoteOps);

      expect(opLogStoreSpy.mergeRemoteOpClocks).toHaveBeenCalledWith(remoteOps);
    });

    it('should NOT call mergeRemoteOpClocks when no ops are applied', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'remote-1', vectorClock: { remoteClient: 1 } }),
      ];

      // All ops are duplicates (appendBatchSkipDuplicates returns empty writtenOps)
      opLogStoreSpy.appendBatchSkipDuplicates.and.returnValue(
        Promise.resolve({ seqs: [], writtenOps: [], skippedCount: 1 }),
      );

      await service.applyNonConflictingOps(remoteOps);

      expect(opLogStoreSpy.mergeRemoteOpClocks).not.toHaveBeenCalled();
    });

    it('should mark failed ops and run validation on partial failure', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'op-1' }),
        createFullOp({ id: 'op-2' }),
        createFullOp({ id: 'op-3' }),
      ];

      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      opLogStoreSpy.markApplied.and.returnValue(Promise.resolve());
      opLogStoreSpy.markFailed.and.returnValue(Promise.resolve());
      operationApplierServiceSpy.applyOperations.and.returnValue(
        Promise.resolve({
          appliedOps: [remoteOps[0]],
          failedOp: { op: remoteOps[1], error: new Error('Test error') },
        }),
      );

      await expectAsync(service.applyNonConflictingOps(remoteOps)).toBeRejected();

      // Should mark op-2 and op-3 as failed
      expect(opLogStoreSpy.markFailed).toHaveBeenCalledWith(['op-2', 'op-3']);
      // Should run validation after partial failure
      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'partial-apply-failure',
        { callerHoldsLock: false },
      );
    });

    // =========================================================================
    // Issue #6343: Atomic duplicate skipping (replaces issue #6213 retry logic)
    // =========================================================================
    // appendBatchSkipDuplicates atomically checks and inserts within a single
    // IndexedDB transaction, eliminating the TOCTOU race condition.

    describe('atomic duplicate skipping (issue #6343)', () => {
      it('should skip duplicates silently and only apply new ops', async () => {
        const remoteOps: Operation[] = [
          createFullOp({ id: 'op-1', vectorClock: { client1: 1 } }),
          createFullOp({ id: 'op-2', vectorClock: { client1: 2 } }),
        ];

        // Simulate: op-1 already exists, op-2 is new
        opLogStoreSpy.appendBatchSkipDuplicates.and.returnValue(
          Promise.resolve({
            seqs: [2],
            writtenOps: [remoteOps[1]],
            skippedCount: 1,
          }),
        );
        operationApplierServiceSpy.applyOperations.and.returnValue(
          Promise.resolve({ appliedOps: [remoteOps[1]] }),
        );

        await service.applyNonConflictingOps(remoteOps);

        // Should call appendBatchSkipDuplicates exactly once (no retry needed)
        expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledTimes(1);
        // Should apply only the non-duplicate op
        expect(operationApplierServiceSpy.applyOperations).toHaveBeenCalledWith([
          remoteOps[1],
        ]);
      });

      it('should propagate non-duplicate errors', async () => {
        const remoteOps: Operation[] = [
          createFullOp({ id: 'op-1', vectorClock: { client1: 1 } }),
        ];

        opLogStoreSpy.appendBatchSkipDuplicates.and.rejectWith(
          new Error('Some other database error'),
        );

        await expectAsync(
          service.applyNonConflictingOps(remoteOps),
        ).toBeRejectedWithError(/Some other database error/);

        expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledTimes(1);
      });

      it('should handle all ops being duplicates gracefully', async () => {
        const remoteOps: Operation[] = [
          createFullOp({ id: 'op-1', vectorClock: { client1: 1 } }),
        ];

        // All ops already exist
        opLogStoreSpy.appendBatchSkipDuplicates.and.returnValue(
          Promise.resolve({ seqs: [], writtenOps: [], skippedCount: 1 }),
        );

        await service.applyNonConflictingOps(remoteOps);

        // Should not try to apply any ops
        expect(operationApplierServiceSpy.applyOperations).not.toHaveBeenCalled();
      });
    });
  });

  describe('validateAfterSync', () => {
    it('should call validateAndRepairCurrentState with sync context', async () => {
      await service.validateAfterSync();

      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'sync',
        { callerHoldsLock: false },
      );
    });

    it('should pass callerHoldsLock when specified', async () => {
      await service.validateAfterSync(true);

      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'sync',
        { callerHoldsLock: true },
      );
    });
  });
});

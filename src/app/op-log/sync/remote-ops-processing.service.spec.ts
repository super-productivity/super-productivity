import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import {
  SchemaMigrationService,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
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
import { OpLog } from '../../core/log';
import { SyncProviderId } from '../sync-providers/provider.const';
import { LOCAL_ONLY_SYNC_KEYS } from '../../features/config/local-only-sync-settings.util';
import { IncompleteRemoteOperationsError } from '../core/errors/sync-errors';
import { HydrationStateService } from '../apply/hydration-state.service';
import { LOCK_NAMES } from '../core/operation-log.const';

describe('RemoteOpsProcessingService', () => {
  let service: RemoteOpsProcessingService;
  let storeSpy: jasmine.SpyObj<Store>;
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
  let operationLogEffectsSpy: jasmine.SpyObj<OperationLogEffects>;
  let writeFlushServiceSpy: jasmine.SpyObj<OperationWriteFlushService>;

  const applyAllWithReducerCommit = async (
    ops: Operation[],
    options?: Parameters<OperationApplierService['applyOperations']>[1],
  ): ReturnType<OperationApplierService['applyOperations']> => {
    await options?.onReducersCommitted?.(ops);
    return { appliedOps: ops };
  };

  beforeEach(() => {
    storeSpy = jasmine.createSpyObj('Store', ['select']);
    storeSpy.select.and.returnValue(
      of({
        isEnabled: true,
        isEncryptionEnabled: true,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: true,
      }),
    );
    schemaMigrationServiceSpy = jasmine.createSpyObj('SchemaMigrationService', [
      'getCurrentVersion',
      'migrateOperation',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snackServiceSpy.hasPendingPersistentAction.and.returnValue(false);
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'hasOp',
      'append',
      'appendBatchSkipDuplicates',
      'mergeRemoteOpClocks',
      'markReducersCommittedAndMergeClocks',
      'markApplied',
      'markFailed',
      'getUnsyncedByEntity',
      'getOpsAfterSeq',
      'getLatestFullStateOp',
      'getLatestFullStateOpEntry',
      'getOpById',
      'markRejected',
      'clearFullStateOps',
      'clearFullStateOpsExcept',
      'getVectorClock',
    ]);
    // Default: empty prior clock and no unsynced ops for the diagnostic
    // full-state log line. Tests that exercise the SYNC_IMPORT path can
    // override these per-test to assert the captured snapshot.
    opLogStoreSpy.getVectorClock.and.resolveTo(null);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);
    opLogStoreSpy.getLatestFullStateOpEntry.and.resolveTo(undefined);
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
    // By default, both durable clock transitions succeed
    opLogStoreSpy.mergeRemoteOpClocks.and.resolveTo();
    opLogStoreSpy.markReducersCommittedAndMergeClocks.and.resolveTo();
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
    operationLogEffectsSpy = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
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
        conflicts: EntityConflict[];
      }> => {
        const entityIdsToCheck = remoteOp.entityIds?.length
          ? remoteOp.entityIds
          : remoteOp.entityId
            ? [remoteOp.entityId]
            : [];

        const conflicts: EntityConflict[] = [];
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
            return { isSupersededOrDuplicate: true, conflicts: [] };
          }

          // Skip duplicate operations (already applied)
          if (vcComparison === VectorClockComparison.EQUAL) {
            return { isSupersededOrDuplicate: true, conflicts: [] };
          }

          // No pending ops = no conflict possible
          if (localOpsForEntity.length === 0) {
            continue;
          }

          // CONCURRENT = true conflict
          if (vcComparison === VectorClockComparison.CONCURRENT) {
            conflicts.push({
              entityType: remoteOp.entityType,
              entityId,
              localOps: localOpsForEntity,
              remoteOps: [remoteOp],
              suggestedResolution: 'manual',
            });
          }
        }

        return { isSupersededOrDuplicate: false, conflicts };
      },
    );
    validateStateServiceSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
      'validateAndRepairCurrentState',
    ]);
    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    // Default: execute callback immediately (simulating lock acquisition)
    lockServiceSpy.request.and.callFake(
      async <T>(_name: string, callback: () => Promise<T>) => callback(),
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
    writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
      'flushThenRunExclusive',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();
    writeFlushServiceSpy.flushThenRunExclusive.and.callFake(
      async <T>(fn: () => Promise<T>) => {
        await writeFlushServiceSpy.flushPendingWrites();
        return fn();
      },
    );

    TestBed.configureTestingModule({
      providers: [
        RemoteOpsProcessingService,
        { provide: Store, useValue: storeSpy },
        { provide: SchemaMigrationService, useValue: schemaMigrationServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: VectorClockService, useValue: vectorClockServiceSpy },
        { provide: OperationApplierService, useValue: operationApplierServiceSpy },
        { provide: OperationLogEffects, useValue: operationLogEffectsSpy },
        { provide: ConflictResolutionService, useValue: conflictResolutionServiceSpy },
        { provide: ValidateStateService, useValue: validateStateServiceSpy },
        { provide: LockService, useValue: lockServiceSpy },
        { provide: OperationLogCompactionService, useValue: compactionServiceSpy },
        { provide: SyncImportFilterService, useValue: syncImportFilterServiceSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
      ],
    });

    service = TestBed.inject(RemoteOpsProcessingService);
    schemaMigrationServiceSpy.getCurrentVersion.and.returnValue(1);
    // Default migration: return op as is
    schemaMigrationServiceSpy.migrateOperation.and.callFake((op) => op);
    // Default validation: valid
    validateStateServiceSpy.validateAndRepair.and.resolveTo({
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
    operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);
    operationLogEffectsSpy.processDeferredActions.and.resolveTo();
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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

      // Track call order
      const callOrder: string[] = [];
      writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
        callOrder.push('flushPendingWrites');
      });
      lockServiceSpy.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>) => {
          callOrder.push('lockAcquired');
          return callback();
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

      // Verify flush happened BEFORE lock, lock BEFORE detectConflicts
      expect(callOrder).toEqual([
        'flushPendingWrites',
        'lockAcquired',
        'detectConflicts',
      ]);
    });

    it('should log conflict identities without logging operation payloads', async () => {
      const localOp = {
        id: 'local-op',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'private local title' },
      } as Operation;
      const remoteOp = {
        id: 'remote-op',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'private remote title' },
        schemaVersion: 1,
      } as Operation;
      spyOn(service, 'detectConflicts').and.resolveTo({
        nonConflicting: [],
        conflicts: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ],
      });
      conflictResolutionServiceSpy.autoResolveConflictsLWW.and.resolveTo({
        localWinOpsCreated: 0,
      });
      vectorClockServiceSpy.getEntityFrontier.and.resolveTo(new Map());
      const warnSpy = spyOn(OpLog, 'warn');

      await service.processRemoteOps([remoteOp]);

      const summary = warnSpy.calls
        .allArgs()
        .find(([message]) => String(message).includes('Detected 1 conflicts'))?.[1];
      expect(summary).toEqual({
        conflicts: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOpIds: ['local-op'],
            remoteOpIds: ['remote-op'],
            suggestedResolution: 'manual',
          },
        ],
      });
      expect(JSON.stringify(summary)).not.toContain('private');
    });

    // Producer freeze for the conflict-review rollback: this is the only
    // production entry point into autoResolveConflictsLWW, so if these two flags
    // are ever dropped the stable fleet silently starts persisting the discarded
    // side of every conflict verbatim again. Delete this test with the freeze.
    it('should freeze both conflict-review producers on the production resolve path', async () => {
      const localOp = {
        id: 'local-op',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'local title' },
      } as Operation;
      const remoteOp = {
        id: 'remote-op',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'remote title' },
        schemaVersion: 1,
      } as Operation;
      spyOn(service, 'detectConflicts').and.resolveTo({
        nonConflicting: [],
        conflicts: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ],
      });
      conflictResolutionServiceSpy.autoResolveConflictsLWW.and.resolveTo({
        localWinOpsCreated: 0,
      });
      vectorClockServiceSpy.getEntityFrontier.and.resolveTo(new Map());

      await service.processRemoteOps([remoteOp]);

      expect(conflictResolutionServiceSpy.autoResolveConflictsLWW).toHaveBeenCalledWith(
        jasmine.any(Array),
        jasmine.any(Array),
        jasmine.objectContaining({
          disableDisjointMerge: true,
          disableConflictJournal: true,
        }),
      );
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

    it('should stop the batch at the first op that throws during migration and only process the prefix', async () => {
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

      const result = await service.processRemoteOps(remoteOps);

      // Only the prefix before the blocked op is processed. op3 must NOT be
      // applied: it may depend on the blocked op, and the un-advanced cursor
      // will re-deliver it after the migration issue is fixed.
      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [remoteOps[0]],
        'remote',
        { pendingApply: true },
      );
      expect(result.blockedByIncompatibleOp).toBe(true);
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.MIGRATION_FAILED,
        }),
      );
    });

    it('should block without processing anything when the first op fails migration', async () => {
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
        blockedByIncompatibleOp: true,
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

    it('should block any op from a newer schema version (no forward-compat band)', async () => {
      // Current version is 1 (set in beforeEach). Even version 2 — one ahead —
      // must block: real migrations rename/split fields, so a future op applied
      // verbatim corrupts state.
      const remoteOps: Operation[] = [{ id: 'op1', schemaVersion: 2 } as Operation];

      const result = await service.processRemoteOps(remoteOps);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
        }),
      );

      // Should not proceed to apply ops
      expect(opLogStoreSpy.getUnsynced).not.toHaveBeenCalled();
      expect(result.blockedByIncompatibleOp).toBe(true);
    });

    for (const invalidVersion of [null, '2', 1.5, {}, Number.NaN]) {
      it(`should block malformed schemaVersion ${String(invalidVersion)}`, async () => {
        const remoteOp = {
          id: 'malformed-version',
          schemaVersion: invalidVersion,
        } as unknown as Operation;

        const result = await service.processRemoteOps([remoteOp]);

        expect(result.blockedByIncompatibleOp).toBeTrue();
        expect(schemaMigrationServiceSpy.migrateOperation).not.toHaveBeenCalled();
        expect(opLogStoreSpy.appendBatchSkipDuplicates).not.toHaveBeenCalled();
      });
    }

    it('should process the prefix before a too-new op but flag the block', async () => {
      const remoteOps: Operation[] = [
        { id: 'op1', schemaVersion: 1 } as Operation,
        { id: 'future', schemaVersion: 2 } as Operation,
        { id: 'op3', schemaVersion: 1 } as Operation,
      ];

      opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
      opLogStoreSpy.getUnsyncedByEntity.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getEntityFrontier.and.returnValue(Promise.resolve(new Map()));
      vectorClockServiceSpy.getSnapshotVectorClock.and.returnValue(Promise.resolve({}));
      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));

      const result = await service.processRemoteOps(remoteOps);

      expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [remoteOps[0]],
        'remote',
        { pendingApply: true },
      );
      expect(result.blockedByIncompatibleOp).toBe(true);
    });

    it('should report a committed full-state prefix before a blocked suffix', async () => {
      const repair: Operation = {
        id: 'repair-prefix',
        opType: OpType.Repair,
        actionType: ActionType.REPAIR_AUTO,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const futureOp: Operation = {
        id: 'future-suffix',
        opType: OpType.Update,
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: {},
        clientId: 'client-2',
        vectorClock: { client2: 1 },
        timestamp: Date.now(),
        schemaVersion: 2,
      };
      opLogStoreSpy.hasOp.and.resolveTo(false);
      opLogStoreSpy.append.and.resolveTo(1);

      const result = await service.processRemoteOps([repair, futureOp]);

      expect(result.blockedByIncompatibleOp).toBeTrue();
      expect(result.committedFullStateOpIds).toEqual([repair.id]);
      expect(operationApplierServiceSpy.applyOperations).toHaveBeenCalled();
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
        blockedByIncompatibleOp: true,
      });
    });

    it('should not replace a visible persistent recovery action with the version-block snack', async () => {
      snackServiceSpy.hasPendingPersistentAction.and.returnValue(true);

      await service.processRemoteOps([{ id: 'op1', schemaVersion: 2 } as Operation]);

      expect(snackServiceSpy.open).not.toHaveBeenCalled();

      // The latch stayed unset, so a later retry (after the recovery action
      // resolves) still warns the user.
      snackServiceSpy.hasPendingPersistentAction.and.returnValue(false);
      await service.processRemoteOps([{ id: 'op2', schemaVersion: 2 } as Operation]);
      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
    });

    it('should show the version-block error only once per session', async () => {
      // Current version is 1 (set in beforeEach)
      const remoteOps1: Operation[] = [{ id: 'op1', schemaVersion: 2 } as Operation];
      const remoteOps2: Operation[] = [{ id: 'op2', schemaVersion: 2 } as Operation];

      // First call
      await service.processRemoteOps(remoteOps1);
      // Second call (same session — periodic sync retries re-hit the block)
      await service.processRemoteOps(remoteOps2);

      // Error snack should only be shown once across both calls
      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

      // Spy on detectConflicts - it should NOT be called
      spyOn(service, 'detectConflicts').and.callThrough();

      await service.processRemoteOps([syncImportOp]);

      expect(service.detectConflicts).not.toHaveBeenCalled();
    });

    it('should flush and hold the operation-log lock through full-state apply and validation', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-exclusive',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const callOrder: string[] = [];
      lockServiceSpy.request.and.callFake(
        async <T>(name: string, callback: () => Promise<T>) => {
          expect(name).toBe(LOCK_NAMES.UPLOAD);
          callOrder.push('upload:start');
          const value = await callback();
          callOrder.push('upload:end');
          return value;
        },
      );
      writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
        callOrder.push('flush');
      });
      writeFlushServiceSpy.flushThenRunExclusive.and.callFake(
        async <T>(fn: () => Promise<T>) => {
          await writeFlushServiceSpy.flushPendingWrites();
          callOrder.push('exclusive:start');
          const value = await fn();
          callOrder.push('exclusive:end');
          return value;
        },
      );
      opLogStoreSpy.mergeRemoteOpClocks.and.callFake(async () => {
        callOrder.push('premerge');
      });
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        callOrder.push('reducers');
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
        callOrder.push('deferred');
      });
      const validationSpy = spyOn(service, 'validateAfterSync').and.callFake(
        async (callerHoldsOperationLogLock) => {
          expect(callerHoldsOperationLogLock).toBeTrue();
          callOrder.push('validation');
          return true;
        },
      );

      await service.processRemoteOps([syncImportOp]);

      expect(writeFlushServiceSpy.flushThenRunExclusive).toHaveBeenCalledTimes(1);
      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
      expect(validationSpy).toHaveBeenCalledWith(true);
      expect(callOrder).toEqual([
        'upload:start',
        'flush',
        'exclusive:start',
        'premerge',
        'reducers',
        'deferred',
        'validation',
        'exclusive:end',
        'upload:end',
      ]);
    });

    it('should keep the final full-state guard atomic with apply and drain buffered actions on abort', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-final-guard',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const hydrationState = TestBed.inject(HydrationStateService);
      const acquireHoldSpy = spyOn(
        hydrationState,
        'acquireApplyingRemoteOpsHold',
      ).and.callThrough();
      let wasApplyingDuringGuard = false;
      let wasApplyingDuringDrain = true;
      operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
        wasApplyingDuringDrain = hydrationState.isApplyingRemoteOps();
      });

      const result = await service.processRemoteOps([syncImportOp], {
        beforeFullStateApply: async () => {
          wasApplyingDuringGuard = hydrationState.isApplyingRemoteOps();
          return false;
        },
      });

      expect(lockServiceSpy.request).toHaveBeenCalledWith(
        LOCK_NAMES.UPLOAD,
        jasmine.any(Function),
      );
      expect(writeFlushServiceSpy.flushThenRunExclusive).toHaveBeenCalledTimes(1);
      expect(acquireHoldSpy).toHaveBeenCalledTimes(1);
      expect(wasApplyingDuringGuard).toBeTrue();
      expect(operationApplierServiceSpy.applyOperations).not.toHaveBeenCalled();
      expect(
        validateStateServiceSpy.validateAndRepairCurrentState,
      ).not.toHaveBeenCalled();
      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledOnceWith({
        callerHoldsOperationLogLock: true,
      });
      expect(wasApplyingDuringDrain).toBeFalse();
      expect(result.fullStateApplyBlockedByLocalConflict).toBeTrue();
    });

    it('should propagate an already-held operation-log lock through full-state apply and validation', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-under-lock',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      const applySpy = spyOn(service, 'applyNonConflictingOps').and.callThrough();
      const validationSpy = spyOn(service, 'validateAfterSync').and.resolveTo(true);

      await service.processRemoteOps([syncImportOp], {
        callerHoldsOperationLogLock: true,
      });

      expect(applySpy).toHaveBeenCalledWith([syncImportOp], true, {
        skipDeferredActionDrain: true,
      });
      expect(validationSpy).toHaveBeenCalledWith(true);
      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
      expect(writeFlushServiceSpy.flushThenRunExclusive).not.toHaveBeenCalled();
      expect(writeFlushServiceSpy.flushPendingWrites).not.toHaveBeenCalled();
      expect(lockServiceSpy.request).not.toHaveBeenCalled();
    });

    it('should log incoming full-state op shape and prior receiver state for diagnostics', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-diag',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {},
        clientId: 'B_h1Wp',
        vectorClock: { ['B_h1Wp']: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
        syncImportReason: 'PASSWORD_CHANGED',
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      opLogStoreSpy.getVectorClock.and.resolveTo({
        ['A_kg5q']: 446,
        ['B_old']: 9,
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([
        { seq: 99, op: { opType: OpType.Update } as any, appliedAt: 0, source: 'local' },
      ]);
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);
      const opLogSpy = spyOn(OpLog, 'log').and.callThrough();

      await service.processRemoteOps([syncImportOp]);

      const fullStateLogCall = opLogSpy.calls
        .allArgs()
        .find(
          (args) =>
            typeof args[0] === 'string' && args[0].includes('APPLYING FULL-STATE OP'),
        );
      expect(fullStateLogCall)
        .withContext('full-state diagnostic log fired')
        .toBeDefined();
      expect(fullStateLogCall![1]).toEqual(
        jasmine.objectContaining({
          incoming: jasmine.arrayContaining([
            jasmine.objectContaining({
              opType: OpType.SyncImport,
              clientId: 'B_h1Wp',
              syncImportReason: 'PASSWORD_CHANGED',
              vectorClock: { ['B_h1Wp']: 1 },
            }),
          ]),
          priorClock: { ['A_kg5q']: 446, ['B_old']: 9 },
          priorClockSize: 2,
          priorUnsyncedCount: 1,
          priorUnsyncedByOpType: { [OpType.Update]: 1 },
        }),
      );
    });

    it('should persist current local sync settings into incoming SYNC_IMPORT ops for replay', async () => {
      const syncImportOp: Operation = {
        id: 'sync-import-localized',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {
          task: {},
          project: {},
          globalConfig: {
            sync: {
              isEnabled: false,
              isEncryptionEnabled: false,
              syncProvider: null,
              syncInterval: 600000,
              isManualSyncOnly: false,
              isCompressionEnabled: true,
            },
          },
        },
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      let appliedOps: Operation[] = [];

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        appliedOps = ops;
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });

      await service.processRemoteOps([syncImportOp]);

      const writtenOp =
        opLogStoreSpy.appendBatchSkipDuplicates.calls.mostRecent().args[0][0];
      const writtenPayload = writtenOp.payload as Record<string, unknown>;
      const writtenGlobalConfig = writtenPayload['globalConfig'] as Record<
        string,
        unknown
      >;
      const writtenSync = writtenGlobalConfig['sync'] as Record<string, unknown>;

      expect(writtenSync['isEnabled']).toBe(true);
      expect(writtenSync['isEncryptionEnabled']).toBe(true);
      expect(writtenSync['syncProvider']).toBe(SyncProviderId.WebDAV);
      expect(writtenSync['syncInterval']).toBe(300000);
      expect(writtenSync['isManualSyncOnly']).toBe(true);
      expect(writtenSync['isCompressionEnabled']).toBe(true);
      expect(appliedOps[0]).toBe(writtenOp);
    });

    // Round-trip pin (issue #8233): iterates LOCAL_ONLY_SYNC_KEYS so adding a
    // new local-only key in the util grows coverage here automatically.
    it('preserves every LOCAL_ONLY_SYNC_KEYS value on incoming full-state ops (round-trip)', async () => {
      const localSync = {
        isEnabled: true,
        isEncryptionEnabled: true,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: true,
      };
      storeSpy.select.and.returnValue(of(localSync));

      const syncImportOp: Operation = {
        id: 'sync-import-roundtrip',
        opType: OpType.SyncImport,
        actionType: '[All] Load All Data' as ActionType,
        entityType: 'ALL',
        payload: {
          globalConfig: {
            sync: {
              isEnabled: false,
              isEncryptionEnabled: false,
              syncProvider: SyncProviderId.Dropbox,
              syncInterval: 60000,
              isManualSyncOnly: false,
            },
          },
        },
        clientId: 'client-1',
        vectorClock: { client1: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

      await service.processRemoteOps([syncImportOp]);

      const writtenOp =
        opLogStoreSpy.appendBatchSkipDuplicates.calls.mostRecent().args[0][0];
      const writtenSync = (
        (writtenOp.payload as Record<string, unknown>)['globalConfig'] as Record<
          string,
          unknown
        >
      )['sync'] as Record<string, unknown>;

      for (const key of LOCAL_ONLY_SYNC_KEYS) {
        expect(writtenSync[key])
          .withContext(`replay payload sync.${key} must match local`)
          .toBe(localSync[key]);
      }
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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

      // Spy on detectConflicts - it should NOT be called
      spyOn(service, 'detectConflicts').and.callThrough();

      await service.processRemoteOps([backupImportOp]);

      expect(service.detectConflicts).not.toHaveBeenCalled();
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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);

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

      it('should filter #7549 stragglers before they can trigger LWW local-win reuploads', async () => {
        const storedSyncedImport = createFullOp({
          id: '019dea96-94e3-7f82-9f0e-b78d7576a667',
          actionType: '[SP_ALL] Load(import) all data' as ActionType,
          opType: OpType.SyncImport,
          entityType: 'ALL',
          entityId: 'import-1',
          clientId: 'B_kc2U',
          vectorClock: { ['B_kc2U']: 42 },
        });

        opLogStoreSpy.getLatestFullStateOpEntry.and.resolveTo({
          seq: 1,
          op: storedSyncedImport,
          source: 'local',
          syncedAt: Date.now(),
          appliedAt: Date.now(),
        });

        const realSyncImportFilterService = TestBed.runInInjectionContext(
          () => new SyncImportFilterService(),
        );
        syncImportFilterServiceSpy.filterOpsInvalidatedBySyncImport.and.callFake((ops) =>
          realSyncImportFilterService.filterOpsInvalidatedBySyncImport(ops),
        );

        // These pending local ops would produce CONCURRENT conflicts if the stale
        // remote ops below leaked past the import filter.
        opLogStoreSpy.getUnsyncedByEntity.and.resolveTo(
          new Map([
            [
              'TASK:task-repeat-instance',
              [
                createFullOp({
                  id: 'local-task-op',
                  entityId: 'task-repeat-instance',
                  clientId: 'B_kc2U',
                  vectorClock: { ['B_kc2U']: 43 },
                }),
              ],
            ],
            [
              'TASK_REPEAT_CFG:repeat-cfg',
              [
                createFullOp({
                  id: 'local-repeat-cfg-op',
                  entityType: 'TASK_REPEAT_CFG',
                  entityId: 'repeat-cfg',
                  clientId: 'B_kc2U',
                  vectorClock: { ['B_kc2U']: 44 },
                }),
              ],
            ],
          ]),
        );
        vectorClockServiceSpy.getEntityFrontier.and.resolveTo(new Map());
        vectorClockServiceSpy.getSnapshotVectorClock.and.resolveTo({});
        conflictResolutionServiceSpy.autoResolveConflictsLWW.and.resolveTo({
          localWinOpsCreated: 57,
        });
        spyOn(service, 'detectConflicts').and.callThrough();

        const remoteStragglers: Operation[] = [
          createFullOp({
            id: '019e03fa-9438-7d3f-9f7f-cd2e2010f230',
            entityId: 'task-repeat-instance',
            clientId: 'A_jfjc',
            vectorClock: { ['A_jfjc']: 240 },
          }),
          createFullOp({
            id: '019e03ba-433b-73f7-ad2e-577913108d4f',
            entityType: 'TASK_REPEAT_CFG',
            entityId: 'repeat-cfg',
            clientId: 'B_z7PQ',
            vectorClock: { ['B_z7PQ']: 12 },
          }),
        ];

        const result = await service.processRemoteOps(remoteStragglers);

        expect(result.localWinOpsCreated).toBe(0);
        expect(result.allOpsFilteredBySyncImport).toBeTrue();
        expect(result.filteredOpCount).toBe(2);
        expect(result.filteringImport?.id).toBe(storedSyncedImport.id);
        expect(result.isLocalUnsyncedImport).toBeFalse();
        expect(service.detectConflicts).not.toHaveBeenCalled();
        expect(
          conflictResolutionServiceSpy.autoResolveConflictsLWW,
        ).not.toHaveBeenCalled();
        expect(opLogStoreSpy.appendBatchSkipDuplicates).not.toHaveBeenCalled();
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
        operationApplierServiceSpy.applyOperations.and.callFake(
          applyAllWithReducerCommit,
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
        operationApplierServiceSpy.applyOperations.and.callFake(
          applyAllWithReducerCommit,
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

    it('should retain every per-entity conflict reported for one remote op (#8956)', async () => {
      const remoteOp = createOp({
        id: 'remote-multi',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });
      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOp({ id: 'local-1', entityId: 'task-1' })],
          remoteOps: [remoteOp],
          suggestedResolution: 'manual',
        },
        {
          entityType: 'TASK',
          entityId: 'task-2',
          localOps: [createOp({ id: 'local-2', entityId: 'task-2' })],
          remoteOps: [remoteOp],
          suggestedResolution: 'manual',
        },
      ];
      conflictResolutionServiceSpy.checkOpForConflicts.and.resolveTo({
        isSupersededOrDuplicate: false,
        conflicts,
      });

      const result = await service.detectConflicts([remoteOp], new Map());

      expect(result.conflicts.map((conflict) => conflict.entityId)).toEqual([
        'task-1',
        'task-2',
      ]);
      expect(result.nonConflicting).toEqual([]);
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

    it('should durably merge clocks before apply and checkpoint them with reducer status', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'remote-1', vectorClock: { remoteClient: 1 } }),
      ];

      opLogStoreSpy.hasOp.and.returnValue(Promise.resolve(false));
      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: remoteOps };
      });

      await service.applyNonConflictingOps(remoteOps);

      expect(opLogStoreSpy.mergeRemoteOpClocks).toHaveBeenCalledWith(remoteOps);
      expect(opLogStoreSpy.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
        [1],
        remoteOps,
      );
    });

    it('should flush deferred actions after remote clocks are merged while reusing caller lock', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'remote-1', vectorClock: { remoteClient: 1 } }),
      ];
      const callOrder: string[] = [];

      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        callOrder.push('applyOperations');
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: remoteOps };
      });
      opLogStoreSpy.mergeRemoteOpClocks.and.callFake(async () => {
        callOrder.push('mergeRemoteOpClocks');
      });
      opLogStoreSpy.markReducersCommittedAndMergeClocks.and.callFake(async () => {
        callOrder.push('checkpointReducersAndClocks');
      });
      opLogStoreSpy.markApplied.and.callFake(async () => {
        callOrder.push('markApplied');
      });
      operationLogEffectsSpy.processDeferredActions.and.callFake(async () => {
        callOrder.push('processDeferredActions');
      });

      await service.applyNonConflictingOps(remoteOps, true);

      expect(operationApplierServiceSpy.applyOperations).toHaveBeenCalledWith(
        remoteOps,
        jasmine.objectContaining({
          skipDeferredLocalActions: true,
          onReducersCommitted: jasmine.any(Function),
        }),
      );
      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
      expect(callOrder).toEqual([
        'mergeRemoteOpClocks',
        'applyOperations',
        'checkpointReducersAndClocks',
        'markApplied',
        'processDeferredActions',
      ]);
    });

    it('should NOT checkpoint reducers or clocks when no ops are applied', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'remote-1', vectorClock: { remoteClient: 1 } }),
      ];

      // All ops are duplicates (appendBatchSkipDuplicates returns empty writtenOps)
      opLogStoreSpy.appendBatchSkipDuplicates.and.returnValue(
        Promise.resolve({ seqs: [], writtenOps: [], skippedCount: 1 }),
      );

      await service.applyNonConflictingOps(remoteOps);

      expect(opLogStoreSpy.mergeRemoteOpClocks).not.toHaveBeenCalled();
      expect(opLogStoreSpy.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
    });

    it('should charge only the attempted archive failure and run validation', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'op-1' }),
        createFullOp({ id: 'op-2' }),
        createFullOp({ id: 'op-3' }),
      ];

      opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
      opLogStoreSpy.markApplied.and.returnValue(Promise.resolve());
      opLogStoreSpy.markFailed.and.returnValue(Promise.resolve());
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [remoteOps[0]],
          failedOp: { op: remoteOps[1], error: new Error('Test error') },
        };
      });

      await expectAsync(service.applyNonConflictingOps(remoteOps)).toBeRejected();

      expect(opLogStoreSpy.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
        [1, 2, 3],
        remoteOps,
      );
      expect(opLogStoreSpy.markFailed).toHaveBeenCalledWith(['op-2']);
      // Should run validation after partial failure
      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'partial-apply-failure',
        { callerHoldsLock: false },
      );
    });

    it('should preserve the incomplete-remote error when the deferred drain also fails', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'op-1' }),
        createFullOp({ id: 'op-2' }),
      ];
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [remoteOps[0]],
          failedOp: { op: remoteOps[1], error: new Error('archive failed') },
        };
      });
      operationLogEffectsSpy.processDeferredActions.and.rejectWith(
        new Error('deferred drain failed'),
      );

      let thrown: unknown;
      try {
        await service.applyNonConflictingOps(remoteOps);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(IncompleteRemoteOperationsError);
      expect((thrown as Error).message).toBe('archive failed');
    });

    it('should not start apply or drain deferred actions when the pre-apply clock merge fails', async () => {
      const remoteOps: Operation[] = [createFullOp({ id: 'remote-1' })];
      const clockError = new Error('clock merge failed');
      opLogStoreSpy.mergeRemoteOpClocks.and.rejectWith(clockError);

      await expectAsync(service.applyNonConflictingOps(remoteOps, true)).toBeRejectedWith(
        clockError,
      );

      expect(operationApplierServiceSpy.applyOperations).not.toHaveBeenCalled();
      expect(opLogStoreSpy.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
      expect(operationLogEffectsSpy.processDeferredActions).not.toHaveBeenCalled();
    });

    it('should drain deferred actions when the reducer+clock checkpoint fails after the clock merge', async () => {
      const remoteOps: Operation[] = [createFullOp({ id: 'remote-1' })];
      const checkpointError = new Error('checkpoint failed');
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      opLogStoreSpy.markReducersCommittedAndMergeClocks.and.rejectWith(checkpointError);

      await expectAsync(service.applyNonConflictingOps(remoteOps, true)).toBeRejectedWith(
        checkpointError,
      );

      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
    });

    it('should drain deferred actions when reducer dispatch fails after the clock merge', async () => {
      const remoteOps: Operation[] = [createFullOp({ id: 'remote-1' })];
      const dispatchError = new Error('dispatcher failed');
      operationApplierServiceSpy.applyOperations.and.rejectWith(dispatchError);

      await expectAsync(service.applyNonConflictingOps(remoteOps, true)).toBeRejectedWith(
        dispatchError,
      );

      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
    });

    it('should drain deferred actions when bookkeeping fails after the reducer+clock checkpoint', async () => {
      const remoteOps: Operation[] = [createFullOp({ id: 'remote-1' })];
      const markAppliedError = new Error('mark applied failed');
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      opLogStoreSpy.markApplied.and.rejectWith(markAppliedError);

      await expectAsync(service.applyNonConflictingOps(remoteOps, true)).toBeRejectedWith(
        markAppliedError,
      );

      expect(operationLogEffectsSpy.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
    });

    it('should preserve a bookkeeping error when the deferred drain also fails', async () => {
      const remoteOps: Operation[] = [createFullOp({ id: 'remote-1' })];
      const markAppliedError = new Error('mark applied failed');
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      opLogStoreSpy.markApplied.and.rejectWith(markAppliedError);
      operationLogEffectsSpy.processDeferredActions.and.rejectWith(
        new Error('deferred drain failed'),
      );

      await expectAsync(service.applyNonConflictingOps(remoteOps)).toBeRejectedWith(
        markAppliedError,
      );
    });

    it('should flip the session-validation latch when partial-failure validation fails', async () => {
      const remoteOps: Operation[] = [
        createFullOp({ id: 'op-1' }),
        createFullOp({ id: 'op-2' }),
      ];

      opLogStoreSpy.markFailed.and.resolveTo();
      operationApplierServiceSpy.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [remoteOps[0]],
          failedOp: { op: remoteOps[1], error: new Error('Test error') },
        };
      });
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(false);

      const latch = TestBed.inject(SyncSessionValidationService);
      latch._resetForTest();

      await expectAsync(
        latch.withSession(async () => {
          await service.applyNonConflictingOps(remoteOps);
        }),
      ).toBeRejected();

      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'partial-apply-failure',
        { callerHoldsLock: false },
      );
      expect(latch.hasFailed()).toBe(true);
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
        operationApplierServiceSpy.applyOperations.and.callFake(
          applyAllWithReducerCommit,
        );

        await service.applyNonConflictingOps(remoteOps);

        // Should call appendBatchSkipDuplicates exactly once (no retry needed)
        expect(opLogStoreSpy.appendBatchSkipDuplicates).toHaveBeenCalledTimes(1);
        // Should apply only the non-duplicate op
        expect(operationApplierServiceSpy.applyOperations).toHaveBeenCalledWith(
          [remoteOps[1]],
          jasmine.objectContaining({
            skipDeferredLocalActions: true,
            onReducersCommitted: jasmine.any(Function),
          }),
        );
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

    // ═══════════════════════════════════════════════════════════════════════
    // BUG CONFIRMATION TEST (Issue #6571)
    // ═══════════════════════════════════════════════════════════════════════

    it('Bug #6571: should surface validation failure via snackbar', async () => {
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(false);

      // FIXED: Should show warning snackbar when validation fails
      await service.validateAfterSync();

      expect(validateStateServiceSpy.validateAndRepairCurrentState).toHaveBeenCalled();
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Issue #7330: validation failure must propagate up to sync status so
    // the sync wrapper can refuse to claim IN_SYNC. Previously the boolean
    // result was only used to drive a snackbar — sync still reported IN_SYNC.
    // ═══════════════════════════════════════════════════════════════════════

    it('returns true when validation passes', async () => {
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(true);

      const result = await service.validateAfterSync();

      expect(result).toBe(true);
    });

    it('returns false when validation fails', async () => {
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(false);

      const result = await service.validateAfterSync();

      expect(result).toBe(false);
    });

    it('processRemoteOps flips the session-validation latch when validation fails on the no-conflict path', async () => {
      const remoteOps: Operation[] = [{ id: 'op1', schemaVersion: 1 } as Operation];

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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);
      spyOn(service, 'detectConflicts').and.resolveTo({
        nonConflicting: remoteOps,
        conflicts: [],
      });
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(false);

      const latch = TestBed.inject(SyncSessionValidationService);
      latch._resetForTest();
      await latch.withSession(async () => {
        await service.processRemoteOps(remoteOps);
      });

      expect(latch.hasFailed()).toBe(true);
    });

    it('processRemoteOps leaves the latch reset when validation succeeds', async () => {
      const remoteOps: Operation[] = [{ id: 'op1', schemaVersion: 1 } as Operation];

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
      operationApplierServiceSpy.applyOperations.and.callFake(applyAllWithReducerCommit);
      spyOn(service, 'detectConflicts').and.resolveTo({
        nonConflicting: remoteOps,
        conflicts: [],
      });
      validateStateServiceSpy.validateAndRepairCurrentState.and.resolveTo(true);

      const latch = TestBed.inject(SyncSessionValidationService);
      latch._resetForTest();
      await latch.withSession(async () => {
        await service.processRemoteOps(remoteOps);
      });

      expect(latch.hasFailed()).toBe(false);
    });
  });
});

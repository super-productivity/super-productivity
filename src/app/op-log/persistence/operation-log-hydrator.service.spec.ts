import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogHydratorService } from './operation-log-hydrator.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { MigratableStateCache } from './schema-migration.service';
import { OperationLogMigrationService } from './operation-log-migration.service';
import {
  SchemaMigrationService,
  CURRENT_SCHEMA_VERSION,
} from './schema-migration.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { RepairOperationService } from '../validation/repair-operation.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { OperationLogSnapshotService } from './operation-log-snapshot.service';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { SyncHydrationService } from './sync-hydration.service';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { bulkApplyHydrationOperations } from '../apply/bulk-hydration.action';

describe('OperationLogHydratorService', () => {
  let service: OperationLogHydratorService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockMigrationService: jasmine.SpyObj<OperationLogMigrationService>;
  let mockSchemaMigrationService: jasmine.SpyObj<SchemaMigrationService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockRepairOperationService: jasmine.SpyObj<RepairOperationService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockOperationApplierService: jasmine.SpyObj<OperationApplierService>;
  let mockHydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let mockSnapshotService: jasmine.SpyObj<OperationLogSnapshotService>;
  let mockRecoveryService: jasmine.SpyObj<OperationLogRecoveryService>;
  let mockSyncHydrationService: jasmine.SpyObj<SyncHydrationService>;

  const mockState = {
    task: { entities: {}, ids: [] },
    project: { entities: {}, ids: [] },
    globalConfig: {},
  } as any;

  const createMockSnapshot = (
    overrides: Partial<MigratableStateCache> = {},
  ): MigratableStateCache => ({
    state: mockState,
    lastAppliedOpSeq: 10,
    vectorClock: { clientA: 5 },
    compactedAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...overrides,
  });

  const createMockOperation = (
    id: string,
    opType: OpType = OpType.Update,
    overrides: Partial<Operation> = {},
  ): Operation => ({
    id,
    actionType: '[Task] Update Task' as ActionType,
    opType,
    entityType: 'TASK',
    entityId: 'task-123',
    payload: { title: 'Test' },
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...overrides,
  });

  const createMockEntry = (seq: number, op: Operation): OperationLogEntry => ({
    seq,
    op,
    appliedAt: Date.now(),
    source: 'local',
  });

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'loadStateCache',
      'saveStateCache',
      'getOpsAfterSeq',
      'getLastSeq',
      'hasStateCacheBackup',
      'restoreStateCacheFromBackup',
      'saveStateCacheBackup',
      'clearStateCacheBackup',
      'append',
      'getPendingRemoteOps',
      'markApplied',
      'getFailedRemoteOps',
      'markFailed',
      'getVectorClock',
      'setVectorClock',
      'mergeRemoteOpClocks',
      'setProtectedClientIds',
      'getProtectedClientIds',
      'getLatestFullStateOp',
    ]);
    mockMigrationService = jasmine.createSpyObj('OperationLogMigrationService', [
      'checkAndMigrate',
    ]);
    mockSchemaMigrationService = jasmine.createSpyObj('SchemaMigrationService', [
      'needsMigration',
      'migrateStateIfNeeded',
      'operationNeedsMigration',
      'migrateOperations',
    ]);
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
    ]);
    mockRepairOperationService = jasmine.createSpyObj('RepairOperationService', [
      'createRepairOperation',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockOperationApplierService = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockHydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
    ]);
    mockSnapshotService = jasmine.createSpyObj('OperationLogSnapshotService', [
      'isValidSnapshot',
      'migrateSnapshotWithBackup',
      'saveCurrentStateAsSnapshot',
    ]);
    mockRecoveryService = jasmine.createSpyObj('OperationLogRecoveryService', [
      'recoverPendingRemoteOps',
      'cleanupCorruptOps',
      'attemptRecovery',
    ]);
    mockSyncHydrationService = jasmine.createSpyObj('SyncHydrationService', [
      'hydrateFromRemoteSync',
    ]);

    // Default mock implementations
    mockOpLogStore.getVectorClock.and.returnValue(Promise.resolve(null));
    mockOpLogStore.setVectorClock.and.returnValue(Promise.resolve());
    mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
    mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
    mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(0));
    mockOpLogStore.hasStateCacheBackup.and.returnValue(Promise.resolve(false));
    mockOpLogStore.saveStateCacheBackup.and.returnValue(Promise.resolve());
    mockOpLogStore.restoreStateCacheFromBackup.and.returnValue(Promise.resolve());
    mockOpLogStore.clearStateCacheBackup.and.returnValue(Promise.resolve());
    mockOpLogStore.saveStateCache.and.returnValue(Promise.resolve());
    mockOpLogStore.getPendingRemoteOps.and.returnValue(Promise.resolve([]));
    mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve([]));
    mockOpLogStore.markApplied.and.returnValue(Promise.resolve());
    mockOpLogStore.markFailed.and.returnValue(Promise.resolve());
    mockOpLogStore.mergeRemoteOpClocks.and.returnValue(Promise.resolve());
    mockOpLogStore.setProtectedClientIds.and.returnValue(Promise.resolve());
    // Default: No protected client IDs and no full-state ops (fresh install or no imports yet)
    mockOpLogStore.getProtectedClientIds.and.returnValue(Promise.resolve([]));
    mockOpLogStore.getLatestFullStateOp.and.returnValue(Promise.resolve(undefined));
    mockOperationApplierService.applyOperations.and.returnValue(
      Promise.resolve({ appliedOps: [] }),
    );
    mockMigrationService.checkAndMigrate.and.returnValue(Promise.resolve());
    mockSchemaMigrationService.needsMigration.and.returnValue(false);
    mockSchemaMigrationService.operationNeedsMigration.and.returnValue(false);
    mockSchemaMigrationService.migrateOperations.and.callFake((ops) => ops);
    mockValidateStateService.validateAndRepair.and.returnValue({
      isValid: true,
      wasRepaired: false,
    });
    mockStateSnapshotService.getStateSnapshot.and.returnValue(mockState);
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ clientA: 5 }),
    );
    mockSnapshotService.isValidSnapshot.and.returnValue(true);
    mockSnapshotService.migrateSnapshotWithBackup.and.callFake(async (s) => s);
    mockSnapshotService.saveCurrentStateAsSnapshot.and.returnValue(Promise.resolve());
    mockRecoveryService.recoverPendingRemoteOps.and.returnValue(Promise.resolve());
    mockRecoveryService.cleanupCorruptOps.and.returnValue(Promise.resolve());
    mockRecoveryService.attemptRecovery.and.returnValue(Promise.resolve());
    mockSyncHydrationService.hydrateFromRemoteSync.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        OperationLogHydratorService,
        { provide: Store, useValue: mockStore },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: OperationLogMigrationService, useValue: mockMigrationService },
        { provide: SchemaMigrationService, useValue: mockSchemaMigrationService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: ValidateStateService, useValue: mockValidateStateService },
        { provide: RepairOperationService, useValue: mockRepairOperationService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: OperationApplierService, useValue: mockOperationApplierService },
        { provide: HydrationStateService, useValue: mockHydrationStateService },
        { provide: OperationLogSnapshotService, useValue: mockSnapshotService },
        { provide: OperationLogRecoveryService, useValue: mockRecoveryService },
        { provide: SyncHydrationService, useValue: mockSyncHydrationService },
      ],
    });

    service = TestBed.inject(OperationLogHydratorService);
  });

  describe('hydrateStore', () => {
    describe('fresh install', () => {
      it('should handle fresh install with no data', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

        await service.hydrateStore();

        expect(mockStore.dispatch).not.toHaveBeenCalled();
      });

      it('should check for migration when no snapshot exists', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

        await service.hydrateStore();

        expect(mockMigrationService.checkAndMigrate).toHaveBeenCalled();
      });
    });

    describe('snapshot loading', () => {
      it('should load snapshot and dispatch to store', async () => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: mockState }),
        );
      });

      it('should skip synchronous validation when schema version matches (trust optimization)', async () => {
        // With schema-version trust, we skip sync validation when versions match
        const snapshot = createMockSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        // Should NOT call validateAndRepair synchronously (trusted snapshot)
        expect(mockValidateStateService.validateAndRepair).not.toHaveBeenCalled();
      });

      it('should validate snapshot state when schema version is missing', async () => {
        // When schema version is missing/undefined, we must validate
        const snapshot = createMockSnapshot({ schemaVersion: undefined });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockValidateStateService.validateAndRepair).toHaveBeenCalledWith(
          mockState,
        );
      });

      it('should validate snapshot state when schema version mismatches', async () => {
        // When schema version differs from current, we must validate
        const snapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION - 1,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        // Mark that migration ran
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue({
          ...snapshot,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        });

        await service.hydrateStore();

        expect(mockValidateStateService.validateAndRepair).toHaveBeenCalled();
      });

      // SKIPPED: Repair system is disabled for debugging archive subtask loss
      xit('should dispatch repaired state if validation repairs it', async () => {
        // Use mismatched schema version to trigger validation
        const snapshot = createMockSnapshot({ schemaVersion: undefined });
        const repairedState = { ...mockState, repaired: true };
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockValidateStateService.validateAndRepair.and.returnValue({
          isValid: false,
          wasRepaired: true,
          repairedState,
          repairSummary: { entityStateFixed: 1 } as any,
        });

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: repairedState }),
        );
      });

      // SKIPPED: Repair system is disabled for debugging archive subtask loss
      xit('should create repair operation when state is repaired', async () => {
        // Use mismatched schema version to trigger validation
        const snapshot = createMockSnapshot({ schemaVersion: undefined });
        const repairedState = { ...mockState, repaired: true };
        const repairSummary = { entityStateFixed: 1 } as any;
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockValidateStateService.validateAndRepair.and.returnValue({
          isValid: false,
          wasRepaired: true,
          repairedState,
          repairSummary,
        });

        await service.hydrateStore();

        expect(mockRepairOperationService.createRepairOperation).toHaveBeenCalledWith(
          repairedState,
          repairSummary,
          'test-client',
        );
      });

      it('should restore vector clock from snapshot to vector clock store', async () => {
        // This test verifies the fix for the bug where vector clock was not restored
        // from snapshot during hydration, causing new ops to have incomplete clocks
        const snapshotClock = { clientA: 5, clientB: 3 };
        const snapshot = createMockSnapshot({ vectorClock: snapshotClock });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(snapshotClock);
      });

      it('should not restore empty vector clock from snapshot', async () => {
        const snapshot = createMockSnapshot({ vectorClock: {} });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockOpLogStore.setVectorClock).not.toHaveBeenCalled();
      });
    });

    describe('tail operation replay', () => {
      it('should replay tail operations after snapshot', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = [
          createMockEntry(6, createMockOperation('op-6')),
          createMockEntry(7, createMockOperation('op-7')),
        ];
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));

        await service.hydrateStore();

        // First dispatch is snapshot, second is bulk hydration
        expect(mockStore.dispatch).toHaveBeenCalledTimes(2);
        // Tail ops are replayed via bulk dispatch for performance
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({ operations: tailOps.map((e) => e.op) }),
        );
        // Hydration state is managed around the dispatch
        expect(mockHydrationStateService.startApplyingRemoteOps).toHaveBeenCalled();
        expect(mockHydrationStateService.endApplyingRemoteOps).toHaveBeenCalled();
      });

      it('should request ops after snapshot sequence', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 42 });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

        await service.hydrateStore();

        expect(mockOpLogStore.getOpsAfterSeq).toHaveBeenCalledWith(42);
      });

      it('should save new snapshot after replaying many ops', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = Array.from({ length: 15 }, (_, i) =>
          createMockEntry(6 + i, createMockOperation(`op-${6 + i}`)),
        );
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(20));

        await service.hydrateStore();

        expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalled();
      });

      it('should not save snapshot after replaying few ops', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = [
          createMockEntry(6, createMockOperation('op-6')),
          createMockEntry(7, createMockOperation('op-7')),
        ];
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));

        await service.hydrateStore();

        expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
      });

      it('should merge tail ops clocks into local clock after replay', async () => {
        // This test verifies that tail ops' clocks are merged into local clock
        // after replay to ensure subsequent ops have clocks that dominate them
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const op1 = createMockOperation('op-6', OpType.Update, {
          vectorClock: { clientA: 6 },
        });
        const op2 = createMockOperation('op-7', OpType.Update, {
          vectorClock: { clientA: 6, clientB: 2 },
        });
        const tailOps = [createMockEntry(6, op1), createMockEntry(7, op2)];
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));

        await service.hydrateStore();

        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([op1, op2]);
      });

      it('should validate state BEFORE saving snapshot (regression test)', async () => {
        // This tests the fix for the bug where snapshot was saved before validation.
        // If validation repairs the state, saving snapshot first would persist corrupted state.
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = Array.from({ length: 15 }, (_, i) =>
          createMockEntry(6 + i, createMockOperation(`op-${6 + i}`)),
        );
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(20));

        // Track order of operations
        const callOrder: string[] = [];
        mockValidateStateService.validateAndRepair.and.callFake(() => {
          callOrder.push('validate');
          return { isValid: true, wasRepaired: false };
        });
        mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
          callOrder.push('saveSnapshot');
          return Promise.resolve();
        });

        await service.hydrateStore();

        // Validate should be called before saveSnapshot
        const validateIndex = callOrder.indexOf('validate');
        const saveIndex = callOrder.indexOf('saveSnapshot');
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(saveIndex).toBeGreaterThanOrEqual(0);
        expect(validateIndex).toBeLessThan(saveIndex);
      });
    });

    describe('full state operations optimization', () => {
      it('should load SyncImport operation directly without replay', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportPayload = { task: {}, project: {} };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, syncImportOp)]),
        );

        await service.hydrateStore();

        // Should dispatch snapshot first, then loadAllData with sync import
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: syncImportPayload as any }),
        );
      });

      it('should load Repair operation directly without replay', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const repairPayload = { task: {}, project: {} };
        const repairOp = createMockOperation('repair-op', OpType.Repair, {
          payload: { appDataComplete: repairPayload },
          entityType: 'ALL',
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, repairOp)]),
        );

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: repairPayload as any }),
        );
      });

      it('should merge full-state op clock into local clock after direct load', async () => {
        // When loading a SyncImport directly, its clock should be merged
        // to ensure subsequent ops have clocks that dominate it
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportPayload = { task: {}, project: {} };
        const syncClock = { clientA: 10, clientB: 5 };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          vectorClock: syncClock,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, syncImportOp)]),
        );

        await service.hydrateStore();

        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([syncImportOp]);
      });

      it('should merge SYNC_IMPORT clock BEFORE dispatching loadAllData (regression test for stale clock bug)', async () => {
        // REGRESSION TEST: Bug where operations created during loadAllData got stale clocks
        // because mergeRemoteOpClocks was called AFTER store.dispatch(loadAllData).
        //
        // Scenario:
        // 1. Snapshot has old clock {clientA: 5}
        // 2. SYNC_IMPORT has newer clock {clientA: 5, clientB: 10}
        // 3. loadAllData triggers reducer that creates operation
        // 4. Operation should have clock from SYNC_IMPORT (with clientB), not snapshot
        //
        // Fix: mergeRemoteOpClocks must be called BEFORE store.dispatch(loadAllData)
        const snapshot = createMockSnapshot({
          lastAppliedOpSeq: 5,
          vectorClock: { clientA: 5 }, // Old clock
        });
        const syncImportPayload = { task: {}, project: {} };
        const syncClock = { clientA: 5, clientB: 10 }; // Newer clock with clientB
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          vectorClock: syncClock,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, syncImportOp)]),
        );

        // Track order of operations using a shared counter
        let callSequence = 0;
        let mergeClockSequence = -1;
        let loadAllDataSyncImportSequence = -1;

        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          mergeClockSequence = callSequence++;
        });

        // Track dispatch order for the specific loadAllData call we care about
        mockStore.dispatch.and.callFake(((action: any) => {
          if (
            action &&
            action.type === loadAllData.type &&
            action.appDataComplete === syncImportPayload
          ) {
            loadAllDataSyncImportSequence = callSequence++;
          }
        }) as any);

        await service.hydrateStore();

        // CRITICAL: mergeRemoteOpClocks MUST be called BEFORE loadAllData with SYNC_IMPORT payload
        expect(mergeClockSequence).toBeGreaterThanOrEqual(
          0,
          'mergeRemoteOpClocks should have been called',
        );
        expect(loadAllDataSyncImportSequence).toBeGreaterThanOrEqual(
          0,
          'loadAllData with SYNC_IMPORT should have been called',
        );
        expect(mergeClockSequence).toBeLessThan(
          loadAllDataSyncImportSequence,
          `mergeRemoteOpClocks (seq ${mergeClockSequence}) should be called BEFORE ` +
            `loadAllData (seq ${loadAllDataSyncImportSequence}) to prevent stale clock bug`,
        );
      });

      it('should merge clock BEFORE loadAllData in NO-SNAPSHOT branch (regression test)', async () => {
        // REGRESSION TEST: Same bug as above, but in the no-snapshot code path.
        // When there's no snapshot and we load a SYNC_IMPORT from the log directly,
        // the clock merge must happen BEFORE loadAllData.
        //
        // This tests the fix at lines 275-285 in operation-log-hydrator.service.ts
        const syncImportPayload = { task: {}, project: {} };
        const syncClock = { clientA: 5, clientB: 10 };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          vectorClock: syncClock,
        });

        // No snapshot - triggers the no-snapshot branch
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        // Return ops from getOpsAfterSeq(0) - simulating a log with just a SYNC_IMPORT
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(1, syncImportOp)]),
        );

        let callSequence = 0;
        let mergeClockSequence = -1;
        let loadAllDataSequence = -1;

        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          mergeClockSequence = callSequence++;
        });

        mockStore.dispatch.and.callFake(((action: any) => {
          if (
            action &&
            action.type === loadAllData.type &&
            action.appDataComplete === syncImportPayload
          ) {
            loadAllDataSequence = callSequence++;
          }
        }) as any);

        await service.hydrateStore();

        expect(mergeClockSequence).toBeGreaterThanOrEqual(
          0,
          'mergeRemoteOpClocks should have been called',
        );
        expect(loadAllDataSequence).toBeGreaterThanOrEqual(
          0,
          'loadAllData should have been called',
        );
        expect(mergeClockSequence).toBeLessThan(
          loadAllDataSequence,
          `mergeRemoteOpClocks (seq ${mergeClockSequence}) should be called BEFORE ` +
            `loadAllData (seq ${loadAllDataSequence}) in no-snapshot branch`,
        );
      });

      it('should merge BACKUP_IMPORT clock BEFORE loadAllData (regression test)', async () => {
        // REGRESSION TEST: Same fix applies to BACKUP_IMPORT operations.
        // BACKUP_IMPORT is a full-state operation like SYNC_IMPORT and has the same
        // stale clock bug if mergeRemoteOpClocks happens after loadAllData.
        const snapshot = createMockSnapshot({
          lastAppliedOpSeq: 5,
          vectorClock: { clientA: 5 },
        });
        const backupImportPayload = { task: {}, project: {} };
        const backupClock = { clientA: 5, clientB: 10 };
        const backupImportOp = createMockOperation('backup-op', OpType.BackupImport, {
          payload: { appDataComplete: backupImportPayload },
          entityType: 'ALL',
          vectorClock: backupClock,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, backupImportOp)]),
        );

        let callSequence = 0;
        let mergeClockSequence = -1;
        let loadAllDataSequence = -1;

        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          mergeClockSequence = callSequence++;
        });

        mockStore.dispatch.and.callFake(((action: any) => {
          if (
            action &&
            action.type === loadAllData.type &&
            action.appDataComplete === backupImportPayload
          ) {
            loadAllDataSequence = callSequence++;
          }
        }) as any);

        await service.hydrateStore();

        expect(mergeClockSequence).toBeGreaterThanOrEqual(
          0,
          'mergeRemoteOpClocks should have been called for BACKUP_IMPORT',
        );
        expect(loadAllDataSequence).toBeGreaterThanOrEqual(
          0,
          'loadAllData should have been called for BACKUP_IMPORT',
        );
        expect(mergeClockSequence).toBeLessThan(
          loadAllDataSequence,
          `mergeRemoteOpClocks (seq ${mergeClockSequence}) should be called BEFORE ` +
            `loadAllData (seq ${loadAllDataSequence}) for BACKUP_IMPORT`,
        );
      });
    });

    describe('protected client IDs for vector clock pruning', () => {
      // These tests verify the fix for the vector clock pruning bug where
      // SYNC_IMPORT/BACKUP_IMPORT/REPAIR client IDs were not protected during
      // hydration, causing them to be pruned from new operations' vector clocks.
      // This resulted in new ops appearing CONCURRENT with the import instead of
      // GREATER_THAN, causing sync to reject them.

      it('should set protected client IDs from vectorClock when loading SYNC_IMPORT as last tail op', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportPayload = { task: {}, project: {} };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          clientId: 'import-client-123',
          // FIX: Include multiple clients in vectorClock to verify ALL are protected
          vectorClock: { import_client_123: 1, other_client: 5 },
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, syncImportOp)]),
        );

        await service.hydrateStore();

        // Should protect ALL client IDs in the vectorClock, not just the import's clientId
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['import_client_123', 'other_client']),
        );
      });

      it('should set protected client IDs from vectorClock when loading BACKUP_IMPORT as last tail op', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const backupImportPayload = { task: {}, project: {} };
        const backupImportOp = createMockOperation('backup-op', OpType.BackupImport, {
          payload: { appDataComplete: backupImportPayload },
          entityType: 'ALL',
          clientId: 'backup-client-456',
          vectorClock: { backup_client_456: 1, previous_client: 10 },
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, backupImportOp)]),
        );

        await service.hydrateStore();

        // Should protect ALL client IDs in the vectorClock
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['backup_client_456', 'previous_client']),
        );
      });

      it('should set protected client IDs from vectorClock when loading REPAIR as last tail op', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const repairPayload = { task: {}, project: {} };
        const repairOp = createMockOperation('repair-op', OpType.Repair, {
          payload: { appDataComplete: repairPayload },
          entityType: 'ALL',
          clientId: 'repair-client-789',
          vectorClock: { repair_client_789: 1, synced_client: 20 },
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, repairOp)]),
        );

        await service.hydrateStore();

        // Should protect ALL client IDs in the vectorClock
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['repair_client_789', 'synced_client']),
        );
      });

      it('should set protected client IDs from vectorClock when replaying tail ops containing SYNC_IMPORT', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        // Mix of regular ops and a SYNC_IMPORT somewhere in the middle
        const regularOp1 = createMockOperation('op-1', OpType.Update, {
          clientId: 'regular-client',
        });
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: { task: {} } },
          entityType: 'ALL',
          clientId: 'import-client-middle',
          vectorClock: { import_client_middle: 1, legacy_client: 100 },
        });
        const regularOp2 = createMockOperation('op-2', OpType.Update, {
          clientId: 'regular-client',
        });
        // Make sure the last op is NOT a full-state op to trigger the replay path
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(6, regularOp1),
            createMockEntry(7, syncImportOp),
            createMockEntry(8, regularOp2),
          ]),
        );

        await service.hydrateStore();

        // Should protect ALL client IDs in the SYNC_IMPORT's vectorClock (found via reverse search)
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['import_client_middle', 'legacy_client']),
        );
      });

      it('should set protected client IDs from LAST full-state op vectorClock when multiple exist in tail ops', async () => {
        // When multiple full-state ops exist, only the LAST one matters
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportOp1 = createMockOperation('sync-op-1', OpType.SyncImport, {
          payload: { appDataComplete: { task: {} } },
          entityType: 'ALL',
          clientId: 'first-import-client',
          vectorClock: { first_import_client: 1, old_client: 5 },
        });
        const syncImportOp2 = createMockOperation('sync-op-2', OpType.SyncImport, {
          payload: { appDataComplete: { task: {} } },
          entityType: 'ALL',
          clientId: 'second-import-client',
          vectorClock: { second_import_client: 1, another_client: 10 },
        });
        const regularOp = createMockOperation('op-1', OpType.Update, {
          clientId: 'regular-client',
        });

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        // Last op is regular, so we go through replay path
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(6, syncImportOp1), // First import
            createMockEntry(7, syncImportOp2), // Second import (should be protected)
            createMockEntry(8, regularOp), // Last is regular
          ]),
        );

        await service.hydrateStore();

        // Should protect ALL client IDs from the SECOND (last) import's vectorClock
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['second_import_client', 'another_client']),
        );
      });

      it('should NOT call setProtectedClientIds when no full-state ops in tail ops', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const regularOp1 = createMockOperation('op-1', OpType.Update, {
          clientId: 'client-a',
        });
        const regularOp2 = createMockOperation('op-2', OpType.Create, {
          clientId: 'client-b',
        });

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(6, regularOp1),
            createMockEntry(7, regularOp2),
          ]),
        );

        await service.hydrateStore();

        // No full-state ops, so setProtectedClientIds should not be called
        expect(mockOpLogStore.setProtectedClientIds).not.toHaveBeenCalled();
      });

      it('should set protected client IDs from vectorClock in no-snapshot full-state path (SYNC_IMPORT)', async () => {
        // No snapshot - triggers the no-snapshot branch
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const syncImportPayload = { task: {}, project: {} };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          clientId: 'no-snapshot-import-client',
          vectorClock: { no_snapshot_import_client: 1, migrated_client: 50 },
        });

        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(1, syncImportOp)]),
        );

        await service.hydrateStore();

        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['no_snapshot_import_client', 'migrated_client']),
        );
      });

      it('should set protected client IDs from vectorClock in no-snapshot replay path containing SYNC_IMPORT', async () => {
        // No snapshot - triggers the no-snapshot branch
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: { task: {} } },
          entityType: 'ALL',
          clientId: 'replay-import-client',
          vectorClock: { replay_import_client: 1, archived_client: 200 },
        });
        const regularOp = createMockOperation('op-1', OpType.Update, {
          clientId: 'regular-client',
        });

        // Last op is regular, so we go through replay path
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(1, syncImportOp),
            createMockEntry(2, regularOp),
          ]),
        );
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));

        await service.hydrateStore();

        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['replay_import_client', 'archived_client']),
        );
      });

      it('should NOT call setProtectedClientIds in no-snapshot replay when no full-state ops', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const regularOp1 = createMockOperation('op-1', OpType.Update, {
          clientId: 'client-a',
        });
        const regularOp2 = createMockOperation('op-2', OpType.Create, {
          clientId: 'client-b',
        });

        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(1, regularOp1),
            createMockEntry(2, regularOp2),
          ]),
        );
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));

        await service.hydrateStore();

        expect(mockOpLogStore.setProtectedClientIds).not.toHaveBeenCalled();
      });

      it('should call setProtectedClientIds AFTER mergeRemoteOpClocks (correct order)', async () => {
        // The protected client ID must be set after merging clocks to ensure
        // the local clock contains all necessary entries before protection takes effect
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportPayload = { task: {}, project: {} };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          clientId: 'import-client',
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(6, syncImportOp)]),
        );

        let callSequence = 0;
        let mergeClockSequence = -1;
        let setProtectedSequence = -1;

        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          mergeClockSequence = callSequence++;
        });
        mockOpLogStore.setProtectedClientIds.and.callFake(async () => {
          setProtectedSequence = callSequence++;
        });

        await service.hydrateStore();

        expect(mergeClockSequence).toBeGreaterThanOrEqual(
          0,
          'mergeRemoteOpClocks should have been called',
        );
        expect(setProtectedSequence).toBeGreaterThanOrEqual(
          0,
          'setProtectedClientIds should have been called',
        );
        expect(mergeClockSequence).toBeLessThan(
          setProtectedSequence,
          `mergeRemoteOpClocks (seq ${mergeClockSequence}) should be called BEFORE ` +
            `setProtectedClientIds (seq ${setProtectedSequence})`,
        );
      });
    });

    describe('protected client IDs migration', () => {
      // Tests for the migration that handles old SYNC_IMPORT ops processed before
      // the protectedClientIds fix was deployed

      it('should migrate protectedClientIds from existing SYNC_IMPORT vectorClock when empty', async () => {
        const snapshot = createMockSnapshot();
        const syncImportOp = createMockOperation('old-import-op', OpType.SyncImport, {
          clientId: 'legacy-import-client',
          entityType: 'ALL',
          payload: { appDataComplete: { task: {}, project: {} } },
          vectorClock: { legacy_import_client: 1, old_device: 30 },
        });

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
        // Simulate: protectedClientIds is empty (old data, never set)
        mockOpLogStore.getProtectedClientIds.and.returnValue(Promise.resolve([]));
        // Simulate: there IS a SYNC_IMPORT in the ops log
        mockOpLogStore.getLatestFullStateOp.and.returnValue(
          Promise.resolve(syncImportOp),
        );

        await service.hydrateStore();

        // Migration should protect ALL client IDs from the SYNC_IMPORT's vectorClock
        expect(mockOpLogStore.getProtectedClientIds).toHaveBeenCalled();
        expect(mockOpLogStore.getLatestFullStateOp).toHaveBeenCalled();
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['legacy_import_client', 'old_device']),
        );
      });

      it('should NOT migrate when protectedClientIds already contains all vectorClock keys', async () => {
        const snapshot = createMockSnapshot();
        const syncImportOp = createMockOperation('existing-import', OpType.SyncImport, {
          clientId: 'existing_protected_client',
          entityType: 'ALL',
          payload: { appDataComplete: { task: {}, project: {} } },
          vectorClock: { existing_protected_client: 1, other_protected_client: 5 },
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
        // Simulate: protectedClientIds already has ALL required keys
        mockOpLogStore.getProtectedClientIds.and.returnValue(
          Promise.resolve(['existing_protected_client', 'other_protected_client']),
        );
        mockOpLogStore.getLatestFullStateOp.and.returnValue(
          Promise.resolve(syncImportOp),
        );

        await service.hydrateStore();

        // Migration should check both but NOT call setProtectedClientIds since all keys are present
        expect(mockOpLogStore.getLatestFullStateOp).toHaveBeenCalled();
        expect(mockOpLogStore.getProtectedClientIds).toHaveBeenCalled();
        // setProtectedClientIds should NOT be called since all required IDs are already protected
        expect(mockOpLogStore.setProtectedClientIds).not.toHaveBeenCalled();
      });

      it('should NOT migrate when no full-state op exists in ops log', async () => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
        // Simulate: no full-state op in the log (checked first)
        mockOpLogStore.getLatestFullStateOp.and.returnValue(Promise.resolve(undefined));
        // protectedClientIds won't be checked since there's no full-state op
        mockOpLogStore.getProtectedClientIds.and.returnValue(Promise.resolve([]));

        await service.hydrateStore();

        // Migration should check for full-state op first, then bail out since there's none
        expect(mockOpLogStore.getLatestFullStateOp).toHaveBeenCalled();
        // getProtectedClientIds should NOT be called since we bail out early when no full-state op
        expect(mockOpLogStore.getProtectedClientIds).not.toHaveBeenCalled();
        // No setProtectedClientIds call should be made from migration
        expect(mockOpLogStore.setProtectedClientIds).not.toHaveBeenCalled();
      });

      it('should run migration in no-snapshot path too', async () => {
        const syncImportOp = createMockOperation('old-import', OpType.SyncImport, {
          clientId: 'no-snapshot-legacy-client',
          entityType: 'ALL',
          payload: { appDataComplete: { task: {}, project: {} } },
          vectorClock: { no_snapshot_legacy_client: 1, mobile_client: 15 },
        });
        const regularOp = createMockOperation('regular-op', OpType.Update);

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        // Has ops (not fresh install)
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([
            createMockEntry(1, syncImportOp),
            createMockEntry(2, regularOp),
          ]),
        );
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));
        // Simulate: no protectedClientIds (old data)
        mockOpLogStore.getProtectedClientIds.and.returnValue(Promise.resolve([]));
        // Simulate: the SYNC_IMPORT exists
        mockOpLogStore.getLatestFullStateOp.and.returnValue(
          Promise.resolve(syncImportOp),
        );

        await service.hydrateStore();

        // Migration should protect ALL client IDs from the SYNC_IMPORT's vectorClock
        expect(mockOpLogStore.getProtectedClientIds).toHaveBeenCalled();
        expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalledWith(
          jasmine.arrayContaining(['no_snapshot_legacy_client', 'mobile_client']),
        );
      });
    });

    describe('schema migration', () => {
      it('should call snapshotService.migrateSnapshotWithBackup if migration needed', async () => {
        const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
        const migratedSnapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(oldSnapshot));
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);

        await service.hydrateStore();

        expect(mockSnapshotService.migrateSnapshotWithBackup).toHaveBeenCalledWith(
          oldSnapshot,
        );
      });

      it('should not call migrateSnapshotWithBackup if no migration needed', async () => {
        const snapshot = createMockSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockSchemaMigrationService.needsMigration.and.returnValue(false);

        await service.hydrateStore();

        expect(mockSnapshotService.migrateSnapshotWithBackup).not.toHaveBeenCalled();
      });

      it('should dispatch loadAllData with migrated snapshot state', async () => {
        const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
        const migratedState = { task: { entities: {}, ids: ['migrated'] } } as any;
        const migratedSnapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          state: migratedState,
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(oldSnapshot));
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: migratedState }),
        );
      });

      it('should call recoveryService.attemptRecovery if migration fails', async () => {
        const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(oldSnapshot));
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.rejectWith(
          new Error('Migration failed'),
        );

        // hydrateStore catches migration error and attempts recovery
        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

      it('should migrate tail operations if needed', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = [
          createMockEntry(
            6,
            createMockOperation('op-6', OpType.Update, { schemaVersion: 0 }),
          ),
        ];
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockSchemaMigrationService.operationNeedsMigration.and.returnValue(true);

        await service.hydrateStore();

        expect(mockSchemaMigrationService.migrateOperations).toHaveBeenCalled();
      });

      // Additional version mismatch tests

      it('should handle snapshot with version newer than current (future version)', async () => {
        // This scenario can happen if a user downgrades the app
        const futureSnapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION + 5, // Future version
        });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(futureSnapshot));
        // Future version doesn't need migration (migration is only for older versions)
        mockSchemaMigrationService.needsMigration.and.returnValue(false);

        // Should not throw, just load the data
        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: mockState }),
        );
      });

      it('should migrate snapshot and operations together when both need migration', async () => {
        // Both snapshot and tail operations have old schema version
        const oldSnapshot = createMockSnapshot({
          schemaVersion: 0,
          lastAppliedOpSeq: 5,
        });
        const migratedSnapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastAppliedOpSeq: 5,
        });

        const tailOps = [
          createMockEntry(
            6,
            createMockOperation('op-6', OpType.Update, { schemaVersion: 0 }),
          ),
          createMockEntry(
            7,
            createMockOperation('op-7', OpType.Update, { schemaVersion: 0 }),
          ),
        ];

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(oldSnapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
        mockSchemaMigrationService.operationNeedsMigration.and.returnValue(true);

        const migratedOps = tailOps.map((e) => ({
          ...e.op,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }));
        mockSchemaMigrationService.migrateOperations.and.returnValue(migratedOps);

        await service.hydrateStore();

        // Both snapshot and operations should be migrated
        expect(mockSnapshotService.migrateSnapshotWithBackup).toHaveBeenCalled();
        expect(mockSchemaMigrationService.migrateOperations).toHaveBeenCalled();
        // Operations should be applied via bulk dispatch
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({ operations: migratedOps }),
        );
      });

      it('should handle mixed schema versions in tail operations', async () => {
        // Some tail ops are old version, some are current
        const snapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastAppliedOpSeq: 5,
        });

        const tailOps = [
          createMockEntry(
            6,
            createMockOperation('op-6', OpType.Update, { schemaVersion: 0 }), // Old
          ),
          createMockEntry(
            7,
            createMockOperation('op-7', OpType.Update, {
              schemaVersion: CURRENT_SCHEMA_VERSION,
            }), // Current
          ),
          createMockEntry(
            8,
            createMockOperation('op-8', OpType.Update, { schemaVersion: 0 }), // Old
          ),
        ];

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockSchemaMigrationService.needsMigration.and.returnValue(false);
        // At least one operation needs migration
        mockSchemaMigrationService.operationNeedsMigration.and.callFake(
          (op: Operation) => op.schemaVersion === 0,
        );

        await service.hydrateStore();

        // migrateOperations should be called since some ops need migration
        expect(mockSchemaMigrationService.migrateOperations).toHaveBeenCalled();
      });

      it('should not migrate operations if none need migration', async () => {
        const snapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastAppliedOpSeq: 5,
        });

        const tailOps = [
          createMockEntry(
            6,
            createMockOperation('op-6', OpType.Update, {
              schemaVersion: CURRENT_SCHEMA_VERSION,
            }),
          ),
        ];

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockSchemaMigrationService.needsMigration.and.returnValue(false);
        mockSchemaMigrationService.operationNeedsMigration.and.returnValue(false);

        await service.hydrateStore();

        // migrateOperations should NOT be called
        expect(mockSchemaMigrationService.migrateOperations).not.toHaveBeenCalled();
      });

      it('should handle undefined schemaVersion in snapshot (legacy data)', async () => {
        // Legacy data from before schema versioning was introduced
        const legacySnapshot = createMockSnapshot({ schemaVersion: undefined });
        const migratedSnapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
        });

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(legacySnapshot));
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);

        await service.hydrateStore();

        // Should call migration for legacy (undefined version) snapshot
        expect(mockSnapshotService.migrateSnapshotWithBackup).toHaveBeenCalledWith(
          legacySnapshot,
        );
      });
    });

    describe('backup recovery', () => {
      it('should restore from backup if backup exists', async () => {
        mockOpLogStore.hasStateCacheBackup.and.returnValue(Promise.resolve(true));
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockOpLogStore.restoreStateCacheFromBackup).toHaveBeenCalled();
      });
    });

    describe('pending remote ops recovery', () => {
      it('should call recoveryService.recoverPendingRemoteOps during hydration', async () => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockRecoveryService.recoverPendingRemoteOps).toHaveBeenCalled();
      });

      it('should call recoveryService.cleanupCorruptOps during hydration', async () => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockRecoveryService.cleanupCorruptOps).toHaveBeenCalled();
      });
    });

    describe('invalid snapshot handling', () => {
      it('should attempt recovery if snapshot is invalid', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

      it('should not dispatch loadAllData if snapshot is invalid', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);

        await service.hydrateStore();

        // Only dispatch should NOT happen because recovery takes over
        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });
    });

    describe('full replay (no snapshot)', () => {
      it('should replay all operations when no snapshot exists', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
          createMockEntry(3, createMockOperation('op-3')),
        ];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(3));

        await service.hydrateStore();

        // Replay all ops via bulk dispatch for performance
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({ operations: allOps.map((e) => e.op) }),
        );
        // Hydration state is managed around the dispatch
        expect(mockHydrationStateService.startApplyingRemoteOps).toHaveBeenCalled();
        expect(mockHydrationStateService.endApplyingRemoteOps).toHaveBeenCalled();
      });

      it('should save snapshot after full replay', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));

        await service.hydrateStore();

        expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalled();
      });

      it('should validate state BEFORE saving snapshot in full replay (regression test)', async () => {
        // Similar to tail replay test - validation must happen before snapshot save
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));

        // Track order of operations
        const callOrder: string[] = [];
        mockValidateStateService.validateAndRepair.and.callFake(() => {
          callOrder.push('validate');
          return { isValid: true, wasRepaired: false };
        });
        mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
          callOrder.push('saveSnapshot');
          return Promise.resolve();
        });

        await service.hydrateStore();

        // Validate should be called before saveSnapshot
        const validateIndex = callOrder.indexOf('validate');
        const saveIndex = callOrder.indexOf('saveSnapshot');
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(saveIndex).toBeGreaterThanOrEqual(0);
        expect(validateIndex).toBeLessThan(saveIndex);
      });

      it('should merge ops clocks into local clock in full replay', async () => {
        // Full replay case: merge all ops' clocks into local clock
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const op1 = createMockOperation('op-1', OpType.Update, {
          vectorClock: { clientA: 1 },
        });
        const op2 = createMockOperation('op-2', OpType.Update, {
          vectorClock: { clientA: 2 },
        });
        const allOps = [createMockEntry(1, op1), createMockEntry(2, op2)];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));

        await service.hydrateStore();

        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([op1, op2]);
      });

      it('should merge full-state op clock in full replay when last op is SyncImport', async () => {
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const syncClock = { clientA: 10 };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: { task: {} } },
          entityType: 'ALL',
          vectorClock: syncClock,
        });
        const allOps = [createMockEntry(1, syncImportOp)];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));

        await service.hydrateStore();

        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([syncImportOp]);
      });

      it('should merge SYNC_IMPORT clock BEFORE loadAllData in full replay (no snapshot) - stale clock regression', async () => {
        // Same regression test as the snapshot branch, but for the no-snapshot path
        // This ensures the fix is applied to both code paths (lines 187-195 AND 277-278)
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const syncImportPayload = { task: {}, project: {} };
        const syncClock = { clientA: 5, clientB: 10 };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
          vectorClock: syncClock,
        });
        const allOps = [createMockEntry(1, syncImportOp)];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));

        // Track order of operations using a shared counter
        let callSequence = 0;
        let mergeClockSequence = -1;
        let loadAllDataSyncImportSequence = -1;

        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          mergeClockSequence = callSequence++;
        });

        mockStore.dispatch.and.callFake(((action: any) => {
          if (
            action &&
            action.type === loadAllData.type &&
            action.appDataComplete === syncImportPayload
          ) {
            loadAllDataSyncImportSequence = callSequence++;
          }
        }) as any);

        await service.hydrateStore();

        expect(mergeClockSequence).toBeGreaterThanOrEqual(
          0,
          'mergeRemoteOpClocks should have been called',
        );
        expect(loadAllDataSyncImportSequence).toBeGreaterThanOrEqual(
          0,
          'loadAllData with SYNC_IMPORT should have been called',
        );
        expect(mergeClockSequence).toBeLessThan(
          loadAllDataSyncImportSequence,
          `mergeRemoteOpClocks (seq ${mergeClockSequence}) should be called BEFORE ` +
            `loadAllData (seq ${loadAllDataSyncImportSequence}) in full replay path`,
        );
      });
    });
  });

  describe('hydrateFromRemoteSync', () => {
    it('should delegate to syncHydrationService', async () => {
      await service.hydrateFromRemoteSync();

      expect(mockSyncHydrationService.hydrateFromRemoteSync).toHaveBeenCalled();
    });

    it('should pass downloadedMainModelData to syncHydrationService', async () => {
      const downloadedData = { task: { entities: {}, ids: [] } };

      await service.hydrateFromRemoteSync(downloadedData);

      expect(mockSyncHydrationService.hydrateFromRemoteSync).toHaveBeenCalledWith(
        downloadedData,
        undefined,
      );
    });

    it('should pass undefined when no downloadedMainModelData provided', async () => {
      await service.hydrateFromRemoteSync();

      expect(mockSyncHydrationService.hydrateFromRemoteSync).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });
  });

  // ===========================================================================
  // retryFailedRemoteOps: Retry failed remote operations
  // ===========================================================================
  // These tests verify the retry mechanism for failed remote operations.
  describe('retryFailedRemoteOps', () => {
    it('should call markApplied for successfully retried failed ops', async () => {
      const failedOp = createMockOperation('failed-op-1');
      const failedEntry: OperationLogEntry = {
        seq: 42,
        op: failedOp,
        appliedAt: Date.now(),
        source: 'remote',
        applicationStatus: 'failed',
        retryCount: 1,
      };

      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve([failedEntry]));
      mockOperationApplierService.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [] }),
      );

      await service.retryFailedRemoteOps();

      // Verify markApplied was called with the sequence number
      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([42]);
    });

    it('should clear failed status after successful retry (markApplied handles failed status)', async () => {
      // Verify that markApplied is called with the correct sequence number
      // after a successful retry. The actual status transition is tested
      // in operation-log-store.service.spec.ts.

      const failedOp = createMockOperation('failed-op-1');
      const failedEntry: OperationLogEntry = {
        seq: 42,
        op: failedOp,
        appliedAt: Date.now(),
        source: 'remote',
        applicationStatus: 'failed',
        retryCount: 1,
      };

      let markAppliedCalledWithSeqs: number[] = [];
      mockOpLogStore.markApplied.and.callFake((seqs: number[]) => {
        markAppliedCalledWithSeqs = seqs;
        return Promise.resolve();
      });

      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve([failedEntry]));
      mockOperationApplierService.applyOperations.and.returnValue(
        Promise.resolve({ appliedOps: [] }),
      );

      await service.retryFailedRemoteOps();

      // markApplied should be called with the failed op's sequence number
      expect(markAppliedCalledWithSeqs).toEqual([42]);
    });

    it('should call markFailed for ops that still fail after retry', async () => {
      const failedOp = createMockOperation('still-failing-op');
      const failedEntry: OperationLogEntry = {
        seq: 99,
        op: failedOp,
        appliedAt: Date.now(),
        source: 'remote',
        applicationStatus: 'failed',
        retryCount: 1,
      };

      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve([failedEntry]));
      mockOperationApplierService.applyOperations.and.returnValue(
        Promise.resolve({
          appliedOps: [],
          failedOp: {
            op: failedOp,
            error: new Error('Still failing'),
          },
        }),
      );

      await service.retryFailedRemoteOps();

      // markFailed should be called with the op ID
      expect(mockOpLogStore.markFailed).toHaveBeenCalledWith(
        ['still-failing-op'],
        jasmine.any(Number),
      );
    });
  });
});

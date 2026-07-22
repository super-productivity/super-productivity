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
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { environment } from '../../../environments/environment';
import { getAppVersionStr } from '../../util/get-app-version-str';
import { IDB_OPEN_ERROR_RELOAD_KEY } from './operation-log-hydrator.service';
import { SyncProviderId } from '../sync-providers/provider.const';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { reportBulkReplayReducerFailure } from '../apply/bulk-replay-failure-collector';
import { reportLoadAllDataReducerFailure } from '../apply/load-all-data-failure-guard.meta-reducer';
import { Action } from '@ngrx/store';
import { T } from '../../t.const';

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
  let mockOperationLogEffects: jasmine.SpyObj<OperationLogEffects>;
  let mockHydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let mockSnapshotService: jasmine.SpyObj<OperationLogSnapshotService>;
  let mockRecoveryService: jasmine.SpyObj<OperationLogRecoveryService>;
  let mockSyncHydrationService: jasmine.SpyObj<SyncHydrationService>;
  let mockClientIdProvider: jasmine.SpyObj<ClientIdProvider>;

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
      'markReducersCommittedAndMergeClocks',
      'getLatestFullStateOp',
    ]);
    mockMigrationService = jasmine.createSpyObj('OperationLogMigrationService', [
      'checkAndMigrate',
    ]);
    mockSchemaMigrationService = jasmine.createSpyObj('SchemaMigrationService', [
      'needsMigration',
      'migrateStateIfNeeded',
      'operationNeedsMigration',
      'migrateOperation',
      'migrateOperations',
    ]);
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
      'validateState',
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
    mockOperationLogEffects = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);
    mockOperationLogEffects.processDeferredActions.and.resolveTo();
    mockHydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'startApplyingRemoteOps',
      'endApplyingRemoteOps',
      'setHydrationFallbackActive',
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
    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    mockClientIdProvider.loadClientId.and.resolveTo('test-client');

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
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
    mockOpLogStore.getLatestFullStateOp.and.returnValue(Promise.resolve(undefined));
    mockOperationApplierService.applyOperations.and.returnValue(
      Promise.resolve({ appliedOps: [] }),
    );
    mockMigrationService.checkAndMigrate.and.returnValue(Promise.resolve());
    mockSchemaMigrationService.needsMigration.and.returnValue(false);
    mockSchemaMigrationService.operationNeedsMigration.and.returnValue(false);
    mockSchemaMigrationService.migrateOperation.and.callFake((op) => op);
    mockSchemaMigrationService.migrateOperations.and.callFake((ops) => ops);
    mockValidateStateService.validateAndRepair.and.resolveTo({
      isValid: true,
      wasRepaired: false,
    });
    mockValidateStateService.validateState.and.resolveTo({
      isValid: true,
      typiaErrors: [],
    });
    mockStateSnapshotService.getStateSnapshot.and.returnValue(mockState);
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ clientA: 5 }),
    );
    mockSnapshotService.isValidSnapshot.and.returnValue(true);
    mockSnapshotService.migrateSnapshotWithBackup.and.callFake(async (s) => s);
    // Resolves `true` = "a snapshot was actually written". The convergence gate
    // branches on this return value, so a mock resolving undefined would model a
    // guard-skipped save and silently change which branch the tests exercise.
    mockSnapshotService.saveCurrentStateAsSnapshot.and.resolveTo(true);
    mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([]);
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
        { provide: OperationLogEffects, useValue: mockOperationLogEffects },
        { provide: HydrationStateService, useValue: mockHydrationStateService },
        { provide: OperationLogSnapshotService, useValue: mockSnapshotService },
        { provide: OperationLogRecoveryService, useValue: mockRecoveryService },
        { provide: SyncHydrationService, useValue: mockSyncHydrationService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
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

        // Should NOT run synchronous validation (trusted snapshot).
        // Repair-with-dialog was removed entirely to avoid Electron focus bugs.
        expect(mockValidateStateService.validateState).not.toHaveBeenCalled();
        expect(mockValidateStateService.validateAndRepair).not.toHaveBeenCalled();
      });

      it('should validate snapshot state when schema version is missing', async () => {
        // When schema version is missing/undefined, we must validate
        const snapshot = createMockSnapshot({ schemaVersion: undefined });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        // Validation runs without ever calling the dialog-triggering repair path.
        expect(mockValidateStateService.validateState).toHaveBeenCalledWith(mockState);
        expect(mockValidateStateService.validateAndRepair).not.toHaveBeenCalled();
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

        expect(mockValidateStateService.validateState).toHaveBeenCalled();
        expect(mockValidateStateService.validateAndRepair).not.toHaveBeenCalled();
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

      // Vector-clock pruning is store-owned (setVectorClock prunes
      // internally, #9096) — covered by the OperationLogStoreService spec.
      // The hydrator passes the snapshot clock through unmodified:
      it('should not prune vector clock when within MAX_VECTOR_CLOCK_SIZE', async () => {
        const smallClock = { clientA: 5, clientB: 3 };
        const snapshot = createMockSnapshot({ vectorClock: smallClock });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(smallClock);
      });

      it('should not prune vector clock at exactly MAX_VECTOR_CLOCK_SIZE entries', async () => {
        const exactClock: Record<string, number> = {};
        for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
          exactClock[`client-${i}`] = i + 1;
        }
        const snapshot = createMockSnapshot({ vectorClock: exactClock });
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));

        await service.hydrateStore();

        expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith(exactClock);
      });
    });

    describe('tail operation replay', () => {
      it('should not replay an operation whose reducer was durably rejected', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const rejectedEntry: OperationLogEntry = {
          ...createMockEntry(6, createMockOperation('op-reducer-rejected')),
          rejectedAt: Date.now(),
          reducerRejectedAt: Date.now(),
        };
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([rejectedEntry]);

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledOnceWith(
          loadAllData({ appDataComplete: mockState }),
        );
        expect(mockOpLogStore.mergeRemoteOpClocks).not.toHaveBeenCalled();
      });

      it('should durably partition pending reducer failures before archive retry', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const failedOp = createMockOperation('op-failed');
        const successfulOp = createMockOperation('op-success');
        const pendingEntries: OperationLogEntry[] = [
          {
            seq: 6,
            op: failedOp,
            appliedAt: Date.now(),
            source: 'remote',
            applicationStatus: 'pending',
          },
          {
            seq: 7,
            op: successfulOp,
            appliedAt: Date.now(),
            source: 'remote',
            applicationStatus: 'pending',
          },
        ];
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo(pendingEntries);
        mockRecoveryService.recoverPendingRemoteOps.and.returnValue(
          Promise.resolve(pendingEntries) as never,
        );
        const durabilityOrder: string[] = [];
        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          durabilityOrder.push('clock');
        });
        mockOpLogStore.markReducersCommittedAndMergeClocks.and.callFake(async () => {
          durabilityOrder.push('checkpoint');
        });
        mockStore.dispatch.and.callFake(((action: { type: string }) => {
          if (action.type === bulkApplyHydrationOperations.type) {
            reportBulkReplayReducerFailure(failedOp, new Error('reducer failed'));
          }
        }) as never);

        await service.hydrateStore();

        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [7],
          [successfulOp],
          ['op-failed'],
        );
        expect(durabilityOrder).toEqual(['clock', 'checkpoint']);
      });

      it('should leave a reducer-failed pending full-state operation recoverable', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const fullStateOp = createMockOperation('pending-import', OpType.SyncImport, {
          entityType: 'ALL',
          payload: { appDataComplete: { task: {}, project: {} } },
        });
        const pendingEntry: OperationLogEntry = {
          ...createMockEntry(6, fullStateOp),
          source: 'remote',
          applicationStatus: 'pending',
        };
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([pendingEntry]);
        mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([pendingEntry]);
        mockStore.dispatch.and.callFake(((action: { type: string }) => {
          if (action.type === bulkApplyHydrationOperations.type) {
            reportBulkReplayReducerFailure(
              fullStateOp,
              new Error('full-state reducer failed'),
            );
          }
        }) as never);

        await service.hydrateStore();

        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

      it('should fail closed without rejecting a local replay failure', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const localOp = createMockOperation('local-replay-failure');
        const localEntry: OperationLogEntry = {
          ...createMockEntry(6, localOp),
          source: 'local',
        };
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([localEntry]);
        mockStore.dispatch.and.callFake(((action: { type: string }) => {
          if (action.type === bulkApplyHydrationOperations.type) {
            reportBulkReplayReducerFailure(localOp, new Error('local replay failed'));
          }
        }) as never);

        await service.hydrateStore();

        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

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
          bulkApplyHydrationOperations({
            operations: tailOps.map((e) => e.op),
            localClientId: 'test-client',
          }),
        );
        // Hydration state is managed around the dispatch
        expect(mockHydrationStateService.startApplyingRemoteOps).toHaveBeenCalled();
        expect(mockHydrationStateService.endApplyingRemoteOps).toHaveBeenCalled();
      });

      it('should replay a tail op with a malformed stored schemaVersion verbatim instead of failing into recovery', async () => {
        // Strict schemaVersion parsing guards the receive/upload paths; on the
        // local hydration path one legacy/corrupt entry must not turn every
        // boot into attemptRecovery() (which can lose tail data).
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const malformedOp = createMockOperation('op-6', OpType.Update, {
          schemaVersion: '2' as unknown as number,
        });
        const tailOps = [
          createMockEntry(6, malformedOp),
          createMockEntry(7, createMockOperation('op-7')),
        ];
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
        // Both ops replay in order; the malformed one is passed through with a
        // sanitized version stamp (payload untouched).
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: [
              { ...malformedOp, schemaVersion: CURRENT_SCHEMA_VERSION },
              tailOps[1].op,
            ],
            localClientId: 'test-client',
          }),
        );
      });

      it('should apply a failed tail op exactly once across hydration replay + retry (one boot)', async () => {
        // Regression: a remote op marked 'failed' (archive side effect threw
        // after its reducer committed) with seq > lastAppliedOpSeq used to get
        // its reducer applied TWICE per boot — once by the status-blind tail
        // replay and once more by retryFailedRemoteOps re-dispatching. The
        // retry must complete it with archive side effects only.
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const failedOp = createMockOperation('op-failed');
        const failedTailEntry: OperationLogEntry = {
          seq: 6,
          op: failedOp,
          appliedAt: Date.now(),
          source: 'remote',
          applicationStatus: 'failed',
          retryCount: 1,
        };
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve([failedTailEntry]));
        mockOpLogStore.getFailedRemoteOps.and.returnValue(
          Promise.resolve([failedTailEntry]),
        );
        mockOperationApplierService.applyOperations.and.callFake((ops: Operation[]) =>
          Promise.resolve({ appliedOps: ops }),
        );

        await service.hydrateStore();

        // Reducer application happens exactly once: the tail replay bulk dispatch.
        const bulkDispatches = mockStore.dispatch.calls
          .allArgs()
          .map((args) => args[0] as unknown as { type: string; operations?: Operation[] })
          .filter((action) => action.type === bulkApplyHydrationOperations.type);
        expect(bulkDispatches.length).toBe(1);
        expect(bulkDispatches[0].operations!.map((o) => o.id)).toEqual(['op-failed']);

        // The retry completes the op WITHOUT re-dispatching its reducer.
        expect(mockOperationApplierService.applyOperations).toHaveBeenCalledTimes(1);
        const [retriedOps, retryOptions] =
          mockOperationApplierService.applyOperations.calls.argsFor(0);
        expect(retriedOps.map((o: Operation) => o.id)).toEqual(['op-failed']);
        expect(retryOptions).toEqual({
          skipReducerDispatch: true,
          skipDeferredLocalActions: true,
        });
        expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([6]);
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
        mockValidateStateService.validateState.and.callFake(async () => {
          callOrder.push('validate');
          return { isValid: true, typiaErrors: [] };
        });
        mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
          callOrder.push('saveSnapshot');
          return Promise.resolve(true);
        });

        await service.hydrateStore();

        // Validate should be called before saveSnapshot
        const validateIndex = callOrder.indexOf('validate');
        const saveIndex = callOrder.indexOf('saveSnapshot');
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(saveIndex).toBeGreaterThanOrEqual(0);
        expect(validateIndex).toBeLessThan(saveIndex);
      });

      it('should skip the tail-replay snapshot save when validation fails', async () => {
        // Validation is now non-fatal but still gates the snapshot save so we
        // don't cache corrupted state for next boot.
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const tailOps = Array.from({ length: 15 }, (_, i) =>
          createMockEntry(6 + i, createMockOperation(`op-${6 + i}`)),
        );
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(20));
        mockValidateStateService.validateState.and.resolveTo({
          isValid: false,
          typiaErrors: [{ path: '$input.task', expected: 'TaskState' }],
        });

        await service.hydrateStore();

        expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
        // State is still dispatched so the UI shows the user's data.
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: snapshot.state as any }),
        );
      });
    });

    describe('full state operations optimization', () => {
      it('should not direct-load a full-state op while an earlier replay row is pending', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const pendingOp = createMockOperation('pending-op');
        const pendingEntry: OperationLogEntry = {
          ...createMockEntry(6, pendingOp),
          source: 'remote',
          applicationStatus: 'pending',
        };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: { appDataComplete: { task: {}, project: {} } },
          entityType: 'ALL',
        });
        const syncImportEntry = createMockEntry(7, syncImportOp);
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([pendingEntry, syncImportEntry]);
        mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([pendingEntry]);

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: [pendingOp, syncImportOp],
            localClientId: 'test-client',
          }),
        );
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [6],
          [pendingOp],
          [],
        );
      });

      it('should replay a pending SyncImport through reducers before checkpointing it', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const syncImportPayload = { task: {}, project: {} };
        const syncImportOp = createMockOperation('pending-sync-op', OpType.SyncImport, {
          payload: { appDataComplete: syncImportPayload },
          entityType: 'ALL',
        });
        const pendingEntry: OperationLogEntry = {
          ...createMockEntry(6, syncImportOp),
          source: 'remote',
          applicationStatus: 'pending',
        };
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([pendingEntry]);
        mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([pendingEntry]);

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: [syncImportOp],
            localClientId: 'test-client',
          }),
        );
        expect(mockStore.dispatch).not.toHaveBeenCalledWith(
          loadAllData({ appDataComplete: syncImportPayload as never }),
        );
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [6],
          [syncImportOp],
          [],
        );
      });

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

      it('should merge SYNC_IMPORT clock BEFORE dispatching loadAllData (regression test for superseded clock bug)', async () => {
        // REGRESSION TEST: Bug where operations created during loadAllData got superseded clocks
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
            `loadAllData (seq ${loadAllDataSyncImportSequence}) to prevent superseded clock bug`,
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

      it('should preserve local sync settings when replaying SYNC_IMPORT without state cache', async () => {
        const syncImportPayload = {
          task: {},
          project: {},
          globalConfig: {
            sync: {
              syncProvider: SyncProviderId.WebDAV,
              isEnabled: true,
              isEncryptionEnabled: true,
              syncInterval: 300000,
              isManualSyncOnly: true,
              isCompressionEnabled: true,
            },
          },
        };
        const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
          payload: syncImportPayload,
          entityType: 'ALL',
        });

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(
          Promise.resolve([createMockEntry(1, syncImportOp)]),
        );

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          loadAllData({ appDataComplete: syncImportPayload as any }),
        );
      });

      it('should merge BACKUP_IMPORT clock BEFORE loadAllData (regression test)', async () => {
        // REGRESSION TEST: Same fix applies to BACKUP_IMPORT operations.
        // BACKUP_IMPORT is a full-state operation like SYNC_IMPORT and has the same
        // superseded clock bug if mergeRemoteOpClocks happens after loadAllData.
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

    // NOTE: The 'protected client IDs for vector clock pruning' and
    // 'protected client IDs migration' test blocks were removed because
    // protectedClientIds has been removed from the codebase (MAX_VECTOR_CLOCK_SIZE
    // increased to 20, making pruning protection unnecessary).

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

      // Post-migration convergence: after a migrating hydration reducer-heals the
      // state, a fresh CURRENT_SCHEMA_VERSION snapshot must be persisted so the
      // on-disk cache converges in ONE boot instead of re-migrating every launch
      // (the "Failed to load data" root cause when a required field lacked a
      // backfill). See the CONVERGENCE block in hydrateStore.
      describe('post-migration convergence', () => {
        it('persists a fresh snapshot after a migration even with zero tail ops', async () => {
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          // Zero tail ops: before this change nothing re-persisted the snapshot,
          // so migration re-ran on every boot.
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(1);
        });

        it('skips the convergence save when the current state does not validate', async () => {
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
          // Unhealed / corrupt current state must never be cached (Checkpoint B
          // would trust a matching-schema snapshot unvalidated next boot).
          mockValidateStateService.validateState.and.resolveTo({
            isValid: false,
            typiaErrors: [{ path: '$input.foo', expected: 'string', value: undefined }],
          } as any);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
        });

        it('does not double-save when the tail-replay branch already persisted', async () => {
          const oldSnapshot = createMockSnapshot({
            schemaVersion: 0,
            lastAppliedOpSeq: 5,
          });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            lastAppliedOpSeq: 5,
          });
          // >10 tail ops → the existing Checkpoint-C save fires; convergence must
          // not add a second write.
          const tailOps = Array.from({ length: 11 }, (_, i) =>
            createMockEntry(6 + i, createMockOperation(`op-${6 + i}`)),
          );
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo(tailOps);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(1);
        });

        it('does NOT persist a convergence snapshot on a normal boot (no migration)', async () => {
          const snapshot = createMockSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION });
          mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(false);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
        });

        it('converges after a migrating full-state-op (SyncImport) boot', async () => {
          // The full-state-op load branch loads directly and never sets the
          // Checkpoint-C save flag, so a migrating boot whose tail is a SyncImport
          // must still converge. Second positive test that FAILS if the
          // convergence block is removed.
          const oldSnapshot = createMockSnapshot({
            schemaVersion: 0,
            lastAppliedOpSeq: 5,
          });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            lastAppliedOpSeq: 5,
          });
          const syncImportOp = createMockOperation('sync-op', OpType.SyncImport, {
            payload: { appDataComplete: { task: {}, project: {} } },
            entityType: 'ALL',
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([createMockEntry(6, syncImportOp)]);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(1);
        });

        it('runs the convergence save AFTER retryFailedRemoteOps', async () => {
          // Ordering matters for #7700: retryFailedRemoteOps merges the retried
          // remote ops' vector clocks, and the deferred-action drain must follow
          // that merge so deferred local ops get clocks dominating them. Moving
          // the convergence block before the retry flips this and fails here.
          // (The drain itself is asserted separately — retryFailedRemoteOps
          // early-returns before its own drain when there are no failed ops.)
          const callOrder: string[] = [];
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
          // getFailedRemoteOps is the first call inside retryFailedRemoteOps.
          mockOpLogStore.getFailedRemoteOps.and.callFake(() => {
            callOrder.push('retryFailedRemoteOps');
            return Promise.resolve([]);
          });
          mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
            callOrder.push('convergenceSave');
            return Promise.resolve(true);
          });

          await service.hydrateStore();

          expect(callOrder).toContain('convergenceSave');
          expect(callOrder.indexOf('convergenceSave')).toBeGreaterThan(
            callOrder.indexOf('retryFailedRemoteOps'),
          );
        });

        it('does not converge on a later non-migrating boot (per-run flag reset)', async () => {
          // Guards the per-run reset of _migrationRanDuringHydration: a migrating
          // boot must not leave a stale flag that fires convergence on a later
          // non-migrating boot on the same instance. Removing the reset makes the
          // second boot save spuriously.
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);

          await service.hydrateStore();
          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(1);

          // Second boot on the same instance: current-schema snapshot, no migration.
          mockSnapshotService.saveCurrentStateAsSnapshot.calls.reset();
          mockOpLogStore.loadStateCache.and.resolveTo(
            createMockSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION }),
          );
          mockSchemaMigrationService.needsMigration.and.returnValue(false);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
        });

        it('does not double-save when a corrupt migrated snapshot falls through to full replay', async () => {
          // Reachable path with NO other coverage: a migrated snapshot that fails
          // isValidSnapshot() sets snapshot = null and drops into the full-replay
          // branch while _migrationRanDuringHydration is already true. Guards the
          // full-replay branch's persisted-flag assignment — dropping it there
          // produces a second, unguarded startup write.
          mockOpLogStore.loadStateCache.and.resolveTo(
            createMockSnapshot({ schemaVersion: 0 }),
          );
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(
            createMockSnapshot({ schemaVersion: CURRENT_SCHEMA_VERSION }),
          );
          mockSnapshotService.isValidSnapshot.and.returnValue(false);
          mockOpLogStore.getLastSeq.and.resolveTo(5);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([
            createMockEntry(1, createMockOperation('op-1')),
            createMockEntry(2, createMockOperation('op-2')),
          ]);

          await service.hydrateStore();

          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(1);
        });

        it('still converges when the Checkpoint-C save was internally SKIPPED', async () => {
          // saveCurrentStateAsSnapshot() resolves normally when one of its own
          // guards (#8751 phantom / #7892 empty) or a caught write failure skipped
          // the write. Treating "resolved" as "persisted" would leave the on-disk
          // cache at the old schema and re-migrate every boot — the exact bug this
          // block exists to fix. Fails if the flag is set unconditionally instead
          // of from the return value.
          const oldSnapshot = createMockSnapshot({
            schemaVersion: 0,
            lastAppliedOpSeq: 5,
          });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            lastAppliedOpSeq: 5,
          });
          // >10 tail ops → Checkpoint C runs, but reports it did NOT persist.
          const tailOps = Array.from({ length: 11 }, (_, i) =>
            createMockEntry(6 + i, createMockOperation(`op-${6 + i}`)),
          );
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo(tailOps);
          mockSnapshotService.saveCurrentStateAsSnapshot.and.resolveTo(false);

          await service.hydrateStore();

          // Checkpoint C + convergence retry = 2 attempts, not 1.
          expect(mockSnapshotService.saveCurrentStateAsSnapshot).toHaveBeenCalledTimes(2);
        });

        it('drains deferred actions before the convergence save', async () => {
          // The phantom-change guard (#8751) skips the save while deferred actions
          // are buffered, and retryFailedRemoteOps() early-returns before its
          // drain when there are no failed ops — the common boot. So the drain
          // must be explicit here. Fails if it is removed.
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
          // No failed remote ops → retryFailedRemoteOps() returns before its
          // own drain, so any drain observed here is the convergence block's.
          mockOpLogStore.getFailedRemoteOps.and.resolveTo([]);

          const callOrder: string[] = [];
          mockOperationLogEffects.processDeferredActions.and.callFake(() => {
            callOrder.push('drain');
            return Promise.resolve();
          });
          mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
            callOrder.push('convergenceSave');
            return Promise.resolve(true);
          });

          await service.hydrateStore();

          expect(callOrder).toEqual(['drain', 'convergenceSave']);
        });

        it('never escalates a convergence failure into hydration recovery', async () => {
          // The convergence block is a best-effort cache optimization. If it threw,
          // the outer catch would run attemptRecovery() — which refuses because a
          // snapshot exists — and surface the very "Failed to load data" snack this
          // fix removes, on an otherwise perfectly hydrated store.
          const oldSnapshot = createMockSnapshot({ schemaVersion: 0 });
          const migratedSnapshot = createMockSnapshot({
            schemaVersion: CURRENT_SCHEMA_VERSION,
          });
          mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
          mockSchemaMigrationService.needsMigration.and.returnValue(true);
          mockSnapshotService.migrateSnapshotWithBackup.and.resolveTo(migratedSnapshot);
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
          // Throw from the convergence-path validation specifically: the earlier
          // Checkpoint-B validation of the migrated snapshot must still succeed.
          mockValidateStateService.validateState.and.callFake(async () => {
            if (mockValidateStateService.validateState.calls.count() > 1) {
              throw new Error('validator blew up');
            }
            return { isValid: true, typiaErrors: [] } as any;
          });

          await expectAsync(service.hydrateStore()).toBeResolved();

          expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
          expect(mockSnackService.open).not.toHaveBeenCalled();
          // The auto-reload guard must still be cleared on a successful boot.
          expect(sessionStorage.getItem(IDB_OPEN_ERROR_RELOAD_KEY)).toBeNull();
        });
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

        expect(mockSchemaMigrationService.migrateOperation).toHaveBeenCalled();
      });

      it('should durably reject a pending row that migration drops', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const pendingOp = createMockOperation('dropped-pending-op', OpType.Update, {
          schemaVersion: 0,
        });
        const pendingEntry: OperationLogEntry = {
          ...createMockEntry(6, pendingOp),
          source: 'remote',
          applicationStatus: 'pending',
        };
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([pendingEntry]);
        mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([pendingEntry]);
        mockSchemaMigrationService.operationNeedsMigration.and.returnValue(true);
        mockSchemaMigrationService.migrateOperation.and.returnValue(null);

        await service.hydrateStore();

        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [],
          [],
          [pendingOp.id],
        );
      });

      it('should checkpoint the original pending row when migration splits it', async () => {
        const snapshot = createMockSnapshot({ lastAppliedOpSeq: 5 });
        const pendingOp = createMockOperation('split-pending-op', OpType.Update, {
          schemaVersion: 0,
        });
        const pendingEntry: OperationLogEntry = {
          ...createMockEntry(6, pendingOp),
          source: 'remote',
          applicationStatus: 'pending',
        };
        const migratedOps = [
          createMockOperation('split-pending-op-1'),
          createMockOperation('split-pending-op-2'),
        ];
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([pendingEntry]);
        mockRecoveryService.recoverPendingRemoteOps.and.resolveTo([pendingEntry]);
        mockSchemaMigrationService.operationNeedsMigration.and.returnValue(true);
        mockSchemaMigrationService.migrateOperation.and.returnValue(migratedOps);

        await service.hydrateStore();

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: migratedOps,
            localClientId: 'test-client',
            atomicReplayGroups: [migratedOps.map((op) => op.id)],
          }),
        );
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [pendingEntry.seq],
          [pendingOp],
          [],
        );
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
        mockSchemaMigrationService.migrateOperation.and.callFake((op) => ({
          ...op,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }));

        await service.hydrateStore();

        // Both snapshot and operations should be migrated
        expect(mockSnapshotService.migrateSnapshotWithBackup).toHaveBeenCalled();
        expect(mockSchemaMigrationService.migrateOperation).toHaveBeenCalled();
        // Operations should be applied via bulk dispatch
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: migratedOps,
            localClientId: 'test-client',
          }),
        );
      });

      it('should handle mixed schema versions in tail operations', async () => {
        // Some tail ops are old version, some are current
        const snapshot = createMockSnapshot({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          lastAppliedOpSeq: 5,
        });

        // schemaVersion 1 = a legitimately old version (the floor); 0 would be
        // malformed and is sanitized by the lenient hydration boundary instead.
        const tailOps = [
          createMockEntry(
            6,
            createMockOperation('op-6', OpType.Update, { schemaVersion: 1 }), // Old
          ),
          createMockEntry(
            7,
            createMockOperation('op-7', OpType.Update, {
              schemaVersion: CURRENT_SCHEMA_VERSION,
            }), // Current
          ),
          createMockEntry(
            8,
            createMockOperation('op-8', OpType.Update, { schemaVersion: 1 }), // Old
          ),
        ];

        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(snapshot));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(tailOps));
        mockSchemaMigrationService.needsMigration.and.returnValue(false);
        // At least one operation needs migration
        mockSchemaMigrationService.operationNeedsMigration.and.callFake(
          (op: Operation) => op.schemaVersion === 1,
        );

        await service.hydrateStore();

        // migrateOperation should be called since some ops need migration
        expect(mockSchemaMigrationService.migrateOperation).toHaveBeenCalled();
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

        // migrateOperation should NOT be called
        expect(mockSchemaMigrationService.migrateOperation).not.toHaveBeenCalled();
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
      it('should attempt recovery if snapshot is invalid and there are no ops', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);
        // #7892: recovery-to-empty is only taken when the op-log is also empty.
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(0));

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

      it('should not dispatch loadAllData if snapshot is invalid and there are no ops', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(0));

        await service.hydrateStore();

        // Only dispatch should NOT happen because recovery takes over
        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });

      // #7892: when the snapshot/state-cache is corrupt but the op-log is intact
      // (lastSeq > 0), the hydrator must DISCARD the corrupt snapshot and replay
      // the op-log instead of dropping to recovery-to-empty. This is the core
      // data-saving fix; the recovery-to-empty path is reserved for lastSeq === 0.
      it('should discard a corrupt snapshot and replay the op-log when lastSeq > 0 (#7892)', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);

        // Op-log is intact: lastSeq > 0 and getOpsAfterSeq(0) returns the ops.
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));

        await service.hydrateStore();

        // Must NOT drop to recovery-to-empty.
        expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
        // Must replay the whole op-log from seq 0.
        expect(mockOpLogStore.getOpsAfterSeq).toHaveBeenCalledWith(0);
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: allOps.map((e) => e.op),
            localClientId: 'test-client',
          }),
        );
      });

      it('should attempt recovery for an invalid snapshot only when no ops exist (lastSeq === 0) (#7892)', async () => {
        const invalidSnapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(invalidSnapshot));
        mockSnapshotService.isValidSnapshot.and.returnValue(false);
        // No op-log to replay.
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(0));

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
      });
    });

    // #9140: a throw on the snapshot MIGRATION path (metadata-validation
    // failure, migration transform failure) must get the same op-log fallback
    // the invalid-snapshot path above already has — instead of escalating into
    // attemptRecovery(), which refuses while a snapshot exists on disk and
    // bricks to an empty store on every boot.
    describe('migration failure op-log fallback (#9140)', () => {
      const arrangeMigrationThrow = (error: Error): void => {
        const oldSnapshot = createMockSnapshot({ schemaVersion: 1 });
        mockOpLogStore.loadStateCache.and.resolveTo(oldSnapshot);
        mockSchemaMigrationService.needsMigration.and.returnValue(true);
        mockSnapshotService.migrateSnapshotWithBackup.and.rejectWith(error);
      };

      it('should discard the snapshot and replay the op-log when migration throws and replayable ops exist', async () => {
        arrangeMigrationThrow(new Error('Migrated snapshot metadata validation failed'));
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getLastSeq.and.resolveTo(2);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo(allOps);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
        expect(mockOpLogStore.getOpsAfterSeq).toHaveBeenCalledWith(0);
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: allOps.map((e) => e.op),
            localClientId: 'test-client',
          }),
        );
        // The degraded recovery must be visible to the user...
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({ msg: T.F.SYNC.S.HYDRATION_FALLBACK_RECOVERY }),
        );
        // ...and must NEVER persist the (possibly partial) replay over the
        // intact on-disk snapshot: for a synced client the surviving log is
        // only a compaction-window tail, and sync never re-sends pruned ops.
        expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
        // Compaction must also stay blocked for the session (same overwrite
        // hazard, one writer later) — see OperationLogCompactionService.
        expect(mockHydrationStateService.setHydrationFallbackActive).toHaveBeenCalledWith(
          true,
        );
      });

      it('should clear the fallback-active flag on a boot that does not fall back', async () => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);

        await service.hydrateStore();

        expect(mockHydrationStateService.setHydrationFallbackActive).toHaveBeenCalledWith(
          false,
        );
      });

      it('should escalate instead of booting silently empty when all surviving rows are reducer-rejected', async () => {
        arrangeMigrationThrow(new Error('SchemaMigrationService: migration failed'));
        const rejectedOps = [
          { ...createMockEntry(1, createMockOperation('op-1')), reducerRejectedAt: 123 },
          { ...createMockEntry(2, createMockOperation('op-2')), reducerRejectedAt: 123 },
        ];
        // The cheap row-count gate passes, but nothing is actually replayable.
        mockOpLogStore.getLastSeq.and.resolveTo(2);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo(rejectedOps);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
        expect(mockStore.dispatch).not.toHaveBeenCalled();
        expect(mockSnackService.open).not.toHaveBeenCalled();
      });

      it('should escalate instead of replaying when the store already holds data (re-entrant hydration)', async () => {
        // hydrateStore() genuinely re-enters on a LIVE store via
        // PluginAPI.reInitData(); replay-from-0 on top would double-apply
        // non-idempotent reducers.
        arrangeMigrationThrow(new Error('SchemaMigrationService: migration failed'));
        mockStateSnapshotService.getStateSnapshot.and.returnValue({
          ...mockState,
          task: { ids: ['live-task'], entities: { ['live-task']: {} } },
        });
        mockOpLogStore.getLastSeq.and.resolveTo(2);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          createMockEntry(1, createMockOperation('op-1')),
        ]);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
        expect(mockStore.dispatch).not.toHaveBeenCalled();
      });

      it('should escalate to recovery when migration throws and the op-log is empty', async () => {
        arrangeMigrationThrow(new Error('SchemaMigrationService: migration failed'));
        mockOpLogStore.getLastSeq.and.resolveTo(0);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);

        await service.hydrateStore();

        // No replayable ops → no local source of truth left; the existing
        // terminal handling (recovery attempt) is all that remains.
        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
        expect(mockStore.dispatch).not.toHaveBeenCalled();
      });

      it('should surface HYDRATION_FAILED when migration throws, the op-log is empty, and recovery refuses', async () => {
        arrangeMigrationThrow(new Error('SchemaMigrationService: migration failed'));
        mockOpLogStore.getLastSeq.and.resolveTo(0);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
        mockRecoveryService.attemptRecovery.and.rejectWith(
          new Error('Refusing legacy recovery because a SUP_OPS snapshot still exists'),
        );

        await expectAsync(service.hydrateStore()).toBeRejected();

        expect(mockSnackService.open).toHaveBeenCalledTimes(1);
      });

      it('should rethrow an IndexedDBOpenError from migration without attempting op-log fallback', async () => {
        if (!jasmine.isSpy(window.alert)) {
          spyOn(window, 'alert');
        }
        (window.alert as jasmine.Spy).calls.reset();
        // Non-backing-store error → dialog path, no auto-reload.
        arrangeMigrationThrow(new IndexedDBOpenError(new Error('QuotaExceededError')));
        // Fallback WOULD be viable — but a broken IndexedDB means replay would
        // fail identically, so the tailored IDB dialog must win.
        mockOpLogStore.getLastSeq.and.resolveTo(5);

        await expectAsync(service.hydrateStore()).toBeRejected();

        expect(mockStore.dispatch).not.toHaveBeenCalled();
        expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
      });
    });

    // #9140 (mechanism 2): when a feature reducer throws on the snapshot
    // loadAllData dispatch (e.g. an old snapshot missing a required field no
    // reducer backfills), the failure-guard meta-reducer keeps the store alive
    // and reports the failure to the hydrator, which must fall back to op-log
    // replay. The dispatch spy simulates the guard by reporting to the active
    // collector, mirroring how reportBulkReplayReducerFailure is driven above.
    describe('snapshot loadAllData reducer failure fallback (#9140)', () => {
      const arrangeReducerRejection = (): void => {
        const snapshot = createMockSnapshot();
        mockOpLogStore.loadStateCache.and.resolveTo(snapshot);
        mockStore.dispatch.and.callFake(((action: Action): void => {
          if (action.type === loadAllData.type) {
            reportLoadAllDataReducerFailure(
              new Error('Cannot read properties of undefined'),
            );
          }
        }) as Store['dispatch']);
      };

      it('should fall back to op-log replay when a reducer rejects the snapshot state', async () => {
        arrangeReducerRejection();
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getLastSeq.and.resolveTo(2);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo(allOps);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).not.toHaveBeenCalled();
        // Fallback replays the WHOLE log from seq 0, not the snapshot tail.
        expect(mockOpLogStore.getOpsAfterSeq).toHaveBeenCalledWith(0);
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          bulkApplyHydrationOperations({
            operations: allOps.map((e) => e.op),
            localClientId: 'test-client',
          }),
        );
        // Degraded recovery is visible; the partial replay is never persisted
        // over the intact snapshot.
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({ msg: T.F.SYNC.S.HYDRATION_FALLBACK_RECOVERY }),
        );
        expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
      });

      it('should escalate when a reducer rejects the snapshot state and the op-log is empty', async () => {
        arrangeReducerRejection();
        mockOpLogStore.getLastSeq.and.resolveTo(0);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);

        await service.hydrateStore();

        expect(mockRecoveryService.attemptRecovery).toHaveBeenCalled();
        // Only the failed loadAllData attempt — no bulk replay dispatch.
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
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
          bulkApplyHydrationOperations({
            operations: allOps.map((e) => e.op),
            localClientId: 'test-client',
          }),
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
        mockValidateStateService.validateState.and.callFake(async () => {
          callOrder.push('validate');
          return { isValid: true, typiaErrors: [] };
        });
        mockSnapshotService.saveCurrentStateAsSnapshot.and.callFake(() => {
          callOrder.push('saveSnapshot');
          return Promise.resolve(true);
        });

        await service.hydrateStore();

        // Validate should be called before saveSnapshot
        const validateIndex = callOrder.indexOf('validate');
        const saveIndex = callOrder.indexOf('saveSnapshot');
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(saveIndex).toBeGreaterThanOrEqual(0);
        expect(validateIndex).toBeLessThan(saveIndex);
      });

      it('should skip the full-replay snapshot save when validation fails', async () => {
        // Validation is non-fatal but gates the snapshot save.
        mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
        const allOps = [
          createMockEntry(1, createMockOperation('op-1')),
          createMockEntry(2, createMockOperation('op-2')),
        ];
        mockOpLogStore.getOpsAfterSeq.and.returnValue(Promise.resolve(allOps));
        mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(2));
        mockValidateStateService.validateState.and.resolveTo({
          isValid: false,
          typiaErrors: [{ path: '$input.task', expected: 'TaskState' }],
        });

        await service.hydrateStore();

        expect(mockSnapshotService.saveCurrentStateAsSnapshot).not.toHaveBeenCalled();
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

      it('should merge SYNC_IMPORT clock BEFORE loadAllData in full replay (no snapshot) - superseded clock regression', async () => {
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
    const failedEntry = (seq: number, opId: string): OperationLogEntry => ({
      seq,
      op: createMockOperation(opId),
      appliedAt: Date.now(),
      source: 'remote',
      applicationStatus: 'failed',
      retryCount: 1,
    });

    it('should retry all failed ops as a single batch (not one at a time) — #8305', async () => {
      const entries = [
        failedEntry(40, 'op-a'),
        failedEntry(41, 'op-b'),
        failedEntry(42, 'op-c'),
      ];
      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve(entries));
      mockOperationApplierService.applyOperations.and.callFake((ops: Operation[]) =>
        Promise.resolve({ appliedOps: ops }),
      );

      await service.retryFailedRemoteOps();

      // One batch call carrying every failed op — the per-op retry that
      // defeated the same-batch archive pre-scan is gone.
      expect(mockOperationApplierService.applyOperations).toHaveBeenCalledTimes(1);
      const passedOps = mockOperationApplierService.applyOperations.calls.argsFor(0)[0];
      expect(passedOps.map((o: Operation) => o.id)).toEqual(['op-a', 'op-b', 'op-c']);
      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([40, 41, 42]);
      expect(mockOpLogStore.markFailed).not.toHaveBeenCalled();
      // Applied-op clocks are merged on completion (parity with the primary
      // remote-apply path, which only merges the clocks of ops it marked applied).
      expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith(passedOps);
    });

    it('should retry archive side effects only — never re-dispatch reducers', async () => {
      // Failed ops had their reducers committed by the bulk dispatch of the
      // batch that marked them failed; re-dispatching on retry double-applies
      // additive reducers (syncTimeSpent, increaseSimpleCounterCounterToday).
      mockOpLogStore.getFailedRemoteOps.and.returnValue(
        Promise.resolve([failedEntry(40, 'op-a')]),
      );
      mockOperationApplierService.applyOperations.and.callFake((ops: Operation[]) =>
        Promise.resolve({ appliedOps: ops }),
      );

      await service.retryFailedRemoteOps();

      const options = mockOperationApplierService.applyOperations.calls.argsFor(0)[1];
      expect(options).toEqual({
        skipReducerDispatch: true,
        skipDeferredLocalActions: true,
      });
    });

    it('should apply failed ops in ascending seq order regardless of store order', async () => {
      // getFailedRemoteOps reads from an index whose result order is not part of
      // its contract; the batch must still be applied in causal (seq) order.
      const entries = [
        failedEntry(42, 'op-c'),
        failedEntry(40, 'op-a'),
        failedEntry(41, 'op-b'),
      ];
      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve(entries));
      mockOperationApplierService.applyOperations.and.callFake((ops: Operation[]) =>
        Promise.resolve({ appliedOps: ops }),
      );

      await service.retryFailedRemoteOps();

      const passedOps = mockOperationApplierService.applyOperations.calls.argsFor(0)[0];
      expect(passedOps.map((o: Operation) => o.id)).toEqual(['op-a', 'op-b', 'op-c']);
      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([40, 41, 42]);
    });

    it('should charge retry budget only to the attempted archive failure', async () => {
      const entries = [
        failedEntry(40, 'op-a'),
        failedEntry(41, 'op-b'),
        failedEntry(42, 'op-c'),
      ];
      const opB = entries[1].op;
      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve(entries));
      // Batch applier stops at op-b: op-a applied, op-b failed, op-c dropped.
      mockOperationApplierService.applyOperations.and.returnValue(
        Promise.resolve({
          appliedOps: [entries[0].op],
          failedOp: { op: opB, error: new Error('Still failing') },
        }),
      );

      await service.retryFailedRemoteOps();

      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([40]);
      // op-c remains archive-pending and has not consumed a retry attempt.
      expect(mockOpLogStore.markFailed).toHaveBeenCalledOnceWith(['op-b']);
    });

    it('should merge clocks before marking archive retries applied', async () => {
      mockOpLogStore.getFailedRemoteOps.and.resolveTo([failedEntry(40, 'op-a')]);
      mockOperationApplierService.applyOperations.and.resolveTo({
        appliedOps: [failedEntry(40, 'op-a').op],
      });
      mockOpLogStore.mergeRemoteOpClocks.and.rejectWith(new Error('clock write failed'));

      await expectAsync(service.retryFailedRemoteOps()).toBeRejected();

      expect(mockOpLogStore.markApplied).not.toHaveBeenCalled();
    });

    it('should not escalate a deferred-drain failure into hydration recovery', async () => {
      // A drain throw here used to propagate out of hydrateStore() into
      // attemptRecovery(), which can import stale legacy data over a correctly
      // hydrated store. The failure is logged; buffered actions stay queued
      // for the next drain point (e.g. the pre-sync flush).
      mockOperationLogEffects.processDeferredActions.and.rejectWith(
        new Error('drain failed'),
      );
      mockOpLogStore.getFailedRemoteOps.and.resolveTo([failedEntry(40, 'op-a')]);
      mockOperationApplierService.applyOperations.and.callFake((ops: Operation[]) =>
        Promise.resolve({ appliedOps: ops }),
      );

      await expectAsync(service.retryFailedRemoteOps()).toBeResolved();

      // Bookkeeping completed despite the failed drain.
      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([40]);
    });

    it('should do nothing when there are no failed ops', async () => {
      mockOpLogStore.getFailedRemoteOps.and.returnValue(Promise.resolve([]));

      await service.retryFailedRemoteOps();

      expect(mockOperationApplierService.applyOperations).not.toHaveBeenCalled();
      expect(mockOpLogStore.markApplied).not.toHaveBeenCalled();
      expect(mockOpLogStore.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('IndexedDB open error handling', () => {
    let reloadSpy: jasmine.Spy;

    beforeEach(() => {
      sessionStorage.removeItem(IDB_OPEN_ERROR_RELOAD_KEY);
      if (!jasmine.isSpy(window.alert)) {
        spyOn(window, 'alert');
      }
      (window.alert as jasmine.Spy).calls.reset();
      reloadSpy = spyOn(service as any, '_triggerReload');
    });

    afterEach(() => {
      sessionStorage.removeItem(IDB_OPEN_ERROR_RELOAD_KEY);
    });

    it('should silently auto-reload for backing store error on first occurrence', async () => {
      const err = new IndexedDBOpenError(
        new Error('Internal error opening backing store for indexedDB.open'),
      );
      mockRecoveryService.recoverPendingRemoteOps.and.rejectWith(err);

      await expectAsync(service.hydrateStore()).toBeRejected();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(IDB_OPEN_ERROR_RELOAD_KEY)).toBe('1');
      // No dialog on first attempt — autostart users aren't watching
      expect(window.alert).not.toHaveBeenCalled();
    });

    it('should show recovery dialog and NOT auto-reload when already reloaded once', async () => {
      sessionStorage.setItem(IDB_OPEN_ERROR_RELOAD_KEY, '1');
      const err = new IndexedDBOpenError(
        new Error('Internal error opening backing store for indexedDB.open'),
      );
      mockRecoveryService.recoverPendingRemoteOps.and.rejectWith(err);

      await expectAsync(service.hydrateStore()).toBeRejected();

      expect(reloadSpy).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-reload for non-backing-store IDB open errors', async () => {
      const err = new IndexedDBOpenError(new Error('QuotaExceededError'));
      mockRecoveryService.recoverPendingRemoteOps.and.rejectWith(err);

      await expectAsync(service.hydrateStore()).toBeRejected();

      expect(reloadSpy).not.toHaveBeenCalled();
    });

    // #9187: DB_VERSION 8-10 are deliberate downgrade barriers, so a
    // VersionError means an old build is looking at an intact database. The
    // generic dialog's "your browser storage may need to be cleared" would
    // destroy that data and still not let this build open it.
    describe('downgrade barrier (VersionError)', () => {
      const arrangeVersionError = (): void => {
        mockRecoveryService.recoverPendingRemoteOps.and.rejectWith(
          new IndexedDBOpenError(
            new DOMException(
              'The requested version (7) is less than the existing version (10).',
              'VersionError',
            ),
          ),
        );
      };

      const shownMessage = (): string =>
        (window.alert as jasmine.Spy).calls.mostRecent().args[0] as string;

      it('never tells the user to clear storage or blames corruption', async () => {
        arrangeVersionError();

        await expectAsync(service.hydrateStore()).toBeRejected();

        expect(window.alert).toHaveBeenCalledTimes(1);
        const msg = shownMessage();
        expect(msg).not.toContain('storage may need to be cleared');
        expect(msg).not.toContain('Storage corruption');
        expect(msg).not.toContain('Low disk space');
        expect(msg).toContain('Do NOT clear your storage');
      });

      it('names the running version and keeps the technical detail', async () => {
        arrangeVersionError();

        await expectAsync(service.hydrateStore()).toBeRejected();

        const msg = shownMessage();
        // The channel-suffixed string, not the bare version: the suffix is what
        // distinguishes two installed copies from each other (#9187).
        expect(msg).toContain(getAppVersionStr());
        expect(getAppVersionStr()).not.toBe(environment.version);
        expect(msg).toContain('newer version');
        // The raw browser text still reaches bug reports.
        expect(msg).toContain('The requested version (7) is less than');
      });

      // No auto-reload assertion here: a VersionError is not a backing-store
      // error, so the existing non-backing-store test above already covers it.
      // Asserting it again passes with this branch deleted — a vacuous test.
    });

    it('should clear the reload key after successful hydration', async () => {
      sessionStorage.setItem(IDB_OPEN_ERROR_RELOAD_KEY, '1');
      // Successful hydration — no errors thrown
      await service.hydrateStore();

      expect(sessionStorage.getItem(IDB_OPEN_ERROR_RELOAD_KEY)).toBeNull();
    });
  });
});

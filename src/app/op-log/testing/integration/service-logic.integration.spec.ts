import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OperationLogSyncService } from '../../sync/operation-log-sync.service';
import { OperationLogUploadService } from '../../sync/operation-log-upload.service';
import { OperationLogDownloadService } from '../../sync/operation-log-download.service';
import { OperationEncryptionService } from '../../sync/operation-encryption.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { RepairOperationService } from '../../validation/repair-operation.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  OpUploadResponse,
  OpDownloadResponse,
  SyncOperation,
} from '../../sync-providers/provider.interface';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../sync-providers/super-sync/super-sync.model';
import { provideMockStore } from '@ngrx/store/testing';
import {
  ActionType,
  EntityConflict,
  OpType,
  Operation,
  VectorClock,
} from '../../core/operation.types';
import {
  compareVectorClocks,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { toEntityKey } from '../../util/entity-key.util';
import { MatDialog } from '@angular/material/dialog';
import { UserInputWaitStateService } from '../../../imex/sync/user-input-wait-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { LockService } from '../../sync/lock.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import {
  mockDecrypt,
  mockEncrypt,
  mockEncryptBatch,
  mockDecryptBatch,
} from '../helpers/mock-encryption.helper';
import {
  ENCRYPT_FN,
  DECRYPT_FN,
  ENCRYPT_BATCH_FN,
  DECRYPT_BATCH_FN,
} from '../../encryption/encryption.token';
import { TranslateService } from '@ngx-translate/core';
import { SuperSyncStatusService } from '../../sync/super-sync-status.service';
import { ServerMigrationService } from '../../sync/server-migration.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { RejectedOpsHandlerService } from '../../sync/rejected-ops-handler.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';

// Mock Sync Provider that supports operation sync
class MockOperationSyncProvider
  implements SyncProviderServiceInterface<SyncProviderId>, OperationSyncCapable
{
  id = SyncProviderId.SuperSync;
  supportsOperationSync = true;
  maxConcurrentRequests = 1;

  // Mock configuration
  private _privateCfg: SuperSyncPrivateCfg = {
    accessToken: 'test-token',
    baseUrl: 'https://test.supersync.com',
    isEncryptionEnabled: false,
    encryptKey: undefined,
  };

  private _lastServerSeq = 0;
  private _uploadedOps: SyncOperation[] = [];

  // Mocks for configuration loading
  privateCfg = {
    load: async () => this._privateCfg,
  } as any;

  // Configuration helper
  setEncryption(enabled: boolean, key?: string): void {
    this._privateCfg.isEncryptionEnabled = enabled;
    this._privateCfg.encryptKey = key;
  }

  // getEncryptKey implementation for OperationSyncCapable interface
  async getEncryptKey(): Promise<string | undefined> {
    if (this._privateCfg.isEncryptionEnabled && this._privateCfg.encryptKey) {
      return this._privateCfg.encryptKey;
    }
    return undefined;
  }

  // Last Server Seq handling
  async getLastServerSeq(): Promise<number> {
    return this._lastServerSeq;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    this._lastServerSeq = seq;
  }

  // Operation Sync API
  async uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq: number,
  ): Promise<OpUploadResponse> {
    this._uploadedOps.push(...ops);
    const results = ops.map((op) => ({
      opId: op.id,
      accepted: true,
      serverSeq: ++this._lastServerSeq,
    }));
    return { results, latestSeq: this._lastServerSeq };
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient: string,
    limit: number,
  ): Promise<OpDownloadResponse> {
    // For simplicity, returns all uploaded ops that match criteria
    const newOps = this._uploadedOps
      .filter((op) => op.clientId !== excludeClient)
      .slice(0, limit)
      .map((op) => ({
        op,
        serverSeq: 1, // simplified
        receivedAt: Date.now(),
      }));

    return { ops: newOps, hasMore: false, latestSeq: this._lastServerSeq };
  }

  async uploadSnapshot(
    state: any,
    clientId: string,
    reason: string,
    vectorClock: any,
    schemaVersion: number,
  ): Promise<any> {
    return { accepted: true, serverSeq: ++this._lastServerSeq };
  }

  // Accessor for assertions
  getUploadedOps(): SyncOperation[] {
    return this._uploadedOps;
  }

  clearUploadedOps(): void {
    this._uploadedOps = [];
  }

  // Stub other required methods
  async init(): Promise<void> {}
  async isReady(): Promise<boolean> {
    return true;
  }
  async setPrivateCfg(cfg: any): Promise<void> {
    this._privateCfg = cfg;
  }

  async getFileRev(
    targetPath: string,
    localRev: string | null,
  ): Promise<{ rev: string }> {
    return { rev: 'rev' };
  }
  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    return { rev: 'rev', dataStr: '{}' };
  }
  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite?: boolean,
  ): Promise<{ rev: string }> {
    return { rev: 'new-rev' };
  }
  async removeFile(targetPath: string): Promise<void> {}

  async deleteAllData(): Promise<{ success: boolean }> {
    this._uploadedOps = [];
    this._lastServerSeq = 0;
    return { success: true };
  }
}

describe('Service Logic Integration', () => {
  let syncService: OperationLogSyncService;
  let opLogStore: OperationLogStoreService;
  let mockProvider: MockOperationSyncProvider;
  let conflictServiceSpy: jasmine.SpyObj<ConflictResolutionService>;
  let applierSpy: jasmine.SpyObj<OperationApplierService>;

  beforeEach(async () => {
    // Mock window.confirm to return true for fresh client confirmation
    // Use callFake if already spied, otherwise create new spy
    if (!(window.confirm as jasmine.Spy).and) {
      spyOn(window, 'confirm').and.returnValue(true);
    } else {
      (window.confirm as jasmine.Spy).and.returnValue(true);
    }

    // Spies for dependencies we don't want to execute fully
    conflictServiceSpy = jasmine.createSpyObj('ConflictResolutionService', [
      'autoResolveConflictsLWW',
      'checkOpForConflicts',
    ]);
    conflictServiceSpy.autoResolveConflictsLWW.and.returnValue(
      Promise.resolve({ localWinOpsCreated: 0 }),
    );
    // Intelligent mock that implements the actual conflict detection logic
    conflictServiceSpy.checkOpForConflicts.and.callFake(
      (
        remoteOp: Operation,
        ctx: {
          localPendingOpsByEntity: Map<string, Operation[]>;
          appliedFrontierByEntity: Map<string, VectorClock>;
          snapshotVectorClock: VectorClock | undefined;
          snapshotEntityKeys: Set<string> | undefined;
          hasNoSnapshotClock: boolean;
        },
      ): { isSupersededOrDuplicate: boolean; conflict: EntityConflict | null } => {
        const entityIdsToCheck =
          remoteOp.entityIds || (remoteOp.entityId ? [remoteOp.entityId] : []);

        for (const entityId of entityIdsToCheck) {
          const entityKey = toEntityKey(remoteOp.entityType, entityId);
          const localOpsForEntity = ctx.localPendingOpsByEntity.get(entityKey) || [];
          const appliedFrontier = ctx.appliedFrontierByEntity.get(entityKey);

          // Build local frontier
          const entityExistedAtSnapshot =
            ctx.snapshotEntityKeys === undefined || ctx.snapshotEntityKeys.has(entityKey);
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
    applierSpy = jasmine.createSpyObj('OperationApplierService', ['applyOperations']);
    applierSpy.applyOperations.and.returnValue(Promise.resolve({ appliedOps: [] }));

    // Create spy properly before using in TestBed
    const waitServiceSpy = jasmine.createSpyObj('UserInputWaitStateService', [
      'startWaiting',
    ]);
    waitServiceSpy.startWaiting.and.returnValue(() => {});

    const dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    dialogSpy.open.and.returnValue({ afterClosed: () => of(true) });

    // Mock SuperSyncStatusService
    const superSyncStatusSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'markRemoteChecked',
      'updatePendingOpsStatus',
      'clearScope',
    ]);

    // Mock ServerMigrationService
    const serverMigrationSpy = jasmine.createSpyObj('ServerMigrationService', [
      'checkAndHandleMigration',
      'handleServerMigration',
    ]);
    serverMigrationSpy.checkAndHandleMigration.and.returnValue(Promise.resolve());
    serverMigrationSpy.handleServerMigration.and.returnValue(Promise.resolve());

    // Mock OperationWriteFlushService
    const writeFlushSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    writeFlushSpy.flushPendingWrites.and.returnValue(Promise.resolve());

    // Mock RejectedOpsHandlerService
    const rejectedOpsHandlerSpy = jasmine.createSpyObj('RejectedOpsHandlerService', [
      'handleRejectedOps',
    ]);
    rejectedOpsHandlerSpy.handleRejectedOps.and.returnValue(Promise.resolve(0));

    // Mock SyncHydrationService
    const syncHydrationSpy = jasmine.createSpyObj('SyncHydrationService', [
      'hydrateFromRemoteSync',
    ]);
    syncHydrationSpy.hydrateFromRemoteSync.and.returnValue(Promise.resolve());

    // Mock OperationLogCompactionService
    const compactionSpy = jasmine.createSpyObj('OperationLogCompactionService', [
      'compact',
    ]);
    compactionSpy.compact.and.returnValue(Promise.resolve());

    // Use real SyncImportFilterService for SYNC_IMPORT filtering integration tests
    // Note: This must be the real service, not a mock, because we're testing the
    // filtering behavior. The service is provided via TestBed below.

    TestBed.configureTestingModule({
      providers: [
        OperationLogSyncService,
        OperationLogUploadService,
        OperationLogDownloadService,
        OperationEncryptionService,
        OperationLogStoreService,
        LockService,
        VectorClockService,
        SchemaMigrationService,
        RemoteOpsProcessingService,
        provideMockStore(),
        // Use fast mock encryption instead of real Argon2id (saves ~500ms per test)
        { provide: ENCRYPT_FN, useValue: mockEncrypt },
        { provide: DECRYPT_FN, useValue: mockDecrypt },
        { provide: ENCRYPT_BATCH_FN, useValue: mockEncryptBatch },
        { provide: DECRYPT_BATCH_FN, useValue: mockDecryptBatch },
        { provide: ConflictResolutionService, useValue: conflictServiceSpy },
        { provide: OperationApplierService, useValue: applierSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
        { provide: ServerMigrationService, useValue: serverMigrationSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushSpy },
        { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerSpy },
        { provide: SyncHydrationService, useValue: syncHydrationSpy },
        { provide: OperationLogCompactionService, useValue: compactionSpy },
        SyncImportFilterService, // Use real service for SYNC_IMPORT filtering tests
        {
          provide: ValidateStateService,
          useValue: jasmine.createSpyObj('ValidateStateService', [
            'validateAndRepairCurrentState',
          ]),
        },
        {
          provide: RepairOperationService,
          useValue: jasmine.createSpyObj('RepairOperationService', [
            'createRepairOperation',
          ]),
        },
        {
          provide: StateSnapshotService,
          useValue: jasmine.createSpyObj('StateSnapshotService', ['getStateSnapshot']),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: MatDialog,
          useValue: dialogSpy,
        },
        {
          provide: UserInputWaitStateService,
          useValue: waitServiceSpy,
        },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
      ],
    });

    syncService = TestBed.inject(OperationLogSyncService);
    opLogStore = TestBed.inject(OperationLogStoreService);

    mockProvider = new MockOperationSyncProvider();

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('Encryption Integration', () => {
    const TEST_KEY = 'test-encryption-key-123';

    it('should encrypt operations during upload', async (): Promise<void> => {
      // 1. Configure encryption
      mockProvider.setEncryption(true, TEST_KEY);

      // 2. Create local operation
      const op: Operation = {
        id: 'op-1',
        clientId: 'local-client',
        actionType: 'TEST' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Secret Task' },
        vectorClock: { localClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await opLogStore.append(op, 'local');

      // 3. Upload
      await syncService.uploadPendingOps(mockProvider);

      // 4. Verify uploaded data is encrypted
      const uploaded = mockProvider.getUploadedOps();
      expect(uploaded.length).toBe(1);
      const uploadedOp = uploaded[0];

      expect(uploadedOp.isPayloadEncrypted).toBe(true);
      expect(typeof uploadedOp.payload).toBe('string');

      // Attempt to decrypt to verify correctness
      const decryptedPayloadStr = await mockDecrypt(
        uploadedOp.payload as string,
        TEST_KEY,
      );
      const decryptedPayload = JSON.parse(decryptedPayloadStr);
      expect(decryptedPayload).toEqual(op.payload);
    });

    it('should decrypt operations during download', async (): Promise<void> => {
      // 1. Configure encryption
      mockProvider.setEncryption(true, TEST_KEY);

      // 2. Prepare encrypted remote operation
      const payload = { title: 'Remote Secret' };
      const encryptedPayload = await mockEncrypt(JSON.stringify(payload), TEST_KEY);

      const remoteOp: SyncOperation = {
        id: 'op-remote-1',
        clientId: 'remote-client', // Different client
        actionType: 'TEST' as ActionType,
        opType: OpType.Update as any,
        entityType: 'TASK' as any,
        entityId: 't1',
        payload: encryptedPayload,
        isPayloadEncrypted: true,
        vectorClock: { remoteClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Mock download to return this op
      spyOn(mockProvider, 'downloadOps').and.returnValue(
        Promise.resolve({
          ops: [{ op: remoteOp, serverSeq: 1, receivedAt: Date.now() }],
          hasMore: false,
          latestSeq: 1,
        }),
      );

      // 3. Download
      await syncService.downloadRemoteOps(mockProvider);

      // 4. Verify operation is applied with decrypted payload
      expect(applierSpy.applyOperations).toHaveBeenCalled();
      const appliedOps = applierSpy.applyOperations.calls.mostRecent().args[0];
      expect(appliedOps.length).toBe(1);
      expect(appliedOps[0].id).toBe('op-remote-1');
      expect(appliedOps[0].payload).toEqual(payload);
    });
  });

  describe('Conflict Dialog Integration', () => {
    it('should trigger conflict dialog when downloading conflicting op', async (): Promise<void> => {
      // 1. Create pending local operation
      const localOp: Operation = {
        id: 'op-local-1',
        clientId: 'local-client',
        actionType: 'TEST' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Local Version' },
        vectorClock: { localClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await opLogStore.append(localOp, 'local');

      // 2. Prepare conflicting remote operation (concurrent)
      const remoteOp: SyncOperation = {
        id: 'op-remote-1',
        clientId: 'remote-client',
        actionType: 'TEST' as ActionType,
        opType: OpType.Update as any,
        entityType: 'TASK' as any,
        entityId: 't1', // Same entity
        payload: { title: 'Remote Version' },
        vectorClock: { remoteClient: 1 }, // Concurrent vector clock
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Mock download
      spyOn(mockProvider, 'downloadOps').and.returnValue(
        Promise.resolve({
          ops: [{ op: remoteOp, serverSeq: 1, receivedAt: Date.now() }],
          hasMore: false,
          latestSeq: 1,
        }),
      );

      // 3. Download
      await syncService.downloadRemoteOps(mockProvider);

      // 4. Verify ConflictResolutionService.autoResolveConflictsLWW was called
      expect(conflictServiceSpy.autoResolveConflictsLWW).toHaveBeenCalled();
      const args = conflictServiceSpy.autoResolveConflictsLWW.calls.mostRecent().args;
      const conflicts = args[0];

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].entityId).toBe('t1');
      expect(conflicts[0].localOps[0].id).toBe('op-local-1');
      expect(conflicts[0].remoteOps[0].id).toBe('op-remote-1');
    });
  });

  describe('SYNC_IMPORT Filtering Integration', () => {
    /**
     * BUG REGRESSION TEST: Offline client operations should be filtered after SYNC_IMPORT
     *
     * Scenario:
     * 1. Client A and B are synced
     * 2. Client B goes offline and creates operations
     * 3. Client A does SYNC_IMPORT (replaces state)
     * 4. Client B comes online and uploads its ops to server
     * 5. Client A downloads B's ops
     *
     * Expected: B's ops should be FILTERED (not applied) because they were created
     * without knowledge of the SYNC_IMPORT (CONCURRENT vector clocks)
     *
     * This test verifies the vector clock-based filtering works correctly at the
     * integration level (through the full sync service flow).
     */
    it('should filter CONCURRENT ops from offline client after SYNC_IMPORT', async (): Promise<void> => {
      // 1. Store already has a SYNC_IMPORT from a previous sync (Client A imported)
      const importOp: Operation = {
        id: 'import-op-1',
        clientId: 'client-a',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'import-entity',
        payload: { appDataComplete: {} },
        vectorClock: { clientA: 5 }, // Import's vector clock
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await opLogStore.append(importOp, 'remote');

      // 2. Client B was offline and created ops WITHOUT knowledge of the import
      // (vector clocks are CONCURRENT - no clientA component, or lower clientA)
      const offlineOp1: SyncOperation = {
        id: 'offline-op-1',
        clientId: 'client-b',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update as any,
        entityType: 'TASK' as any,
        entityId: 'task-1',
        payload: { title: 'Offline change 1' },
        vectorClock: { clientB: 3 }, // CONCURRENT - no knowledge of clientA: 5
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const offlineOp2: SyncOperation = {
        id: 'offline-op-2',
        clientId: 'client-b',
        actionType: '[Task] Create Task' as ActionType,
        opType: OpType.Create as any,
        entityType: 'TASK' as any,
        entityId: 'task-2',
        payload: { title: 'Offline task' },
        vectorClock: { clientA: 2, clientB: 4 }, // CONCURRENT - clientA:2 < import's clientA:5
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // 3. Mock download to return these offline ops (B uploaded after coming online)
      spyOn(mockProvider, 'downloadOps').and.returnValue(
        Promise.resolve({
          ops: [
            { op: offlineOp1, serverSeq: 1, receivedAt: Date.now() },
            { op: offlineOp2, serverSeq: 2, receivedAt: Date.now() },
          ],
          hasMore: false,
          latestSeq: 2,
        }),
      );

      // 4. Download and process remote ops
      await syncService.downloadRemoteOps(mockProvider);

      // 5. EXPECTED: Both ops should be filtered - NOT passed to applier
      // Because they have CONCURRENT vector clocks with the SYNC_IMPORT
      if (applierSpy.applyOperations.calls.count() > 0) {
        const appliedOps = applierSpy.applyOperations.calls.mostRecent().args[0];
        // Neither offline op should be applied
        expect(
          appliedOps.find((op: Operation) => op.id === 'offline-op-1'),
        ).toBeUndefined();
        expect(
          appliedOps.find((op: Operation) => op.id === 'offline-op-2'),
        ).toBeUndefined();
      }
      // If applyOperations wasn't called at all, that's also correct (no ops to apply)
    });

    /**
     * Test: Operations created WITH knowledge of SYNC_IMPORT should be kept
     *
     * After Client B syncs and sees the SYNC_IMPORT, any new ops it creates
     * should have vector clocks that are GREATER_THAN the import.
     */
    it('should keep operations created after seeing SYNC_IMPORT', async (): Promise<void> => {
      // 1. Store has SYNC_IMPORT
      const importOp: Operation = {
        id: 'import-op-2',
        clientId: 'client-a',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'import-entity-2',
        payload: { appDataComplete: {} },
        vectorClock: { clientA: 5 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await opLogStore.append(importOp, 'remote');

      // 2. Client B saw the import and then created new ops
      // (vector clock is GREATER_THAN - includes import's clock)
      const postImportOp: SyncOperation = {
        id: 'post-import-op-1',
        clientId: 'client-b',
        actionType: '[Task] Create Task' as ActionType,
        opType: OpType.Create as any,
        entityType: 'TASK' as any,
        entityId: 'new-task-1',
        payload: { title: 'Post-import task' },
        vectorClock: { clientA: 5, clientB: 1 }, // GREATER_THAN - includes import's clock
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // 3. Mock download
      spyOn(mockProvider, 'downloadOps').and.returnValue(
        Promise.resolve({
          ops: [{ op: postImportOp, serverSeq: 3, receivedAt: Date.now() }],
          hasMore: false,
          latestSeq: 3,
        }),
      );

      // 4. Download
      await syncService.downloadRemoteOps(mockProvider);

      // 5. EXPECTED: Op should be applied (not filtered)
      expect(applierSpy.applyOperations).toHaveBeenCalled();
      const appliedOps = applierSpy.applyOperations.calls.mostRecent().args[0];
      const appliedOp = appliedOps.find((op: Operation) => op.id === 'post-import-op-1');
      expect(appliedOp).toBeDefined();
      expect(appliedOp!.payload).toEqual({ title: 'Post-import task' });
    });

    /**
     * CLOCK DRIFT REGRESSION TEST: Filtering should work even with future UUIDv7 timestamps
     *
     * This tests the key advantage of vector clocks over UUIDv7:
     * Even if client B's clock is ahead (ops have future timestamps), vector clocks
     * correctly identify that B had no knowledge of the import.
     */
    it('should filter offline ops even when client clock was ahead (clock drift)', async (): Promise<void> => {
      // 1. Store has SYNC_IMPORT
      const importOp: Operation = {
        id: 'import-clock-drift',
        clientId: 'client-a',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: 'import-drift',
        payload: { appDataComplete: {} },
        vectorClock: { clientA: 5 },
        timestamp: Date.now() - 3600000, // Import was 1 hour ago
        schemaVersion: 1,
      };
      await opLogStore.append(importOp, 'remote');

      // 2. Client B was offline, clock was 2 hours AHEAD
      // In the OLD (broken) UUIDv7 approach, this op would have a "future" timestamp
      // and bypass filtering. With vector clocks, it's correctly identified as CONCURRENT.
      const driftOp: SyncOperation = {
        // This UUIDv7 would be in the "future" due to clock drift
        id: '019afd90-0001-7000-0000-000000000000',
        clientId: 'client-b',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update as any,
        entityType: 'TASK' as any,
        entityId: 'task-drift',
        payload: { title: 'Created with drifted clock' },
        vectorClock: { clientB: 3 }, // CONCURRENT - no knowledge of import
        timestamp: Date.now() + 7200000, // 2 hours in the "future" (clock drift)
        schemaVersion: 1,
      };

      // 3. Mock download
      spyOn(mockProvider, 'downloadOps').and.returnValue(
        Promise.resolve({
          ops: [{ op: driftOp, serverSeq: 4, receivedAt: Date.now() }],
          hasMore: false,
          latestSeq: 4,
        }),
      );

      // 4. Download
      await syncService.downloadRemoteOps(mockProvider);

      // 5. EXPECTED: Op should be filtered despite having "future" timestamp
      // Vector clock comparison correctly identifies it as CONCURRENT
      if (applierSpy.applyOperations.calls.count() > 0) {
        const appliedOps = applierSpy.applyOperations.calls.mostRecent().args[0];
        expect(
          appliedOps.find(
            (op: Operation) => op.id === '019afd90-0001-7000-0000-000000000000',
          ),
        ).toBeUndefined();
      }
    });
  });
});

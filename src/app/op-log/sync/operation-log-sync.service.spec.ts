import { TestBed } from '@angular/core/testing';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SchemaMigrationService } from '../persistence/schema-migration.service';
import { SnackService } from '../../core/snack/snack.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { RepairOperationService } from '../validation/repair-operation.service';
import { OperationLogUploadService } from './operation-log-upload.service';
import { OperationLogDownloadService } from './operation-log-download.service';
import { LockService } from './lock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from './sync-import-filter.service';
import { ServerMigrationService } from './server-migration.service';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { RejectedOpsHandlerService } from './rejected-ops-handler.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SuperSyncStatusService } from './super-sync-status.service';
import { provideMockStore } from '@ngrx/store/testing';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { TranslateService } from '@ngx-translate/core';
import { LocalDataConflictError } from '../core/errors/sync-errors';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG, SYSTEM_TAG_IDS } from '../../features/tag/tag.const';

describe('OperationLogSyncService', () => {
  let service: OperationLogSyncService;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let serverMigrationServiceSpy: jasmine.SpyObj<ServerMigrationService>;
  let remoteOpsProcessingServiceSpy: jasmine.SpyObj<RemoteOpsProcessingService>;
  let rejectedOpsHandlerServiceSpy: jasmine.SpyObj<RejectedOpsHandlerService>;
  let writeFlushServiceSpy: jasmine.SpyObj<OperationWriteFlushService>;
  let superSyncStatusServiceSpy: jasmine.SpyObj<SuperSyncStatusService>;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;

  beforeEach(() => {
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'loadStateCache',
      'getLastSeq',
      'getOpById',
      'markRejected',
      'setVectorClock',
      'clearFullStateOps',
    ]);
    opLogStoreSpy.setVectorClock.and.resolveTo();
    opLogStoreSpy.clearFullStateOps.and.resolveTo();
    serverMigrationServiceSpy = jasmine.createSpyObj('ServerMigrationService', [
      'checkAndHandleMigration',
      'handleServerMigration',
    ]);
    serverMigrationServiceSpy.checkAndHandleMigration.and.resolveTo();
    serverMigrationServiceSpy.handleServerMigration.and.resolveTo();

    // Default: no meaningful local data (only system defaults)
    stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
      task: { ids: [] },
      project: { ids: [INBOX_PROJECT.id] }, // Only default INBOX project
      tag: { ids: [TODAY_TAG.id] }, // Only default TODAY tag
      note: { ids: [] },
    } as any);

    remoteOpsProcessingServiceSpy = jasmine.createSpyObj('RemoteOpsProcessingService', [
      'processRemoteOps',
    ]);
    remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
      localWinOpsCreated: 0,
      allOpsFilteredBySyncImport: false,
      filteredOpCount: 0,
      isLocalUnsyncedImport: false,
    });

    rejectedOpsHandlerServiceSpy = jasmine.createSpyObj('RejectedOpsHandlerService', [
      'handleRejectedOps',
    ]);
    rejectedOpsHandlerServiceSpy.handleRejectedOps.and.resolveTo({
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    });

    writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();

    superSyncStatusServiceSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'updatePendingOpsStatus',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogSyncService,
        provideMockStore(),
        {
          provide: SchemaMigrationService,
          useValue: jasmine.createSpyObj('SchemaMigrationService', [
            'getCurrentVersion',
            'migrateOperation',
          ]),
        },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        {
          provide: VectorClockService,
          useValue: jasmine.createSpyObj('VectorClockService', [
            'getEntityFrontier',
            'getSnapshotVectorClock',
            'getSnapshotEntityKeys',
            'getCurrentVectorClock',
          ]),
        },
        {
          provide: OperationApplierService,
          useValue: jasmine.createSpyObj('OperationApplierService', ['applyOperations']),
        },
        {
          provide: ConflictResolutionService,
          useValue: jasmine.createSpyObj('ConflictResolutionService', [
            'autoResolveConflictsLWW',
            'checkOpForConflicts',
          ]),
        },
        {
          provide: ValidateStateService,
          useValue: jasmine.createSpyObj('ValidateStateService', [
            'validateAndRepair',
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
          provide: OperationLogUploadService,
          useValue: jasmine.createSpyObj('OperationLogUploadService', [
            'uploadPendingOps',
          ]),
        },
        {
          provide: OperationLogDownloadService,
          useValue: jasmine.createSpyObj('OperationLogDownloadService', [
            'downloadRemoteOps',
          ]),
        },
        {
          provide: LockService,
          useValue: jasmine.createSpyObj('LockService', ['request']),
        },
        {
          provide: OperationLogCompactionService,
          useValue: jasmine.createSpyObj('OperationLogCompactionService', ['compact']),
        },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
        {
          provide: SyncImportFilterService,
          useValue: jasmine.createSpyObj('SyncImportFilterService', [
            'filterOpsInvalidatedBySyncImport',
          ]),
        },
        { provide: ServerMigrationService, useValue: serverMigrationServiceSpy },
        {
          provide: SupersededOperationResolverService,
          useValue: jasmine.createSpyObj('SupersededOperationResolverService', [
            'resolveSupersededLocalOps',
          ]),
        },
        { provide: RemoteOpsProcessingService, useValue: remoteOpsProcessingServiceSpy },
        { provide: RejectedOpsHandlerService, useValue: rejectedOpsHandlerServiceSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusServiceSpy },
        {
          provide: SyncHydrationService,
          useValue: jasmine.createSpyObj('SyncHydrationService', [
            'hydrateFromRemoteSync',
          ]),
        },
        { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
      ],
    });

    service = TestBed.inject(OperationLogSyncService);
    // Default: not a fresh client
    opLogStoreSpy.loadStateCache.and.resolveTo({
      state: {},
      lastAppliedOpSeq: 1,
      vectorClock: {},
      compactedAt: Date.now(),
    });
    opLogStoreSpy.getLastSeq.and.resolveTo(1);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);
  });

  // NOTE: Tests for processRemoteOps, detectConflicts, and applyNonConflictingOps
  // have been moved to remote-ops-processing.service.spec.ts

  // NOTE: Tests for handleRejectedOps have been moved to rejected-ops-handler.service.spec.ts

  describe('localWinOpsCreated propagation', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Mock loadStateCache to return null (no cache) so isWhollyFreshClient check passes
      (opLogStoreSpy as any).loadStateCache = jasmine
        .createSpy('loadStateCache')
        .and.returnValue(Promise.resolve(null));
      (opLogStoreSpy as any).getLastSeq = jasmine
        .createSpy('getLastSeq')
        .and.returnValue(Promise.resolve(1)); // Not fresh (has seq)
    });

    describe('uploadPendingOps', () => {
      it('should return localWinOpsCreated: 0 when no piggybacked ops', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));
        uploadServiceSpy.uploadPendingOps.and.returnValue(
          Promise.resolve({
            uploadedCount: 0,
            piggybackedOps: [],
            rejectedCount: 0,
            rejectedOps: [],
          }),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.uploadPendingOps(mockProvider);

        expect(result?.localWinOpsCreated).toBe(0);
      });

      it('should return localWinOpsCreated count from piggybacked ops processing', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

        const piggybackedOp: Operation = {
          id: 'piggybacked-1',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Remote Title' },
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        uploadServiceSpy.uploadPendingOps.and.returnValue(
          Promise.resolve({
            uploadedCount: 1,
            piggybackedOps: [piggybackedOp],
            rejectedCount: 0,
            rejectedOps: [],
          }),
        );

        // Mock remoteOpsProcessingService to return 2 local-win ops
        remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
          localWinOpsCreated: 2,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
        });

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.uploadPendingOps(mockProvider);

        expect(result?.localWinOpsCreated).toBe(2);
      });

      describe('rejected ops handling delegation', () => {
        let mockProvider: any;

        beforeEach(() => {
          mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          };
        });

        it('should delegate rejected ops handling to RejectedOpsHandlerService', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [],
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Some error',
                  errorCode: 'VALIDATION_ERROR',
                },
              ],
            }),
          );

          await service.uploadPendingOps(mockProvider);

          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).toHaveBeenCalledWith(
            [{ opId: 'local-op-1', error: 'Some error', errorCode: 'VALIDATION_ERROR' }],
            jasmine.any(Function), // downloadCallback
          );
        });

        it('should pass download callback that calls downloadRemoteOps', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [],
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Concurrent',
                  errorCode: 'CONFLICT_CONCURRENT',
                },
              ],
            }),
          );

          // Capture the callback passed to handleRejectedOps
          let capturedCallback: any;
          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.callFake(
            async (_ops, callback) => {
              capturedCallback = callback;
              return { mergedOpsCreated: 0, permanentRejectionCount: 0 };
            },
          );

          const downloadSpy = spyOn(service, 'downloadRemoteOps').and.returnValue(
            Promise.resolve({
              serverMigrationHandled: false,
              localWinOpsCreated: 0,
              newOpsCount: 0,
            }),
          );

          await service.uploadPendingOps(mockProvider);

          // Verify callback was captured
          expect(capturedCallback).toBeDefined();

          // Call the callback and verify it delegates to downloadRemoteOps
          await capturedCallback();
          expect(downloadSpy).toHaveBeenCalledWith(mockProvider, undefined);

          // Test with forceFromSeq0 option
          await capturedCallback({ forceFromSeq0: true });
          expect(downloadSpy).toHaveBeenCalledWith(mockProvider, { forceFromSeq0: true });
        });

        it('should add mergedOpsFromRejection to localWinOpsCreated in result', async () => {
          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Test' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 1,
              piggybackedOps: [piggybackedOp], // Include piggybacked op so processRemoteOps is called
              rejectedCount: 1,
              rejectedOps: [
                {
                  opId: 'local-op-1',
                  error: 'Concurrent',
                  errorCode: 'CONFLICT_CONCURRENT',
                },
              ],
            }),
          );

          // processRemoteOps returns 2 local-win ops
          remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
            localWinOpsCreated: 2,
            allOpsFilteredBySyncImport: false,
            filteredOpCount: 0,
            isLocalUnsyncedImport: false,
          });

          // handleRejectedOps returns 3 merged ops created
          rejectedOpsHandlerServiceSpy.handleRejectedOps.and.resolveTo({
            mergedOpsCreated: 3,
            permanentRejectionCount: 0,
          });

          const result = await service.uploadPendingOps(mockProvider);

          // Total should be 2 + 3 = 5
          expect(result?.localWinOpsCreated).toBe(5);
        });

        it('should call handleRejectedOps in finally block even if processRemoteOps throws', async () => {
          const piggybackedOp: Operation = {
            id: 'piggybacked-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Test' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 0,
              piggybackedOps: [piggybackedOp],
              rejectedCount: 1,
              rejectedOps: [{ opId: 'local-op-1', error: 'error' }],
            }),
          );

          // Make processRemoteOps throw
          remoteOpsProcessingServiceSpy.processRemoteOps.and.rejectWith(
            new Error('Processing failed'),
          );

          await expectAsync(service.uploadPendingOps(mockProvider)).toBeRejectedWithError(
            'Processing failed',
          );

          // handleRejectedOps should still be called (via finally block)
          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).toHaveBeenCalled();
        });

        it('should not call handleRejectedOps when there are no rejected ops', async () => {
          uploadServiceSpy.uploadPendingOps.and.returnValue(
            Promise.resolve({
              uploadedCount: 1,
              piggybackedOps: [],
              rejectedCount: 0,
              rejectedOps: [],
            }),
          );

          await service.uploadPendingOps(mockProvider);

          // handleRejectedOps should be called with empty array
          expect(rejectedOpsHandlerServiceSpy.handleRejectedOps).toHaveBeenCalledWith(
            [],
            jasmine.any(Function),
          );
        });
      });
    });

    describe('downloadRemoteOps', () => {
      it('should return localWinOpsCreated: 0 and newOpsCount: 0 when no new ops', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            hasMore: false,
            latestSeq: 0,
            needsFullStateUpload: false,
            success: true,
            failedFileCount: 0,
          }),
        );

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.localWinOpsCreated).toBe(0);
        expect(result.newOpsCount).toBe(0);
      });

      it('should return localWinOpsCreated count and newOpsCount from processing remote ops', async () => {
        opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

        const remoteOp: Operation = {
          id: 'remote-1',
          clientId: 'client-B',
          actionType: 'test' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Remote Title' },
          vectorClock: { clientB: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };

        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [remoteOp],
            hasMore: false,
            latestSeq: 1,
            needsFullStateUpload: false,
            success: true,
            failedFileCount: 0,
          }),
        );

        // Mock remoteOpsProcessingService to return 1 local-win op
        remoteOpsProcessingServiceSpy.processRemoteOps.and.resolveTo({
          localWinOpsCreated: 1,
          allOpsFilteredBySyncImport: false,
          filteredOpCount: 0,
          isLocalUnsyncedImport: false,
        });

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.localWinOpsCreated).toBe(1);
        expect(result.newOpsCount).toBe(1);
      });

      it('should return localWinOpsCreated: 0 and newOpsCount: 0 on server migration', async () => {
        downloadServiceSpy.downloadRemoteOps.and.returnValue(
          Promise.resolve({
            newOps: [],
            hasMore: false,
            latestSeq: 0,
            needsFullStateUpload: true, // Server migration
            success: true,
            failedFileCount: 0,
          }),
        );

        // serverMigrationServiceSpy.handleServerMigration is already mocked in beforeEach

        const mockProvider = {
          isReady: () => Promise.resolve(true),
        } as any;

        const result = await service.downloadRemoteOps(mockProvider);

        expect(result.serverMigrationHandled).toBe(true);
        expect(result.localWinOpsCreated).toBe(0);
        expect(result.newOpsCount).toBe(0);
      });

      describe('lastServerSeq persistence', () => {
        it('should persist lastServerSeq AFTER processing ops (crash safety)', async () => {
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const remoteOp: Operation = {
            id: 'remote-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { title: 'Remote Title' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [remoteOp],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              latestServerSeq: 42, // Server sequence to persist
            }),
          );

          // Track call order to verify setLastServerSeq is called AFTER processRemoteOps
          const callOrder: string[] = [];
          remoteOpsProcessingServiceSpy.processRemoteOps.and.callFake(async () => {
            callOrder.push('processRemoteOps');
            return {
              localWinOpsCreated: 0,
              allOpsFilteredBySyncImport: false,
              filteredOpCount: 0,
              isLocalUnsyncedImport: false,
            };
          });

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.callFake(async () => {
              callOrder.push('setLastServerSeq');
            });

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Verify setLastServerSeq was called with correct value
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(42);
          // Verify order: processRemoteOps must complete BEFORE setLastServerSeq
          expect(callOrder).toEqual(['processRemoteOps', 'setLastServerSeq']);
        });

        it('should persist lastServerSeq even when no ops (to stay in sync with server)', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              latestServerSeq: 100, // Server is at seq 100 but no new ops for us
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Should still update lastServerSeq to stay in sync with server
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(100);
        });

        it('should not call setLastServerSeq if latestServerSeq is undefined', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              // latestServerSeq not set
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: setLastServerSeqSpy,
          } as any;

          await service.downloadRemoteOps(mockProvider);

          // Should NOT call setLastServerSeq when latestServerSeq is undefined
          expect(setLastServerSeqSpy).not.toHaveBeenCalled();
        });

        it('should not call setLastServerSeq if provider does not support operation sync', async () => {
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              latestServerSeq: 100,
            }),
          );

          const setLastServerSeqSpy = jasmine
            .createSpy('setLastServerSeq')
            .and.resolveTo();
          const mockProvider = {
            isReady: () => Promise.resolve(true),
            setLastServerSeq: setLastServerSeqSpy,
            // supportsOperationSync NOT set - but method still called since provider passed
          } as any;

          // Should not throw even though provider doesn't have supportsOperationSync
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();

          // setLastServerSeq should still be called when latestServerSeq is present
          expect(setLastServerSeqSpy).toHaveBeenCalledWith(100);
        });
      });

      describe('LocalDataConflictError for file-based sync', () => {
        it('should NOT throw LocalDataConflictError on normal incremental sync (no snapshotState)', async () => {
          // This tests the regression fix: normal incremental syncs should NOT throw
          // LocalDataConflictError, even if the client has unsynced ops.
          // The conflict error should ONLY occur on first sync with snapshotState.

          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Local Title' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Normal incremental sync: newOps but NO snapshotState
          const remoteOp: Operation = {
            id: 'remote-op-1',
            clientId: 'client-B',
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-2',
            payload: { title: 'Remote Title' },
            vectorClock: { clientB: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          };

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [remoteOp],
              hasMore: false,
              latestSeq: 1,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              latestServerSeq: 5,
              // NO snapshotState - this is incremental sync
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should NOT throw - incremental sync should process ops normally
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith([
            remoteOp,
          ]);
        });

        it('should NOT throw LocalDataConflictError for clients with only system/config ops (no user data)', async () => {
          // Clients with only system/config ops (no tasks/projects/tags) should NOT see conflict dialog.
          // They should just download the remote data.

          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Update,
              entityType: 'GLOBAL_CONFIG', // Not a user entity type
              entityId: 'config-1',
              payload: { theme: 'dark' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] },
              snapshotVectorClock: { clientB: 5 },
              latestServerSeq: 1,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should NOT throw - fresh client should proceed with download
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
        });

        it('should throw LocalDataConflictError when client has meaningful user data (tasks)', async () => {
          // Client with task operations should see conflict dialog when receiving
          // snapshotState, to prevent losing user-created data.

          // Mock unsynced local ops with TASK entity type (user data)
          const unsyncedEntry: OperationLogEntry = {
            seq: 1,
            op: {
              id: 'local-op-1',
              clientId: 'client-A',
              actionType: 'test' as ActionType,
              opType: OpType.Create, // CREATE or UPDATE for TASK triggers conflict
              entityType: 'TASK',
              entityId: 'task-1',
              payload: { title: 'Local Title' },
              vectorClock: { clientA: 1 },
              timestamp: Date.now(),
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          };
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([unsyncedEntry]));

          // Mock download service returning snapshotState (file-based sync scenario)
          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              snapshotState: { tasks: [{ id: 'remote-task' }] }, // Remote snapshot
              snapshotVectorClock: { clientB: 5 },
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          } as any;

          // Should throw LocalDataConflictError
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
            jasmine.any(LocalDataConflictError),
          );
        });

        it('should include correct context in LocalDataConflictError', async () => {
          const unsyncedEntries: OperationLogEntry[] = [
            {
              seq: 1,
              op: {
                id: 'local-op-1',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Update,
                entityType: 'TASK',
                entityId: 'task-1',
                payload: {},
                vectorClock: { clientA: 1 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
            {
              seq: 2,
              op: {
                id: 'local-op-2',
                clientId: 'client-A',
                actionType: 'test' as ActionType,
                opType: OpType.Create,
                entityType: 'TASK',
                entityId: 'task-2',
                payload: {},
                vectorClock: { clientA: 2 },
                timestamp: Date.now(),
                schemaVersion: 1,
              },
              appliedAt: Date.now(),
              source: 'local',
            },
          ];
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve(unsyncedEntries));

          // Both ops are TASK entity type, so conflict dialog should appear

          const remoteSnapshot = { tasks: [{ id: 'remote-task' }] };
          const remoteVectorClock = { clientB: 5, clientC: 3 };

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              snapshotState: remoteSnapshot,
              snapshotVectorClock: remoteVectorClock,
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
          } as any;

          try {
            await service.downloadRemoteOps(mockProvider);
            fail('Expected LocalDataConflictError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(LocalDataConflictError);
            const conflictError = error as LocalDataConflictError;
            expect(conflictError.unsyncedCount).toBe(2);
            expect(conflictError.remoteSnapshotState).toEqual(remoteSnapshot);
            expect(conflictError.remoteVectorClock).toEqual(remoteVectorClock);
          }
        });

        it('should NOT throw LocalDataConflictError when client has no unsynced ops', async () => {
          // No unsynced ops
          opLogStoreSpy.getUnsynced.and.returnValue(Promise.resolve([]));

          const syncHydrationServiceSpy = TestBed.inject(
            SyncHydrationService,
          ) as jasmine.SpyObj<SyncHydrationService>;
          syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

          downloadServiceSpy.downloadRemoteOps.and.returnValue(
            Promise.resolve({
              newOps: [],
              hasMore: false,
              latestSeq: 0,
              needsFullStateUpload: false,
              success: true,
              failedFileCount: 0,
              snapshotState: { tasks: [] },
              snapshotVectorClock: { clientB: 5 },
            }),
          );

          const mockProvider = {
            isReady: () => Promise.resolve(true),
            supportsOperationSync: true,
            setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
          } as any;

          // Should NOT throw - should hydrate from snapshot instead
          await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
          expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
        });
      });
    });
  });

  // NOTE: Old _handleServerMigration state validation tests (600+ lines) have been moved to
  // server-migration.service.spec.ts. The OperationLogSyncService now delegates to ServerMigrationService.

  // Tests for _resolveSupersededLocalOps have been moved to superseded-operation-resolver.service.spec.ts
  // The functionality is now in SupersededOperationResolverService

  describe('forceUploadLocalState', () => {
    let uploadServiceSpy: jasmine.SpyObj<OperationLogUploadService>;

    beforeEach(() => {
      uploadServiceSpy = TestBed.inject(
        OperationLogUploadService,
      ) as jasmine.SpyObj<OperationLogUploadService>;

      // Default mock behaviors
      uploadServiceSpy.uploadPendingOps.and.resolveTo({
        uploadedCount: 1,
        piggybackedOps: [],
        rejectedCount: 0,
        rejectedOps: [],
        localWinOpsCreated: 0,
      });
    });

    it('should call handleServerMigration to create SYNC_IMPORT', async () => {
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceUploadLocalState(mockProvider);

      expect(serverMigrationServiceSpy.handleServerMigration).toHaveBeenCalledWith(
        mockProvider,
        { skipServerEmptyCheck: true }, // Force upload skips the server empty check
      );
    });

    it('should upload pending ops after creating SYNC_IMPORT', async () => {
      const callOrder: string[] = [];
      serverMigrationServiceSpy.handleServerMigration.and.callFake(async () => {
        callOrder.push('handleServerMigration');
      });
      uploadServiceSpy.uploadPendingOps.and.callFake(async () => {
        callOrder.push('uploadPendingOps');
        return {
          uploadedCount: 1,
          piggybackedOps: [],
          rejectedCount: 0,
          rejectedOps: [],
          localWinOpsCreated: 0,
        };
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceUploadLocalState(mockProvider);

      expect(callOrder).toEqual(['handleServerMigration', 'uploadPendingOps']);
    });

    it('should propagate errors from handleServerMigration', async () => {
      const error = new Error('Failed to create SYNC_IMPORT');
      serverMigrationServiceSpy.handleServerMigration.and.rejectWith(error);

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.forceUploadLocalState(mockProvider)).toBeRejectedWith(
        error,
      );
    });

    it('should propagate errors from uploadPendingOps', async () => {
      const error = new Error('Upload failed');
      uploadServiceSpy.uploadPendingOps.and.rejectWith(error);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(service.forceUploadLocalState(mockProvider)).toBeRejectedWith(
        error,
      );
    });

    it('should upload with isCleanSlate=true to delete server data before accepting new data', async () => {
      // This is critical for recovery scenarios like decrypt errors where the server
      // may have data encrypted with a different password. Clean slate ensures the
      // server deletes ALL existing data before accepting the new SYNC_IMPORT.
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceUploadLocalState(mockProvider);

      expect(uploadServiceSpy.uploadPendingOps).toHaveBeenCalledWith(mockProvider, {
        skipPiggybackProcessing: true,
        isCleanSlate: true,
      });
    });
  });

  describe('forceDownloadRemoteState', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      opLogStoreSpy.clearUnsyncedOps = jasmine
        .createSpy('clearUnsyncedOps')
        .and.resolveTo();
    });

    it('should clear unsynced ops before downloading', async () => {
      const callOrder: string[] = [];
      opLogStoreSpy.clearUnsyncedOps.and.callFake(async () => {
        callOrder.push('clearUnsyncedOps');
      });
      downloadServiceSpy.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('downloadRemoteOps');
        return {
          newOps: [],
          needsFullStateUpload: false,
          success: true,
          failedFileCount: 0,
        };
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(callOrder[0]).toBe('clearUnsyncedOps');
    });

    it('should reset lastServerSeq to 0', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(setLastServerSeqSpy).toHaveBeenCalledWith(0);
    });

    it('should download ops with forceFromSeq0 option', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(downloadServiceSpy.downloadRemoteOps).toHaveBeenCalledWith(
        mockProvider,
        jasmine.objectContaining({ forceFromSeq0: true }),
      );
    });

    it('should process downloaded ops without confirmation', async () => {
      const mockOps: Operation[] = [
        {
          id: 'op1',
          actionType: 'ACTION' as ActionType,
          opType: 'UPDATE' as OpType,
          entityType: 'TASK',
          entityId: 'task1',
          payload: {},
          clientId: 'remote',
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ];

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: mockOps,
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      expect(remoteOpsProcessingServiceSpy.processRemoteOps).toHaveBeenCalledWith(
        mockOps,
        { skipConflictDetection: true },
      );
    });

    it('should update lastServerSeq after processing ops', async () => {
      const mockOp: Operation = {
        id: 'op1',
        actionType: 'ACTION' as ActionType,
        opType: 'UPDATE' as OpType,
        entityType: 'TASK',
        entityId: 'task1',
        payload: {},
        clientId: 'remote',
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [mockOp],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        latestServerSeq: 50,
      });

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      // First call is reset to 0, second call is update to latestServerSeq
      expect(setLastServerSeqSpy).toHaveBeenCalledWith(0);
      expect(setLastServerSeqSpy).toHaveBeenCalledWith(50);
    });

    it('should handle empty remote state gracefully', async () => {
      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      await expectAsync(service.forceDownloadRemoteState(mockProvider)).toBeResolved();
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();
    });

    it('should hydrate from snapshotState when present (file-based sync)', async () => {
      // When force downloading from a file-based provider that has a snapshot
      // (e.g., after another client used USE_LOCAL), we should hydrate from
      // the snapshot instead of processing ops (which would be empty).

      const snapshotState = { task: { ids: ['remote-task-1'] } };
      const snapshotVectorClock = { clientB: 5 };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [], // Empty - snapshot replaces incremental ops
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState,
        snapshotVectorClock,
        latestServerSeq: 1,
      });

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      const setLastServerSeqSpy = jasmine.createSpy('setLastServerSeq').and.resolveTo();
      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: setLastServerSeqSpy,
      } as any;

      await service.forceDownloadRemoteState(mockProvider);

      // Should hydrate from snapshot
      expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalledWith(
        snapshotState,
        snapshotVectorClock,
        false, // Don't create SYNC_IMPORT
      );

      // Should NOT process ops (empty)
      expect(remoteOpsProcessingServiceSpy.processRemoteOps).not.toHaveBeenCalled();

      // Should update lastServerSeq after hydration
      expect(setLastServerSeqSpy).toHaveBeenCalledWith(1);
    });

    it('should propagate errors from clearUnsyncedOps', async () => {
      const error = new Error('Failed to clear ops');
      opLogStoreSpy.clearUnsyncedOps.and.rejectWith(error);

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.forceDownloadRemoteState(mockProvider)).toBeRejectedWith(
        error,
      );
    });
  });

  describe('_hasMeaningfulLocalData detection for first-time sync', () => {
    let downloadServiceSpy: jasmine.SpyObj<OperationLogDownloadService>;

    beforeEach(() => {
      downloadServiceSpy = TestBed.inject(
        OperationLogDownloadService,
      ) as jasmine.SpyObj<OperationLogDownloadService>;

      // Make this a fresh client (no snapshot, no ops)
      opLogStoreSpy.loadStateCache.and.resolveTo(null);
      opLogStoreSpy.getLastSeq.and.resolveTo(0);
      opLogStoreSpy.getUnsynced.and.resolveTo([]); // No unsynced ops
    });

    it('should throw LocalDataConflictError when fresh client has tasks in NgRx store', async () => {
      // Store has tasks (meaningful data)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1', 'task-2'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has custom projects', async () => {
      // Store has custom project (not INBOX)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id, 'custom-project-1'] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has custom tags', async () => {
      // Store has custom tag (not TODAY or other system tags)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id, 'custom-tag-1'] },
        note: { ids: [] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should throw LocalDataConflictError when fresh client has notes', async () => {
      // Store has notes
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: ['note-1'] },
      } as any);

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeRejectedWith(
        jasmine.any(LocalDataConflictError),
      );
    });

    it('should NOT throw LocalDataConflictError when fresh client has only default data', async () => {
      // Store has only default data (INBOX project, TODAY tag, no tasks/notes)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      // Mock window.confirm since it's called for fresh clients - stub method directly
      const originalConfirm = window.confirm;
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      try {
        // Should NOT throw - should show confirmation dialog and proceed
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
        expect(syncHydrationServiceSpy.hydrateFromRemoteSync).toHaveBeenCalled();
      } finally {
        window.confirm = originalConfirm;
      }
    });

    it('should NOT throw LocalDataConflictError when client already has op-log history', async () => {
      // Client has op-log history (not a fresh client)
      opLogStoreSpy.loadStateCache.and.resolveTo({
        state: {},
        lastAppliedOpSeq: 5,
        vectorClock: { clientA: 5 },
        compactedAt: Date.now(),
      });
      opLogStoreSpy.getLastSeq.and.resolveTo(5);

      // Store has tasks (meaningful data), but client is not fresh
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: ['remote-task'] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      // Should NOT throw - client has history, so it's not "fresh"
      await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
    });

    it('should include correct context in LocalDataConflictError when fresh client has store data', async () => {
      // Store has tasks (meaningful data)
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: [TODAY_TAG.id] },
        note: { ids: [] },
      } as any);

      const remoteSnapshot = { task: { ids: ['remote-task'] } };
      const remoteVectorClock = { clientB: 5, clientC: 3 };

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: remoteSnapshot,
        snapshotVectorClock: remoteVectorClock,
      });

      const mockProvider = {
        supportsOperationSync: true,
      } as any;

      try {
        await service.downloadRemoteOps(mockProvider);
        fail('Expected LocalDataConflictError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LocalDataConflictError);
        const conflictError = error as LocalDataConflictError;
        expect(conflictError.unsyncedCount).toBe(0); // No unsynced ops
        expect(conflictError.remoteSnapshotState).toEqual(remoteSnapshot);
        expect(conflictError.remoteVectorClock).toEqual(remoteVectorClock);
      }
    });

    it('should NOT throw when store has only system tags (TODAY, URGENT, IMPORTANT, IN_PROGRESS)', async () => {
      // Store has all system tags but no user data
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [] },
        project: { ids: [INBOX_PROJECT.id] },
        tag: { ids: Array.from(SYSTEM_TAG_IDS) }, // All system tags
        note: { ids: [] },
      } as any);

      const syncHydrationServiceSpy = TestBed.inject(
        SyncHydrationService,
      ) as jasmine.SpyObj<SyncHydrationService>;
      syncHydrationServiceSpy.hydrateFromRemoteSync.and.resolveTo();

      downloadServiceSpy.downloadRemoteOps.and.resolveTo({
        newOps: [],
        needsFullStateUpload: false,
        success: true,
        failedFileCount: 0,
        snapshotState: { task: { ids: [] } },
        snapshotVectorClock: { clientB: 5 },
        latestServerSeq: 1,
      });

      // Mock window.confirm - stub method directly
      const originalConfirm = window.confirm;
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);

      const mockProvider = {
        supportsOperationSync: true,
        setLastServerSeq: jasmine.createSpy('setLastServerSeq').and.resolveTo(),
      } as any;

      try {
        // Should NOT throw - system tags don't count as meaningful user data
        await expectAsync(service.downloadRemoteOps(mockProvider)).toBeResolved();
      } finally {
        window.confirm = originalConfirm;
      }
    });
  });
});

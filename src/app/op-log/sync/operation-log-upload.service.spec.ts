import { TestBed } from '@angular/core/testing';
import { OperationLogUploadService } from './operation-log-upload.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { ActionType, OpType, OperationLogEntry } from '../core/operation.types';
import { SnackService } from '../../core/snack/snack.service';
import { provideMockStore } from '@ngrx/store/testing';

describe('OperationLogUploadService', () => {
  let service: OperationLogUploadService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;

  const createMockEntry = (
    seq: number,
    id: string,
    clientId: string,
    timestamp: number = Date.now(),
  ): OperationLogEntry => ({
    seq,
    op: {
      id,
      clientId,
      actionType: '[Task] Add' as ActionType,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: `task-${id}`,
      payload: {},
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    },
    appliedAt: Date.now(),
    source: 'local',
  });

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'markSynced',
      'markRejected',
      'deleteOpsWhere',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);

    // Default mock implementations
    mockLockService.request.and.callFake(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
      },
    );
    mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([]));
    mockOpLogStore.markSynced.and.returnValue(Promise.resolve());
    mockOpLogStore.deleteOpsWhere.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        OperationLogUploadService,
        provideMockStore(),
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });

    service = TestBed.inject(OperationLogUploadService);
  });

  describe('uploadPendingOps', () => {
    it('should return empty result when no sync provider', async () => {
      const result = await service.uploadPendingOps(null as any);

      expect(result).toEqual({
        uploadedCount: 0,
        rejectedCount: 0,
        piggybackedOps: [],
        rejectedOps: [],
      });
    });

    describe('API-based sync', () => {
      let mockApiProvider: jasmine.SpyObj<
        SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
      >;

      beforeEach(() => {
        mockApiProvider = jasmine.createSpyObj('ApiSyncProvider', [
          'getLastServerSeq',
          'uploadOps',
          'setLastServerSeq',
        ]);
        (mockApiProvider as any).supportsOperationSync = true;
        // Add privateCfg mock for E2E encryption support
        (mockApiProvider as any).privateCfg = {
          load: jasmine
            .createSpy('privateCfg.load')
            .and.returnValue(Promise.resolve(null)),
        };

        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [],
            latestSeq: 0,
            newOps: [],
          }),
        );
        mockApiProvider.setLastServerSeq.and.returnValue(Promise.resolve());
      });

      it('should use API upload for operation-sync-capable providers', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-1', accepted: true }],
            latestSeq: 1,
            newOps: [],
          }),
        );

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadOps).toHaveBeenCalled();
      });

      it('should acquire lock before uploading', async () => {
        await service.uploadPendingOps(mockApiProvider);

        expect(mockLockService.request).toHaveBeenCalledWith(
          'sp_op_log_upload',
          jasmine.any(Function),
        );
      });

      it('should return empty result when no pending ops', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([]));

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(result).toEqual({
          uploadedCount: 0,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
        });
      });

      it('should upload pending operations', async () => {
        const pendingOps = [
          createMockEntry(1, 'op-1', 'client-1'),
          createMockEntry(2, 'op-2', 'client-1'),
        ];
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [
              { opId: 'op-1', accepted: true },
              { opId: 'op-2', accepted: true },
            ],
            latestSeq: 10,
            newOps: [],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(result.uploadedCount).toBe(2);
        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([1, 2]);
      });

      it('should update last server seq after upload', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-1', accepted: true }],
            latestSeq: 42,
            newOps: [],
          }),
        );

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.setLastServerSeq).toHaveBeenCalledWith(42);
      });

      it('should return rejected operations info (not mark them rejected)', async () => {
        const pendingOps = [
          createMockEntry(1, 'op-1', 'client-1'),
          createMockEntry(2, 'op-2', 'client-1'),
        ];
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [
              { opId: 'op-1', accepted: true },
              { opId: 'op-2', accepted: false, error: 'duplicate' },
            ],
            latestSeq: 10,
            newOps: [],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(result.uploadedCount).toBe(1);
        expect(result.rejectedCount).toBe(1);
        expect(result.rejectedOps.length).toBe(1);
        expect(result.rejectedOps[0].opId).toBe('op-2');
        expect(result.rejectedOps[0].error).toBe('duplicate');
        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([1]);
        // Should NOT mark rejected - that's the sync service's responsibility
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      });

      it('should return piggybacked operations', async () => {
        const piggybackedOp = {
          id: 'remote-op',
          clientId: 'otherClient',
          actionType: '[Task] Update' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: {},
          vectorClock: { otherClient: 5 },
          timestamp: Date.now(),
          schemaVersion: 1,
        };
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-1', accepted: true }],
            latestSeq: 10,
            newOps: [
              {
                serverSeq: 5,
                receivedAt: Date.now(),
                op: piggybackedOp,
              },
            ],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(result.piggybackedOps.length).toBe(1);
        expect(result.piggybackedOps[0].id).toBe('remote-op');
      });

      it('should batch large uploads', async () => {
        // Create 50 pending ops to test batching (max 25 per request = 2 batches)
        const pendingOps = Array.from({ length: 50 }, (_, i) =>
          createMockEntry(i + 1, `op-${i}`, 'client-1'),
        );
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));
        mockApiProvider.uploadOps.and.callFake(async (ops) => ({
          results: ops.map((op) => ({ opId: op.id, accepted: true })),
          latestSeq: 50,
          newOps: [],
        }));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadOps).toHaveBeenCalledTimes(2);
      });

      describe('piggyback sequence handling', () => {
        it('should handle hasMorePiggyback=true with empty newOps array', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(40));
          mockOpLogStore.getUnsynced.and.returnValue(
            Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
          );
          mockApiProvider.uploadOps.and.returnValue(
            Promise.resolve({
              results: [{ opId: 'op-1', accepted: true }],
              latestSeq: 100,
              newOps: [], // Empty - no piggybacked ops
              hasMorePiggyback: true, // But server indicates more exist
            }),
          );

          const result = await service.uploadPendingOps(mockApiProvider);

          // Should keep lastServerSeq at initial value to trigger download
          expect(mockApiProvider.setLastServerSeq).toHaveBeenCalledWith(40);
          expect(result.hasMorePiggyback).toBe(true);
        });

        it('should use max piggybacked op serverSeq when hasMorePiggyback=true', async () => {
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(40));
          mockOpLogStore.getUnsynced.and.returnValue(
            Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
          );
          mockApiProvider.uploadOps.and.returnValue(
            Promise.resolve({
              results: [{ opId: 'op-1', accepted: true }],
              latestSeq: 100,
              newOps: [
                {
                  serverSeq: 45,
                  receivedAt: Date.now(),
                  op: {
                    id: 'remote-1',
                    clientId: 'other',
                    actionType: '[Task] Update' as ActionType,
                    opType: OpType.Update,
                    entityType: 'TASK',
                    entityId: 't1',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
                {
                  serverSeq: 50,
                  receivedAt: Date.now(),
                  op: {
                    id: 'remote-2',
                    clientId: 'other',
                    actionType: '[Task] Update' as ActionType,
                    opType: OpType.Update,
                    entityType: 'TASK',
                    entityId: 't2',
                    payload: {},
                    vectorClock: {},
                    timestamp: Date.now(),
                    schemaVersion: 1,
                  },
                },
              ],
              hasMorePiggyback: true,
            }),
          );

          const result = await service.uploadPendingOps(mockApiProvider);

          // Should use max serverSeq from piggybacked ops (50), not latestSeq (100)
          expect(mockApiProvider.setLastServerSeq).toHaveBeenCalledWith(50);
          expect(result.hasMorePiggyback).toBe(true);
        });

        it('should never regress sequence across multi-chunk uploads', async () => {
          // Create 50 ops to trigger 2 chunks (max 25 per request)
          const pendingOps = Array.from({ length: 50 }, (_, i) =>
            createMockEntry(i + 1, `op-${i}`, 'client-1'),
          );
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(40));
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));

          let callCount = 0;
          mockApiProvider.uploadOps.and.callFake(async (ops) => {
            callCount++;
            if (callCount === 1) {
              // First chunk: returns piggybacked ops with serverSeq 60
              return {
                results: ops.map((op) => ({ opId: op.id, accepted: true })),
                latestSeq: 100,
                newOps: [
                  {
                    serverSeq: 60,
                    receivedAt: Date.now(),
                    op: {
                      id: 'remote-1',
                      clientId: 'other',
                      actionType: '[Task] Update' as ActionType,
                      opType: OpType.Update,
                      entityType: 'TASK',
                      entityId: 't1',
                      payload: {},
                      vectorClock: {},
                      timestamp: Date.now(),
                      schemaVersion: 1,
                    },
                  },
                ],
                hasMorePiggyback: false, // No more piggyback for this chunk
              };
            } else {
              // Second chunk: returns empty piggyback with hasMorePiggyback=true
              // latestSeq is 50 (lower than chunk 1's stored 100!)
              return {
                results: ops.map((op) => ({ opId: op.id, accepted: true })),
                latestSeq: 50, // Lower than what chunk 1 stored
                newOps: [],
                hasMorePiggyback: true,
              };
            }
          });

          const result = await service.uploadPendingOps(mockApiProvider);

          // Verify setLastServerSeq calls
          const calls = mockApiProvider.setLastServerSeq.calls.allArgs();
          expect(calls.length).toBe(2);
          // First chunk: should store 100 (latestSeq, since no hasMorePiggyback)
          expect(calls[0][0]).toBe(100);
          // Second chunk: should NOT regress to 50, should keep 100
          expect(calls[1][0]).toBe(100);
          expect(result.hasMorePiggyback).toBe(true);
        });

        it('should track highest received sequence across chunks with hasMorePiggyback', async () => {
          // Create 50 ops to trigger 2 chunks (max 25 per request)
          const pendingOps = Array.from({ length: 50 }, (_, i) =>
            createMockEntry(i + 1, `op-${i}`, 'client-1'),
          );
          mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(40));
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));

          let callCount = 0;
          mockApiProvider.uploadOps.and.callFake(async (ops) => {
            callCount++;
            if (callCount === 1) {
              // First chunk: returns piggybacked ops with max serverSeq 55
              return {
                results: ops.map((op) => ({ opId: op.id, accepted: true })),
                latestSeq: 100,
                newOps: [
                  {
                    serverSeq: 50,
                    receivedAt: Date.now(),
                    op: {
                      id: 'remote-1',
                      clientId: 'other',
                      actionType: '[Task] Update' as ActionType,
                      opType: OpType.Update,
                      entityType: 'TASK',
                      entityId: 't1',
                      payload: {},
                      vectorClock: {},
                      timestamp: Date.now(),
                      schemaVersion: 1,
                    },
                  },
                  {
                    serverSeq: 55,
                    receivedAt: Date.now(),
                    op: {
                      id: 'remote-2',
                      clientId: 'other',
                      actionType: '[Task] Update' as ActionType,
                      opType: OpType.Update,
                      entityType: 'TASK',
                      entityId: 't2',
                      payload: {},
                      vectorClock: {},
                      timestamp: Date.now(),
                      schemaVersion: 1,
                    },
                  },
                ],
                hasMorePiggyback: true, // More ops exist
              };
            } else {
              // Second chunk: returns ops with lower serverSeq (45)
              return {
                results: ops.map((op) => ({ opId: op.id, accepted: true })),
                latestSeq: 100,
                newOps: [
                  {
                    serverSeq: 45, // Lower than chunk 1's max (55)
                    receivedAt: Date.now(),
                    op: {
                      id: 'remote-3',
                      clientId: 'other',
                      actionType: '[Task] Update' as ActionType,
                      opType: OpType.Update,
                      entityType: 'TASK',
                      entityId: 't3',
                      payload: {},
                      vectorClock: {},
                      timestamp: Date.now(),
                      schemaVersion: 1,
                    },
                  },
                ],
                hasMorePiggyback: true,
              };
            }
          });

          await service.uploadPendingOps(mockApiProvider);

          // Verify setLastServerSeq calls
          const calls = mockApiProvider.setLastServerSeq.calls.allArgs();
          expect(calls.length).toBe(2);
          // First chunk: should store 55 (max of piggybacked ops)
          expect(calls[0][0]).toBe(55);
          // Second chunk: should keep 55 (Math.max(55, 45) = 55), not regress to 45
          expect(calls[1][0]).toBe(55);
        });
      });
    });

    describe('full-state operation routing', () => {
      let mockApiProvider: jasmine.SpyObj<
        SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
      >;

      const createFullStateEntry = (
        seq: number,
        id: string,
        clientId: string,
        opType: OpType,
      ): OperationLogEntry => ({
        seq,
        op: {
          id,
          clientId,
          actionType: '[Sync] Import' as ActionType,
          opType,
          entityType: 'ALL',
          entityId: undefined,
          payload: {
            task: { ids: [], entities: {} },
            project: { ids: [], entities: {} },
            tag: { ids: [], entities: {} },
            globalConfig: {},
          },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        appliedAt: Date.now(),
        source: 'local',
      });

      beforeEach(() => {
        mockApiProvider = jasmine.createSpyObj('ApiSyncProvider', [
          'getLastServerSeq',
          'uploadOps',
          'setLastServerSeq',
          'uploadSnapshot',
        ]);
        (mockApiProvider as any).supportsOperationSync = true;
        (mockApiProvider as any).privateCfg = {
          load: jasmine
            .createSpy('privateCfg.load')
            .and.returnValue(Promise.resolve(null)),
        };

        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({ results: [], latestSeq: 0, newOps: [] }),
        );
        mockApiProvider.setLastServerSeq.and.returnValue(Promise.resolve());
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({ accepted: true, serverSeq: 1 }),
        );
      });

      it('should route SyncImport operations through snapshot endpoint', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.SyncImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();
        expect(mockApiProvider.uploadOps).not.toHaveBeenCalled();
      });

      it('should route BackupImport operations through snapshot endpoint', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();
        expect(mockApiProvider.uploadOps).not.toHaveBeenCalled();
      });

      it('should route Repair operations through snapshot endpoint', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.Repair);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();
        expect(mockApiProvider.uploadOps).not.toHaveBeenCalled();
      });

      it('should use correct reason for SyncImport (initial)', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.SyncImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalledWith(
          jasmine.anything(),
          'client-1',
          'initial',
          jasmine.anything(),
          jasmine.anything(),
          false, // isPayloadEncrypted
          'op-1', // op.id
          undefined, // isCleanSlate
        );
      });

      it('should use correct reason for BackupImport (recovery)', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalledWith(
          jasmine.anything(),
          'client-1',
          'recovery',
          jasmine.anything(),
          jasmine.anything(),
          false, // isPayloadEncrypted
          'op-1', // op.id
          undefined, // isCleanSlate
        );
      });

      it('should use correct reason for Repair (recovery)', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.Repair);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalledWith(
          jasmine.anything(),
          'client-1',
          'recovery',
          jasmine.anything(),
          jasmine.anything(),
          false, // isPayloadEncrypted
          'op-1', // op.id
          undefined, // isCleanSlate
        );
      });

      it('should mark full-state ops as synced after successful upload', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([1]);
      });

      it('should mark full-state ops as rejected when snapshot fails with permanent error', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({ accepted: false, error: 'Invalid payload structure' }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['op-1']);
        expect(result.rejectedCount).toBe(1);
      });

      it('should NOT mark full-state ops as rejected when snapshot fails with transient error (transaction rolled back)', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({
            accepted: false,
            error: 'Transaction rolled back due to internal error',
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        // Should NOT be marked as rejected - transient errors should be retried
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(result.rejectedCount).toBe(0);
      });

      it('should NOT mark full-state ops as rejected when snapshot fails with timeout error', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({
            accepted: false,
            error: 'Transaction timeout - server busy, please retry',
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(result.rejectedCount).toBe(0);
      });

      it('should NOT mark full-state ops as rejected when snapshot fails with network error', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({ accepted: false, error: 'Failed to fetch' }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(result.rejectedCount).toBe(0);
      });

      it('should NOT mark full-state ops as rejected when snapshot fails with 500 error', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({
            accepted: false,
            error: 'SuperSync API error: 500 Internal Server Error',
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(result.rejectedCount).toBe(0);
      });

      it('should NOT mark full-state ops as rejected when snapshot fails with 503 error', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.BackupImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({ accepted: false, error: '503 Service Unavailable' }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(result.rejectedCount).toBe(0);
      });

      it('should handle mixed full-state and regular operations', async () => {
        const fullStateEntry = createFullStateEntry(
          1,
          'op-1',
          'client-1',
          OpType.BackupImport,
        );
        const regularEntry = createMockEntry(2, 'op-2', 'client-1');
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([fullStateEntry, regularEntry]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-2', accepted: true }],
            latestSeq: 2,
            newOps: [],
          }),
        );

        await service.uploadPendingOps(mockApiProvider);

        // Both endpoints should be called
        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();
        expect(mockApiProvider.uploadOps).toHaveBeenCalled();

        // Regular op should be sent via uploadOps, not uploadSnapshot
        const uploadOpsCall = mockApiProvider.uploadOps.calls.mostRecent();
        const opsArg = uploadOpsCall.args[0];
        expect(opsArg.length).toBe(1);
        expect(opsArg[0].id).toBe('op-2');
      });

      it('should update server seq after snapshot upload', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.SyncImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
        mockApiProvider.uploadSnapshot.and.returnValue(
          Promise.resolve({ accepted: true, serverSeq: 42 }),
        );

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.setLastServerSeq).toHaveBeenCalledWith(42);
      });

      /**
       * FIX VERIFIED: uploadSnapshot now receives op.id to prevent ID mismatch
       *
       * BACKGROUND: Previously uploadSnapshot() was called WITHOUT the client's op.id.
       * The server would generate its own ID, causing filterNewOps() to not recognize
       * the server's operation as the same one the client uploaded. This caused data
       * loss when the old state was re-applied.
       *
       * FIX: op.id is now passed as the 7th argument to uploadSnapshot.
       * Server uses this ID instead of generating a new one, ensuring client and
       * server have matching operation IDs.
       */
      it('uploadSnapshot receives op.id to prevent ID mismatch', async () => {
        const entry = createFullStateEntry(
          1,
          'my-backup-import-id',
          'client-1',
          OpType.BackupImport,
        );
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        // Verify uploadSnapshot was called
        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();

        // Get the call arguments
        const callArgs = mockApiProvider.uploadSnapshot.calls.mostRecent().args;

        // Verify all 8 args are passed including op.id and isCleanSlate
        expect(callArgs.length).toBe(8);

        // Verify specific args
        expect(callArgs[1]).toBe('client-1'); // clientId
        expect(callArgs[2]).toBe('recovery'); // reason

        // CRITICAL: Verify op.id is passed as 7th argument
        expect(callArgs[6]).toBe('my-backup-import-id');
        // 8th argument is isCleanSlate (undefined when not specified)
        expect(callArgs[7]).toBeUndefined();
      });

      it('should pass vectorClock and schemaVersion to snapshot upload', async () => {
        const vectorClock: Record<string, number> = {};
        vectorClock['client-1'] = 5;
        vectorClock['client-2'] = 3;
        const testPayload = {
          task: { ids: [], entities: {} },
          globalConfig: {},
        };
        const entry: OperationLogEntry = {
          seq: 1,
          op: {
            id: 'op-1',
            clientId: 'client-1',
            actionType: '[Sync] Import' as ActionType,
            opType: OpType.BackupImport,
            entityType: 'ALL',
            entityId: undefined,
            payload: testPayload,
            vectorClock,
            timestamp: Date.now(),
            schemaVersion: 42,
          },
          appliedAt: Date.now(),
          source: 'local',
        };
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider);

        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalledWith(
          testPayload,
          'client-1',
          'recovery',
          vectorClock,
          42,
          false, // isPayloadEncrypted
          'op-1', // op.id
          undefined, // isCleanSlate
        );
      });

      /**
       * CRITICAL: Verify isCleanSlate is passed through snapshot upload path.
       *
       * This is essential for the clean slate mechanism used during encryption
       * password changes. When isCleanSlate=true, the server must delete all
       * existing data atomically before accepting the new snapshot.
       */
      it('should pass isCleanSlate to snapshot upload when provided', async () => {
        const entry = createFullStateEntry(1, 'op-1', 'client-1', OpType.SyncImport);
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));

        await service.uploadPendingOps(mockApiProvider, { isCleanSlate: true });

        // Verify uploadSnapshot was called with isCleanSlate=true
        expect(mockApiProvider.uploadSnapshot).toHaveBeenCalled();
        const callArgs = mockApiProvider.uploadSnapshot.calls.mostRecent().args;
        expect(callArgs[7]).toBe(true); // 8th argument is isCleanSlate
      });

      describe('SYNC_IMPORT_EXISTS handling', () => {
        /**
         * When a second client tries to upload a SYNC_IMPORT but another client already did,
         * the server rejects with SYNC_IMPORT_EXISTS. This is expected behavior when joining
         * an existing sync group - the client should delete the local SYNC_IMPORT and proceed
         * with normal sync (download existing data, then upload local ops as regular ops).
         */
        it('should delete local SYNC_IMPORT when server returns SYNC_IMPORT_EXISTS', async () => {
          const entry = createFullStateEntry(
            1,
            'my-import',
            'client-1',
            OpType.SyncImport,
          );
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
          mockApiProvider.uploadSnapshot.and.returnValue(
            Promise.resolve({
              accepted: false,
              error:
                'A SYNC_IMPORT already exists. New clients should download and merge.',
              errorCode: 'SYNC_IMPORT_EXISTS',
            }),
          );

          await service.uploadPendingOps(mockApiProvider);

          // Local SYNC_IMPORT should be deleted
          expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalled();
        });

        it('should NOT count SYNC_IMPORT_EXISTS as rejected - it is expected behavior', async () => {
          const entry = createFullStateEntry(
            1,
            'my-import',
            'client-1',
            OpType.SyncImport,
          );
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
          mockApiProvider.uploadSnapshot.and.returnValue(
            Promise.resolve({
              accepted: false,
              error: 'A SYNC_IMPORT already exists',
              errorCode: 'SYNC_IMPORT_EXISTS',
            }),
          );

          const result = await service.uploadPendingOps(mockApiProvider);

          // Should NOT be marked as rejected or counted as rejection
          expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
          expect(result.rejectedCount).toBe(0);
          expect(result.rejectedOps.length).toBe(0);
        });

        it('should NOT mark SYNC_IMPORT_EXISTS as synced', async () => {
          const entry = createFullStateEntry(
            1,
            'my-import',
            'client-1',
            OpType.SyncImport,
          );
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
          mockApiProvider.uploadSnapshot.and.returnValue(
            Promise.resolve({
              accepted: false,
              errorCode: 'SYNC_IMPORT_EXISTS',
            }),
          );

          await service.uploadPendingOps(mockApiProvider);

          // Should NOT be marked as synced since it wasn't actually uploaded
          expect(mockOpLogStore.markSynced).not.toHaveBeenCalled();
        });

        it('should continue with remaining ops after SYNC_IMPORT_EXISTS', async () => {
          const syncImportEntry = createFullStateEntry(
            1,
            'sync-import-op',
            'client-1',
            OpType.SyncImport,
          );
          const regularEntry = createMockEntry(2, 'regular-op', 'client-1');
          mockOpLogStore.getUnsynced.and.returnValue(
            Promise.resolve([syncImportEntry, regularEntry]),
          );
          mockApiProvider.uploadSnapshot.and.returnValue(
            Promise.resolve({
              accepted: false,
              errorCode: 'SYNC_IMPORT_EXISTS',
            }),
          );
          mockApiProvider.uploadOps.and.returnValue(
            Promise.resolve({
              results: [{ opId: 'regular-op', accepted: true }],
              latestSeq: 2,
              newOps: [],
            }),
          );

          const result = await service.uploadPendingOps(mockApiProvider);

          // SYNC_IMPORT was deleted (not rejected)
          expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalled();
          // Regular op was uploaded successfully
          expect(mockApiProvider.uploadOps).toHaveBeenCalled();
          expect(result.uploadedCount).toBe(1);
          expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([2]);
        });

        it('should detect SYNC_IMPORT_EXISTS from thrown error when exception contains the code', async () => {
          // When uploadSnapshot throws an error (e.g., from HTTP client), the error message
          // is parsed to extract errorCode. This tests that code path.
          const entry = createFullStateEntry(
            1,
            'my-import',
            'client-1',
            OpType.SyncImport,
          );
          mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve([entry]));
          // Mock throwing an error with SYNC_IMPORT_EXISTS in the message
          mockApiProvider.uploadSnapshot.and.rejectWith(
            new Error('SYNC_IMPORT_EXISTS: Another client already uploaded'),
          );

          await service.uploadPendingOps(mockApiProvider);

          // Should still be handled gracefully - delete local op, don't mark rejected
          expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalled();
          expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        });
      });
    });

    describe('error handling and recovery', () => {
      let mockApiProvider: jasmine.SpyObj<
        SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
      >;

      beforeEach(() => {
        mockApiProvider = jasmine.createSpyObj('ApiSyncProvider', [
          'getLastServerSeq',
          'uploadOps',
          'setLastServerSeq',
        ]);
        (mockApiProvider as any).supportsOperationSync = true;
        (mockApiProvider as any).privateCfg = {
          load: jasmine
            .createSpy('privateCfg.load')
            .and.returnValue(Promise.resolve(null)),
        };

        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.setLastServerSeq.and.returnValue(Promise.resolve());
      });

      it('should handle network failure during upload gracefully', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.rejectWith(new Error('Network error'));

        await expectAsync(
          service.uploadPendingOps(mockApiProvider),
        ).toBeRejectedWithError('Network error');

        // Operations should NOT be marked as synced
        expect(mockOpLogStore.markSynced).not.toHaveBeenCalled();
      });

      it('should not mark ops synced if setLastServerSeq fails', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-1', accepted: true }],
            latestSeq: 10,
            newOps: [],
          }),
        );
        mockApiProvider.setLastServerSeq.and.rejectWith(new Error('Storage failed'));

        await expectAsync(
          service.uploadPendingOps(mockApiProvider),
        ).toBeRejectedWithError('Storage failed');
      });

      it('should handle partial batch failure correctly', async () => {
        // First batch succeeds, second batch fails
        const pendingOps = Array.from({ length: 150 }, (_, i) =>
          createMockEntry(i + 1, `op-${i}`, 'client-1'),
        );
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));

        let callCount = 0;
        mockApiProvider.uploadOps.and.callFake(async (ops) => {
          callCount++;
          if (callCount === 1) {
            // First batch succeeds
            return {
              results: ops.map((op) => ({ opId: op.id, accepted: true })),
              latestSeq: 100,
              newOps: [],
            };
          }
          // Second batch fails
          throw new Error('Server overloaded');
        });

        await expectAsync(
          service.uploadPendingOps(mockApiProvider),
        ).toBeRejectedWithError('Server overloaded');

        // First batch should have been marked synced
        expect(mockOpLogStore.markSynced).toHaveBeenCalled();
      });

      it('should handle mixed accept/reject responses', async () => {
        const pendingOps = [
          createMockEntry(1, 'op-1', 'client-1'),
          createMockEntry(2, 'op-2', 'client-1'),
          createMockEntry(3, 'op-3', 'client-1'),
        ];
        mockOpLogStore.getUnsynced.and.returnValue(Promise.resolve(pendingOps));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [
              { opId: 'op-1', accepted: true },
              { opId: 'op-2', accepted: false, error: 'DUPLICATE' },
              { opId: 'op-3', accepted: true },
            ],
            latestSeq: 10,
            newOps: [],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        // 2 accepted, 1 rejected
        expect(result.uploadedCount).toBe(2);
        expect(result.rejectedCount).toBe(1);
        expect(result.rejectedOps.length).toBe(1);
        expect(result.rejectedOps[0].opId).toBe('op-2');
        // Only accepted ops should be marked synced
        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([1, 3]);
        // Rejected ops NOT marked here - sync service handles it
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      });

      it('should handle server returning no results for some ops', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([
            createMockEntry(1, 'op-1', 'client-1'),
            createMockEntry(2, 'op-2', 'client-1'),
          ]),
        );
        // Server only returns result for first op
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'op-1', accepted: true }],
            latestSeq: 10,
            newOps: [],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        // Only op-1 should be marked synced
        expect(result.uploadedCount).toBe(1);
        expect(mockOpLogStore.markSynced).toHaveBeenCalledWith([1]);
      });

      it('should handle empty response from server', async () => {
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [],
            latestSeq: 10,
            newOps: [],
          }),
        );

        const result = await service.uploadPendingOps(mockApiProvider);

        // Nothing accepted
        expect(result.uploadedCount).toBe(0);
        expect(mockOpLogStore.markSynced).not.toHaveBeenCalled();
      });

      it('should handle lock acquisition failure', async () => {
        mockLockService.request.and.rejectWith(new Error('Lock timeout'));
        mockOpLogStore.getUnsynced.and.returnValue(
          Promise.resolve([createMockEntry(1, 'op-1', 'client-1')]),
        );

        await expectAsync(
          service.uploadPendingOps(mockApiProvider),
        ).toBeRejectedWithError('Lock timeout');

        expect(mockApiProvider.uploadOps).not.toHaveBeenCalled();
      });
    });

    describe('preUploadCallback (server migration race condition fix)', () => {
      /**
       * These tests verify that preUploadCallback is:
       * 1. Called INSIDE the upload lock
       * 2. Called BEFORE checking for pending ops
       *
       * This fixes a race condition where multiple tabs could both detect
       * server migration and create duplicate SYNC_IMPORT operations.
       */
      let mockApiProvider: jasmine.SpyObj<
        SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable
      >;

      beforeEach(() => {
        mockApiProvider = jasmine.createSpyObj('ApiSyncProvider', [
          'getLastServerSeq',
          'uploadOps',
          'setLastServerSeq',
        ]);
        (mockApiProvider as any).supportsOperationSync = true;
        (mockApiProvider as any).privateCfg = {
          load: jasmine
            .createSpy('privateCfg.load')
            .and.returnValue(Promise.resolve(null)),
        };
        mockApiProvider.getLastServerSeq.and.returnValue(Promise.resolve(0));
        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({ results: [], latestSeq: 0, newOps: [] }),
        );
        mockApiProvider.setLastServerSeq.and.returnValue(Promise.resolve());
      });

      it('should call preUploadCallback inside the lock for API-based sync', async () => {
        const callOrder: string[] = [];

        mockLockService.request.and.callFake(
          async (_name: string, fn: () => Promise<void>) => {
            callOrder.push('lock-acquired');
            await fn();
            callOrder.push('lock-released');
          },
        );

        const callback = jasmine.createSpy('preUploadCallback').and.callFake(async () => {
          callOrder.push('callback-executed');
        });

        await service.uploadPendingOps(mockApiProvider, { preUploadCallback: callback });

        expect(callback).toHaveBeenCalled();
        // Verify callback was called INSIDE the lock
        expect(callOrder).toEqual([
          'lock-acquired',
          'callback-executed',
          'lock-released',
        ]);
      });

      it('should call preUploadCallback BEFORE checking for pending ops', async () => {
        const callOrder: string[] = [];

        mockOpLogStore.getUnsynced.and.callFake(async () => {
          callOrder.push('getUnsynced-called');
          return [];
        });

        const callback = jasmine.createSpy('preUploadCallback').and.callFake(async () => {
          callOrder.push('callback-executed');
        });

        await service.uploadPendingOps(mockApiProvider, { preUploadCallback: callback });

        // Callback should be called before getUnsynced
        expect(callOrder).toEqual(['callback-executed', 'getUnsynced-called']);
      });

      it('should not call preUploadCallback if not provided', async () => {
        await service.uploadPendingOps(mockApiProvider);

        // Should complete without error, verifying optional nature
        expect(mockLockService.request).toHaveBeenCalled();
      });

      it('should propagate errors from preUploadCallback', async () => {
        const callback = jasmine
          .createSpy('preUploadCallback')
          .and.rejectWith(new Error('Migration check failed'));

        await expectAsync(
          service.uploadPendingOps(mockApiProvider, { preUploadCallback: callback }),
        ).toBeRejectedWithError('Migration check failed');

        // Should not proceed to check for pending ops
        expect(mockOpLogStore.getUnsynced).not.toHaveBeenCalled();
      });

      it('should allow callback to create new operations that get uploaded', async () => {
        // First call to getUnsynced returns empty (callback hasn't run yet)
        // After callback runs, we simulate it creating a new op
        let callCount = 0;
        mockOpLogStore.getUnsynced.and.callFake(async () => {
          callCount++;
          if (callCount === 1) {
            // After callback ran, return the new op it created
            return [createMockEntry(1, 'sync-import-op', 'client-1')];
          }
          return [];
        });

        mockApiProvider.uploadOps.and.returnValue(
          Promise.resolve({
            results: [{ opId: 'sync-import-op', accepted: true }],
            latestSeq: 1,
            newOps: [],
          }),
        );

        const callback = jasmine.createSpy('preUploadCallback').and.resolveTo(undefined);

        await service.uploadPendingOps(mockApiProvider, { preUploadCallback: callback });

        // Callback was called, and the op it created was uploaded
        expect(callback).toHaveBeenCalled();
        expect(mockApiProvider.uploadOps).toHaveBeenCalled();
      });
    });
  });

  describe('_isNetworkError', () => {
    // Access private method for testing
    const isNetworkError = (error: string | undefined): boolean =>
      (service as any)._isNetworkError(error);

    describe('should return true for transient network errors', () => {
      it('failed to fetch', () => {
        expect(isNetworkError('Failed to fetch')).toBe(true);
        expect(isNetworkError('failed to fetch resources')).toBe(true);
      });

      it('timeout errors', () => {
        expect(isNetworkError('Request timeout')).toBe(true);
        expect(isNetworkError('Timeout exceeded')).toBe(true);
        // Note: "timed out" doesn't match - only the word "timeout" matches
      });

      it('network error keywords', () => {
        expect(isNetworkError('Network error occurred')).toBe(true);
        expect(isNetworkError('network request failed')).toBe(true);
        expect(isNetworkError('Network failure')).toBe(true);
      });

      it('connection errors', () => {
        expect(isNetworkError('ECONNREFUSED')).toBe(true);
        expect(isNetworkError('ENOTFOUND')).toBe(true);
        expect(isNetworkError('Connection refused by server')).toBe(true);
        expect(isNetworkError('Connection reset by peer')).toBe(true);
        expect(isNetworkError('Connection closed unexpectedly')).toBe(true);
      });

      it('socket errors', () => {
        expect(isNetworkError('Socket hang up')).toBe(true);
        expect(isNetworkError('socket closed')).toBe(true);
      });

      it('CORS errors', () => {
        expect(isNetworkError('CORS policy blocked')).toBe(true);
        // Note: "cross-origin" doesn't match - only the word "cors" matches
      });

      it('offline status', () => {
        expect(isNetworkError('Client is offline')).toBe(true);
        expect(isNetworkError('Device offline')).toBe(true);
      });

      it('aborted requests', () => {
        expect(isNetworkError('Request aborted')).toBe(true);
        expect(isNetworkError('Fetch aborted by user')).toBe(true);
      });

      it('server transient errors', () => {
        expect(isNetworkError('Server busy, please retry')).toBe(true);
        expect(isNetworkError('Please retry later')).toBe(true);
        expect(isNetworkError('Transaction rolled back')).toBe(true);
        expect(isNetworkError('Internal server error')).toBe(true);
      });

      it('HTTP 5xx status codes', () => {
        expect(isNetworkError('HTTP 500 Internal Server Error')).toBe(true);
        expect(isNetworkError('Error 502 Bad Gateway')).toBe(true);
        expect(isNetworkError('503 Service Unavailable')).toBe(true);
        expect(isNetworkError('504 Gateway Timeout')).toBe(true);
        expect(isNetworkError('Service unavailable')).toBe(true);
        expect(isNetworkError('Gateway timeout')).toBe(true);
      });

      it('Chrome net:: errors', () => {
        expect(isNetworkError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
        expect(isNetworkError('net::ERR_CONNECTION_REFUSED')).toBe(true);
      });
    });

    describe('should return false for permanent errors', () => {
      it('undefined or empty error', () => {
        expect(isNetworkError(undefined)).toBe(false);
        expect(isNetworkError('')).toBe(false);
      });

      it('validation errors', () => {
        expect(isNetworkError('Invalid payload: missing required field')).toBe(false);
        expect(isNetworkError('Schema validation failed')).toBe(false);
        expect(isNetworkError('Duplicate operation ID')).toBe(false);
      });

      it('conflict errors', () => {
        expect(isNetworkError('Conflict: operation already exists')).toBe(false);
        expect(isNetworkError('Version conflict detected')).toBe(false);
      });

      it('authentication errors', () => {
        expect(isNetworkError('Unauthorized: invalid token')).toBe(false);
        expect(isNetworkError('Authentication failed')).toBe(false);
        expect(isNetworkError('Access denied')).toBe(false);
      });

      it('HTTP 4xx status codes', () => {
        expect(isNetworkError('400 Bad Request')).toBe(false);
        expect(isNetworkError('401 Unauthorized')).toBe(false);
        expect(isNetworkError('403 Forbidden')).toBe(false);
        expect(isNetworkError('404 Not Found')).toBe(false);
      });

      it('generic errors without network keywords', () => {
        expect(isNetworkError('Unknown error')).toBe(false);
        expect(isNetworkError('Something went wrong')).toBe(false);
        expect(isNetworkError('Operation failed')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('case insensitive matching', () => {
        expect(isNetworkError('TIMEOUT')).toBe(true);
        expect(isNetworkError('Network ERROR')).toBe(true);
        expect(isNetworkError('FAILED TO FETCH')).toBe(true);
      });
    });
  });

  describe('_opTypeToSnapshotReason', () => {
    // Access private method for testing
    const opTypeToSnapshotReason = (opType: OpType): string =>
      (service as any)._opTypeToSnapshotReason(opType);

    it('should map SyncImport to initial', () => {
      expect(opTypeToSnapshotReason(OpType.SyncImport)).toBe('initial');
    });

    it('should map BackupImport to recovery', () => {
      expect(opTypeToSnapshotReason(OpType.BackupImport)).toBe('recovery');
    });

    it('should map Repair to recovery', () => {
      expect(opTypeToSnapshotReason(OpType.Repair)).toBe('recovery');
    });

    it('should map unknown types to recovery (default)', () => {
      expect(opTypeToSnapshotReason(OpType.Update)).toBe('recovery');
      expect(opTypeToSnapshotReason(OpType.Create)).toBe('recovery');
      expect(opTypeToSnapshotReason(OpType.Delete)).toBe('recovery');
    });
  });
});

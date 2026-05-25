import { TestBed } from '@angular/core/testing';
import {
  RejectedOpsHandlerService,
  DownloadCallback,
  DownloadResultForRejection,
  RejectedOpInfo,
} from './rejected-ops-handler.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { T } from '../../t.const';
import { MAX_CONCURRENT_RESOLUTION_ATTEMPTS } from '../core/operation-log.const';

describe('RejectedOpsHandlerService', () => {
  let service: RejectedOpsHandlerService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let supersededOperationResolverSpy: jasmine.SpyObj<SupersededOperationResolverService>;

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

  const mockEntry = (op: Operation): any => ({
    seq: 1,
    op,
    appliedAt: Date.now(),
    source: 'local' as const,
  });

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getOpById',
      'markRejected',
      'markSynced',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    supersededOperationResolverSpy = jasmine.createSpyObj(
      'SupersededOperationResolverService',
      ['resolveSupersededLocalOps'],
    );
    supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(0);

    TestBed.configureTestingModule({
      providers: [
        RejectedOpsHandlerService,
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        {
          provide: SupersededOperationResolverService,
          useValue: supersededOperationResolverSpy,
        },
      ],
    });

    service = TestBed.inject(RejectedOpsHandlerService);
  });

  describe('handleRejectedOps', () => {
    it('should return zero counts when no rejected ops provided', async () => {
      const result = await service.handleRejectedOps([]);
      expect(result).toEqual({ mergedOpsCreated: 0, permanentRejectionCount: 0 });
    });

    it('should skip already synced ops', async () => {
      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(
        Promise.resolve({ ...mockEntry(op), syncedAt: Date.now() }),
      );

      await service.handleRejectedOps([{ opId: 'op-1', error: 'test error' }]);

      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should skip already rejected ops', async () => {
      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(
        Promise.resolve({ ...mockEntry(op), rejectedAt: Date.now() }),
      );

      await service.handleRejectedOps([{ opId: 'op-1', error: 'test error' }]);

      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should skip ops that no longer exist', async () => {
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(undefined));

      await service.handleRejectedOps([{ opId: 'op-1', error: 'test error' }]);

      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should mark permanent rejections as rejected', async () => {
      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
      opLogStoreSpy.markRejected.and.resolveTo();

      await service.handleRejectedOps([
        { opId: 'op-1', error: 'validation error', errorCode: 'VALIDATION_ERROR' },
      ]);

      expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith(['op-1']);
    });

    it('should show snack warning when even 1 op is rejected', async () => {
      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
      opLogStoreSpy.markRejected.and.resolveTo();

      await service.handleRejectedOps([
        { opId: 'op-1', error: 'validation error', errorCode: 'VALIDATION_ERROR' },
      ]);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.UPLOAD_OPS_REJECTED,
          translateParams: { count: 1 },
        }),
      );
    });

    it('should show snack warning with correct count when multiple ops are rejected', async () => {
      const opCount = 10;
      const rejectedOps: Array<{ opId: string; error: string }> = [];
      for (let i = 0; i < opCount; i++) {
        const op = createOp({ id: `op-${i}` });
        opLogStoreSpy.getOpById
          .withArgs(`op-${i}`)
          .and.returnValue(Promise.resolve(mockEntry(op)));
        rejectedOps.push({ opId: `op-${i}`, error: 'error' });
      }
      opLogStoreSpy.markRejected.and.resolveTo();

      await service.handleRejectedOps(rejectedOps);

      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.UPLOAD_OPS_REJECTED,
        }),
      );
    });

    it('should NOT mark INTERNAL_ERROR rejections (transient - will retry)', async () => {
      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));

      await service.handleRejectedOps([
        { opId: 'op-1', error: 'server error', errorCode: 'INTERNAL_ERROR' },
      ]);

      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should mark DUPLICATE_OPERATION as synced (op already on server)', async () => {
      // REGRESSION TEST: Bug where duplicate operations would either:
      // 1. Be marked as rejected (wrong - they ARE on the server)
      // 2. Cause infinite retry loop when batch transaction failed
      //
      // Scenario:
      // 1. Client uploads op, server accepts but client times out before receiving response
      // 2. Client retries, server returns DUPLICATE_OPERATION
      // 3. Client should mark as synced (not rejected) - the op IS on the server
      const op = createOp({ id: 'dup-op-1' });
      const entry = { ...mockEntry(op), seq: 42 };
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(entry));
      opLogStoreSpy.markSynced.and.resolveTo();

      await service.handleRejectedOps([
        {
          opId: 'dup-op-1',
          error: 'Duplicate operation ID',
          errorCode: 'DUPLICATE_OPERATION',
        },
      ]);

      expect(opLogStoreSpy.getOpById).toHaveBeenCalledWith('dup-op-1');
      expect(opLogStoreSpy.markSynced).toHaveBeenCalledWith([42]);
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should handle multiple DUPLICATE_OPERATION rejections', async () => {
      opLogStoreSpy.getOpById.and.callFake(async (opId: string) => {
        const seqMap: Record<string, number> = {
          dupOp1: 10,
          dupOp2: 20,
          dupOp3: 30,
        };
        const op = createOp({ id: opId });
        return { ...mockEntry(op), seq: seqMap[opId] };
      });
      opLogStoreSpy.markSynced.and.resolveTo();

      await service.handleRejectedOps([
        { opId: 'dupOp1', error: 'Duplicate', errorCode: 'DUPLICATE_OPERATION' },
        { opId: 'dupOp2', error: 'Duplicate', errorCode: 'DUPLICATE_OPERATION' },
        { opId: 'dupOp3', error: 'Duplicate', errorCode: 'DUPLICATE_OPERATION' },
      ]);

      expect(opLogStoreSpy.markSynced).toHaveBeenCalledTimes(3);
      expect(opLogStoreSpy.markSynced).toHaveBeenCalledWith([10]);
      expect(opLogStoreSpy.markSynced).toHaveBeenCalledWith([20]);
      expect(opLogStoreSpy.markSynced).toHaveBeenCalledWith([30]);
    });

    it('should skip DUPLICATE_OPERATION if entry not found', async () => {
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(undefined));
      opLogStoreSpy.markSynced.and.resolveTo();

      await service.handleRejectedOps([
        { opId: 'missing-op', error: 'Duplicate', errorCode: 'DUPLICATE_OPERATION' },
      ]);

      expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    it('should skip DUPLICATE_OPERATION if already synced', async () => {
      const op = createOp({ id: 'already-synced-op' });
      const entry = { ...mockEntry(op), seq: 42, syncedAt: Date.now() };
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(entry));
      opLogStoreSpy.markSynced.and.resolveTo();

      await service.handleRejectedOps([
        {
          opId: 'already-synced-op',
          error: 'Duplicate',
          errorCode: 'DUPLICATE_OPERATION',
        },
      ]);

      expect(opLogStoreSpy.markSynced).not.toHaveBeenCalled();
    });

    it('should show alert for STORAGE_QUOTA_EXCEEDED and not mark as rejected', async () => {
      // Use existing spy or create new one (alert may be spied in other tests)
      const alertSpy = jasmine.isSpy(window.alert)
        ? (window.alert as jasmine.Spy)
        : spyOn(window, 'alert');
      alertSpy.calls.reset();

      const op = createOp({ id: 'op-1' });
      opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));

      await service.handleRejectedOps([
        { opId: 'op-1', error: 'quota exceeded', errorCode: 'STORAGE_QUOTA_EXCEEDED' },
      ]);

      expect(alertSpy).toHaveBeenCalled();
      expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
    });

    describe('CONFLICT_SUPERSEDED handling', () => {
      let downloadCallback: jasmine.Spy<DownloadCallback>;

      beforeEach(() => {
        downloadCallback = jasmine.createSpy('downloadCallback');
      });

      it('should resolve CONFLICT_SUPERSEDED via merge logic, NOT permanent rejection (regression test)', async () => {
        // REGRESSION TEST: Bug where CONFLICT_SUPERSEDED was treated as permanent rejection
        // instead of triggering supersededOperationResolver like CONFLICT_CONCURRENT.
        //
        // Scenario:
        // 1. Operation created with superseded clock (missing entries from SYNC_IMPORT)
        // 2. Server rejects as CONFLICT_SUPERSEDED
        // 3. Client should resolve via merge (like CONFLICT_CONCURRENT), NOT permanently reject
        //
        // Fix: Handle CONFLICT_SUPERSEDED the same as CONFLICT_CONCURRENT
        const op = createOp({ id: 'superseded-op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ serverClient: 10 }],
              snapshotVectorClock: { serverClient: 10 },
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [
            {
              opId: 'superseded-op-1',
              error: 'Superseded operation',
              errorCode: 'CONFLICT_SUPERSEDED',
            },
          ],
          downloadCallback,
        );

        // CRITICAL: CONFLICT_SUPERSEDED should trigger resolution, NOT permanent rejection
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      });

      it('should trigger download for CONFLICT_SUPERSEDED rejections', async () => {
        const op = createOp({ id: 'superseded-op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.returnValue(
          Promise.resolve({ newOpsCount: 1 } as DownloadResultForRejection),
        );

        await service.handleRejectedOps(
          [
            {
              opId: 'superseded-op-1',
              error: 'Superseded operation',
              errorCode: 'CONFLICT_SUPERSEDED',
            },
          ],
          downloadCallback,
        );

        expect(downloadCallback).toHaveBeenCalled();
      });

      it('should handle deprecated CONFLICT_STALE the same as CONFLICT_SUPERSEDED (backward compatibility)', async () => {
        // BACKWARD COMPAT: Older servers may return CONFLICT_STALE instead of CONFLICT_SUPERSEDED.
        // Both should trigger the same merge resolution path.
        const op = createOp({ id: 'stale-op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ serverClient: 10 }],
              snapshotVectorClock: { serverClient: 10 },
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [
            {
              opId: 'stale-op-1',
              error: 'Stale operation',
              errorCode: 'CONFLICT_STALE',
            },
          ],
          downloadCallback,
        );

        // CONFLICT_STALE should trigger resolution, NOT permanent rejection
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      });
    });

    describe('concurrent modification handling', () => {
      let downloadCallback: jasmine.Spy<DownloadCallback>;

      beforeEach(() => {
        downloadCallback = jasmine.createSpy('downloadCallback');
      });

      it('should trigger download for CONFLICT_CONCURRENT rejections', async () => {
        const op = createOp({ id: 'op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.returnValue(
          Promise.resolve({ newOpsCount: 1 } as DownloadResultForRejection),
        );

        await service.handleRejectedOps(
          [{ opId: 'op-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        expect(downloadCallback).toHaveBeenCalled();
      });

      it('should trigger force download when normal download returns no ops', async () => {
        const op = createOp({ id: 'op-1' });
        opLogStoreSpy.getOpById.and.callFake(async (opId: string) => {
          if (opId === 'op-1') return mockEntry(op);
          return undefined;
        });
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });

        await service.handleRejectedOps(
          [{ opId: 'op-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        // Should have called twice: normal then forced
        expect(downloadCallback).toHaveBeenCalledTimes(2);
        expect(downloadCallback).toHaveBeenCalledWith({ forceFromSeq0: true });
      });

      it('should use superseded operation resolver when force download returns clocks', async () => {
        const op = createOp({ id: 'op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        const remoteClock = { remoteClient: 2 };
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [remoteClock],
              snapshotVectorClock: { snapshot: 1 },
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        const result = await service.handleRejectedOps(
          [{ opId: 'op-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ opId: 'op-1' })]),
          [remoteClock],
          { snapshot: 1 },
        );
        expect(result).toEqual({ mergedOpsCreated: 1, permanentRejectionCount: 0 });
      });

      it('should pass existingClock from rejection to superseded resolver (FIX: encryption conflict loop)', async () => {
        // REGRESSION TEST: Bug where encrypted SuperSync gets stuck in infinite conflict loop.
        // Root cause: Client cannot create LWW update that dominates server state because
        // it doesn't receive the server's existing entity clock in rejection responses.
        //
        // Fix: Server returns existingClock in rejection, client passes it to superseded resolver.
        const op = createOp({ id: 'op-1' });
        const existingClock = { otherClient: 5 };
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [],
              snapshotVectorClock: { snapshot: 1 },
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [
            {
              opId: 'op-1',
              error: 'concurrent',
              errorCode: 'CONFLICT_CONCURRENT',
              existingClock,
            },
          ],
          downloadCallback,
        );

        // Should include existingClock in the extraClocks passed to resolver
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ opId: 'op-1' })]),
          [existingClock], // existingClock should be in extraClocks
          { snapshot: 1 },
        );
      });

      it('should merge existingClock with allOpClocks from force download', async () => {
        // Test that existingClock is merged with other clocks from force download
        const op = createOp({ id: 'op-1' });
        const existingClock = { conflictClient: 3 };
        const remoteClocks = [{ otherClient: 2 }];
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: remoteClocks,
              snapshotVectorClock: { snapshot: 1 },
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [
            {
              opId: 'op-1',
              error: 'concurrent',
              errorCode: 'CONFLICT_CONCURRENT',
              existingClock,
            },
          ],
          downloadCallback,
        );

        // Should merge existingClock with allOpClocks
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ opId: 'op-1' })]),
          [...remoteClocks, existingClock], // Both clocks should be passed
          { snapshot: 1 },
        );
      });

      it('should mark ops as rejected when force download returns no clocks', async () => {
        const op = createOp({ id: 'op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async () => {
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        opLogStoreSpy.markRejected.and.resolveTo();

        await service.handleRejectedOps(
          [{ opId: 'op-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith(['op-1']);
        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
            msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
          }),
        );
      });

      it('should mark ops as permanently rejected after exceeding MAX_CONCURRENT_RESOLUTION_ATTEMPTS (infinite loop prevention)', async () => {
        // REGRESSION TEST: When vector clock pruning makes it impossible to create
        // a dominating clock, the cycle "upload → reject → merge → upload → reject"
        // repeats forever. After MAX_CONCURRENT_RESOLUTION_ATTEMPTS, the ops should
        // be permanently rejected to break the loop.
        opLogStoreSpy.markRejected.and.resolveTo();

        // Simulate MAX_CONCURRENT_RESOLUTION_ATTEMPTS + 1 calls for the same entity
        for (let i = 0; i <= MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          const opId = `op-attempt-${i}`;
          const op = createOp({ id: opId, entityType: 'TASK', entityId: 'stuck-entity' });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
          downloadCallback.and.callFake(async (options) => {
            if (options?.forceFromSeq0) {
              return {
                newOpsCount: 0,
                allOpClocks: [{ remoteClient: 2 }],
              } as DownloadResultForRejection;
            }
            return { newOpsCount: 0 } as DownloadResultForRejection;
          });
          supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

          await service.handleRejectedOps(
            [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
            downloadCallback,
          );
        }

        // After exceeding the limit, the last op should have been marked as rejected
        // without triggering the download callback
        const lastCallOpId = `op-attempt-${MAX_CONCURRENT_RESOLUTION_ATTEMPTS}`;
        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith([lastCallOpId]);
        expect(snackServiceSpy.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
            msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
          }),
        );
      });

      it('should count multiple ops for the same entity in one batch as a single resolution attempt', async () => {
        // REGRESSION TEST: When 4 ops for TASK:abc arrive in one batch,
        // the counter should increment once (not 4 times), so the entity
        // gets MAX_CONCURRENT_RESOLUTION_ATTEMPTS full cycles before rejection.
        opLogStoreSpy.markRejected.and.resolveTo();
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        // Send a batch of 4 ops for the same entity in a single call
        const batchOps: RejectedOpInfo[] = [];
        for (let i = 0; i < 4; i++) {
          const opId = `batch-op-${i}`;
          const op = createOp({
            id: opId,
            entityType: 'TASK',
            entityId: 'same-entity',
          });
          opLogStoreSpy.getOpById
            .withArgs(opId)
            .and.returnValue(Promise.resolve(mockEntry(op)));
          batchOps.push({
            opId,
            error: 'concurrent',
            errorCode: 'CONFLICT_CONCURRENT' as const,
          });
        }

        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });

        // First batch: should resolve all 4 ops (1 attempt counted)
        await service.handleRejectedOps(batchOps, downloadCallback);

        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();

        // Verify all 4 batch ops were passed to the resolver (not silently dropped)
        const resolverArgs =
          supersededOperationResolverSpy.resolveSupersededLocalOps.calls.mostRecent()
            .args[0];
        expect(resolverArgs.length).toBe(4);
        expect(resolverArgs.map((o: { opId: string }) => o.opId)).toEqual([
          'batch-op-0',
          'batch-op-1',
          'batch-op-2',
          'batch-op-3',
        ]);

        // Send MAX_CONCURRENT_RESOLUTION_ATTEMPTS - 1 more single-op batches
        for (let i = 1; i < MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          supersededOperationResolverSpy.resolveSupersededLocalOps.calls.reset();
          const opId = `followup-op-${i}`;
          const op = createOp({
            id: opId,
            entityType: 'TASK',
            entityId: 'same-entity',
          });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));

          await service.handleRejectedOps(
            [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
            downloadCallback,
          );
        }

        // Should still not be rejected (exactly at MAX_CONCURRENT_RESOLUTION_ATTEMPTS)
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();

        // One more attempt should exceed the limit
        const finalOp = createOp({
          id: 'final-op',
          entityType: 'TASK',
          entityId: 'same-entity',
        });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(finalOp)));

        await service.handleRejectedOps(
          [{ opId: 'final-op', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith(['final-op']);
      });

      it('should count each entity independently within a mixed-entity batch', async () => {
        opLogStoreSpy.markRejected.and.resolveTo();
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        // Build a batch with 2 ops for entity-A and 2 ops for entity-B
        const batchOps: RejectedOpInfo[] = [];
        for (const entityId of ['entity-A', 'entity-B']) {
          for (let i = 0; i < 2; i++) {
            const opId = `op-${entityId}-${i}`;
            const op = createOp({ id: opId, entityType: 'TASK', entityId });
            opLogStoreSpy.getOpById
              .withArgs(opId)
              .and.returnValue(Promise.resolve(mockEntry(op)));
            batchOps.push({
              opId,
              error: 'concurrent',
              errorCode: 'CONFLICT_CONCURRENT',
            });
          }
        }

        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });

        // Send MAX_CONCURRENT_RESOLUTION_ATTEMPTS mixed batches
        for (let cycle = 0; cycle < MAX_CONCURRENT_RESOLUTION_ATTEMPTS; cycle++) {
          supersededOperationResolverSpy.resolveSupersededLocalOps.calls.reset();

          // Re-configure getOpById for each cycle (new op IDs)
          const cycleOps: RejectedOpInfo[] = [];
          for (const entityId of ['entity-A', 'entity-B']) {
            for (let i = 0; i < 2; i++) {
              const opId = `op-${entityId}-cycle${cycle}-${i}`;
              const op = createOp({ id: opId, entityType: 'TASK', entityId });
              opLogStoreSpy.getOpById
                .withArgs(opId)
                .and.returnValue(Promise.resolve(mockEntry(op)));
              cycleOps.push({
                opId,
                error: 'concurrent',
                errorCode: 'CONFLICT_CONCURRENT',
              });
            }
          }

          await service.handleRejectedOps(cycleOps, downloadCallback);
        }

        // Both entities at exactly MAX — should NOT be rejected yet
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();

        // One more cycle pushes both entities over the limit
        const finalOps: RejectedOpInfo[] = [];
        for (const entityId of ['entity-A', 'entity-B']) {
          const opId = `op-${entityId}-final`;
          const op = createOp({ id: opId, entityType: 'TASK', entityId });
          opLogStoreSpy.getOpById
            .withArgs(opId)
            .and.returnValue(Promise.resolve(mockEntry(op)));
          finalOps.push({
            opId,
            error: 'concurrent',
            errorCode: 'CONFLICT_CONCURRENT',
          });
        }

        await service.handleRejectedOps(finalOps, downloadCallback);

        // Both entities' ops should be permanently rejected
        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith([
          'op-entity-A-final',
          'op-entity-B-final',
        ]);
      });

      it('should track resolution attempts per entity independently (entity A limit does not affect entity B)', async () => {
        opLogStoreSpy.markRejected.and.resolveTo();

        // Exhaust MAX_CONCURRENT_RESOLUTION_ATTEMPTS + 1 for entity A
        for (let i = 0; i <= MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          const opId = `op-a-${i}`;
          const op = createOp({
            id: opId,
            entityType: 'TASK',
            entityId: 'entity-A',
          });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
          downloadCallback.and.callFake(async (options: any) => {
            if (options?.forceFromSeq0) {
              return {
                newOpsCount: 0,
                allOpClocks: [{ remoteClient: 2 }],
              } as DownloadResultForRejection;
            }
            return { newOpsCount: 0 } as DownloadResultForRejection;
          });
          supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

          await service.handleRejectedOps(
            [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
            downloadCallback,
          );
        }

        // Entity A should have been permanently rejected on the last call
        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith([
          `op-a-${MAX_CONCURRENT_RESOLUTION_ATTEMPTS}`,
        ]);

        // Reset spies to isolate entity B behavior
        supersededOperationResolverSpy.resolveSupersededLocalOps.calls.reset();
        opLogStoreSpy.markRejected.calls.reset();

        // Now entity B should still resolve normally (counter is independent)
        const opB = createOp({
          id: 'op-b-1',
          entityType: 'TASK',
          entityId: 'entity-B',
        });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(opB)));
        downloadCallback.and.callFake(async (options: any) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [{ opId: 'op-b-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        // Entity B should trigger resolution, NOT be rejected
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      });

      it('should accumulate resolution attempts across separate handleRejectedOps calls for the same entity', async () => {
        opLogStoreSpy.markRejected.and.resolveTo();

        // Call handleRejectedOps once per attempt (separate calls, not batched)
        for (let i = 0; i < MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          const opId = `op-${i}`;
          const op = createOp({
            id: opId,
            entityType: 'PROJECT',
            entityId: 'entity-accumulate',
          });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
          downloadCallback.and.callFake(async (options: any) => {
            if (options?.forceFromSeq0) {
              return {
                newOpsCount: 0,
                allOpClocks: [{ remoteClient: 2 }],
              } as DownloadResultForRejection;
            }
            return { newOpsCount: 0 } as DownloadResultForRejection;
          });
          supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

          await service.handleRejectedOps(
            [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
            downloadCallback,
          );
        }

        // Should NOT have been rejected yet (exactly at the limit, not over)
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();

        // One more call should exceed the limit
        const finalOp = createOp({
          id: 'op-final',
          entityType: 'PROJECT',
          entityId: 'entity-accumulate',
        });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(finalOp)));

        await service.handleRejectedOps(
          [{ opId: 'op-final', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        // Now it should be permanently rejected
        expect(opLogStoreSpy.markRejected).toHaveBeenCalledWith(['op-final']);
      });

      it('should only reset counters for ALL entities on a fully clean sync (empty rejections)', async () => {
        opLogStoreSpy.markRejected.and.resolveTo();

        // Build up attempts for two different entities
        for (let i = 0; i < MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          // Entity X
          const opX = createOp({
            id: `op-x-${i}`,
            entityType: 'TASK',
            entityId: 'entity-X',
          });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(opX)));
          downloadCallback.and.callFake(async (options: any) => {
            if (options?.forceFromSeq0) {
              return {
                newOpsCount: 0,
                allOpClocks: [{ remoteClient: 2 }],
              } as DownloadResultForRejection;
            }
            return { newOpsCount: 0 } as DownloadResultForRejection;
          });
          supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

          await service.handleRejectedOps(
            [
              {
                opId: `op-x-${i}`,
                error: 'concurrent',
                errorCode: 'CONFLICT_CONCURRENT',
              },
            ],
            downloadCallback,
          );
        }

        // Both entities are at the limit. Clean sync resets ALL counters.
        await service.handleRejectedOps([]);

        // After reset, entity X should resolve normally again
        supersededOperationResolverSpy.resolveSupersededLocalOps.calls.reset();
        const opAfter = createOp({
          id: 'op-after-reset',
          entityType: 'TASK',
          entityId: 'entity-X',
        });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(opAfter)));
        downloadCallback.and.callFake(async (options: any) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [
            {
              opId: 'op-after-reset',
              error: 'concurrent',
              errorCode: 'CONFLICT_CONCURRENT',
            },
          ],
          downloadCallback,
        );

        // Should have resolved, not rejected
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      });

      it('should reset resolution attempt counters when sync succeeds (no rejections)', async () => {
        opLogStoreSpy.markRejected.and.resolveTo();

        // Simulate MAX_CONCURRENT_RESOLUTION_ATTEMPTS calls for same entity
        for (let i = 0; i < MAX_CONCURRENT_RESOLUTION_ATTEMPTS; i++) {
          const opId = `op-${i}`;
          const op = createOp({ id: opId, entityType: 'TASK', entityId: 'entity-reset' });
          opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
          downloadCallback.and.callFake(async (options) => {
            if (options?.forceFromSeq0) {
              return {
                newOpsCount: 0,
                allOpClocks: [{ remoteClient: 2 }],
              } as DownloadResultForRejection;
            }
            return { newOpsCount: 0 } as DownloadResultForRejection;
          });
          supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

          await service.handleRejectedOps(
            [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
            downloadCallback,
          );
        }

        // Reset counters by calling with empty rejections (successful sync)
        await service.handleRejectedOps([]);

        // Now another attempt for the same entity should work (counter was reset)
        const opId = 'op-after-reset';
        const op = createOp({ id: opId, entityType: 'TASK', entityId: 'entity-reset' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.callFake(async (options) => {
          if (options?.forceFromSeq0) {
            return {
              newOpsCount: 0,
              allOpClocks: [{ remoteClient: 2 }],
            } as DownloadResultForRejection;
          }
          return { newOpsCount: 0 } as DownloadResultForRejection;
        });
        supersededOperationResolverSpy.resolveSupersededLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [{ opId, error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        // Should have called the resolver (not rejected due to exceeded limit)
        expect(
          supersededOperationResolverSpy.resolveSupersededLocalOps,
        ).toHaveBeenCalled();
      });
    });
  });
});

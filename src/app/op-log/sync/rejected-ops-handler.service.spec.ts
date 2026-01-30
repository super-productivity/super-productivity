import { TestBed } from '@angular/core/testing';
import {
  RejectedOpsHandlerService,
  DownloadCallback,
  DownloadResultForRejection,
} from './rejected-ops-handler.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { StaleOperationResolverService } from './stale-operation-resolver.service';
import { Operation, OpType, ActionType } from '../core/operation.types';
import { T } from '../../t.const';

describe('RejectedOpsHandlerService', () => {
  let service: RejectedOpsHandlerService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let staleOperationResolverSpy: jasmine.SpyObj<StaleOperationResolverService>;

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
    staleOperationResolverSpy = jasmine.createSpyObj('StaleOperationResolverService', [
      'resolveStaleLocalOps',
    ]);
    staleOperationResolverSpy.resolveStaleLocalOps.and.resolveTo(0);

    TestBed.configureTestingModule({
      providers: [
        RejectedOpsHandlerService,
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: StaleOperationResolverService, useValue: staleOperationResolverSpy },
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

    describe('CONFLICT_STALE handling', () => {
      let downloadCallback: jasmine.Spy<DownloadCallback>;

      beforeEach(() => {
        downloadCallback = jasmine.createSpy('downloadCallback');
      });

      it('should resolve CONFLICT_STALE via merge logic, NOT permanent rejection (regression test)', async () => {
        // REGRESSION TEST: Bug where CONFLICT_STALE was treated as permanent rejection
        // instead of triggering staleOperationResolver like CONFLICT_CONCURRENT.
        //
        // Scenario:
        // 1. Operation created with stale clock (missing entries from SYNC_IMPORT)
        // 2. Server rejects as CONFLICT_STALE
        // 3. Client should resolve via merge (like CONFLICT_CONCURRENT), NOT permanently reject
        //
        // Fix: Handle CONFLICT_STALE the same as CONFLICT_CONCURRENT
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
        staleOperationResolverSpy.resolveStaleLocalOps.and.resolveTo(1);

        await service.handleRejectedOps(
          [{ opId: 'stale-op-1', error: 'Stale operation', errorCode: 'CONFLICT_STALE' }],
          downloadCallback,
        );

        // CRITICAL: CONFLICT_STALE should trigger resolution, NOT permanent rejection
        expect(staleOperationResolverSpy.resolveStaleLocalOps).toHaveBeenCalled();
        expect(opLogStoreSpy.markRejected).not.toHaveBeenCalled();
      });

      it('should trigger download for CONFLICT_STALE rejections', async () => {
        const op = createOp({ id: 'stale-op-1' });
        opLogStoreSpy.getOpById.and.returnValue(Promise.resolve(mockEntry(op)));
        downloadCallback.and.returnValue(
          Promise.resolve({ newOpsCount: 1 } as DownloadResultForRejection),
        );

        await service.handleRejectedOps(
          [{ opId: 'stale-op-1', error: 'Stale operation', errorCode: 'CONFLICT_STALE' }],
          downloadCallback,
        );

        expect(downloadCallback).toHaveBeenCalled();
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

      it('should use stale operation resolver when force download returns clocks', async () => {
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
        staleOperationResolverSpy.resolveStaleLocalOps.and.resolveTo(1);

        const result = await service.handleRejectedOps(
          [{ opId: 'op-1', error: 'concurrent', errorCode: 'CONFLICT_CONCURRENT' }],
          downloadCallback,
        );

        expect(staleOperationResolverSpy.resolveStaleLocalOps).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ opId: 'op-1' })]),
          [remoteClock],
          { snapshot: 1 },
        );
        expect(result).toEqual({ mergedOpsCreated: 1, permanentRejectionCount: 0 });
      });

      it('should pass existingClock from rejection to stale resolver (FIX: encryption conflict loop)', async () => {
        // REGRESSION TEST: Bug where encrypted SuperSync gets stuck in infinite conflict loop.
        // Root cause: Client cannot create LWW update that dominates server state because
        // it doesn't receive the server's existing entity clock in rejection responses.
        //
        // Fix: Server returns existingClock in rejection, client passes it to stale resolver.
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
        staleOperationResolverSpy.resolveStaleLocalOps.and.resolveTo(1);

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
        expect(staleOperationResolverSpy.resolveStaleLocalOps).toHaveBeenCalledWith(
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
        staleOperationResolverSpy.resolveStaleLocalOps.and.resolveTo(1);

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
        expect(staleOperationResolverSpy.resolveStaleLocalOps).toHaveBeenCalledWith(
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
    });
  });
});

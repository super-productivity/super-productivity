/**
 * Tests for the duplicate operation pre-check fix.
 *
 * REGRESSION TEST: This tests the fix for a bug where duplicate operations
 * would abort PostgreSQL transactions, causing all subsequent operations
 * in a batch to fail with error 25P02 ("transaction is aborted").
 *
 * The fix checks for existing operations BEFORE attempting to insert,
 * avoiding the P2002 unique constraint error that would abort the transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../src/sync/sync.service';
import { DEFAULT_SYNC_CONFIG, SYNC_ERROR_CODES } from '../src/sync/sync.types';
import { prisma } from '../src/db';

const TEST_TIMESTAMP = Date.now() - 1000;

// Test data for creating mock operations
const createTestOp = (overrides: Record<string, any> = {}) => ({
  id: 'test-op-id',
  clientId: 'client-1', // Must match the clientId passed to uploadOps
  actionType: '[Test] Action',
  opType: 'UPD',
  entityType: 'TASK',
  entityId: 'entity-1',
  payload: { foo: 'bar' },
  vectorClock: { 'client-1': 1 },
  timestamp: TEST_TIMESTAMP,
  schemaVersion: 1,
  ...overrides,
});

describe('Duplicate Operation Pre-check', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService();
  });

  describe('uploadOps with duplicate operation', () => {
    it('should return DUPLICATE_OPERATION error without aborting batch', async () => {
      const existingOp = createTestOp({
        id: 'dup-op-1',
        entityId: 'task-1',
        vectorClock: { 'client-1': 1 },
      });
      await syncService.uploadOps(1, 'client-1', [existingOp]);

      const ops = [
        createTestOp({
          id: 'dup-op-1',
          entityId: 'task-1',
          vectorClock: { 'client-1': 1 },
        }),
        createTestOp({
          id: 'new-op-2',
          entityId: 'task-2',
          vectorClock: { 'client-1': 2 },
        }),
        createTestOp({
          id: 'new-op-3',
          entityId: 'task-3',
          vectorClock: { 'client-1': 3 },
        }),
      ];

      const results = await syncService.uploadOps(1, 'client-1', ops);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
      expect(results[0].serverSeq).toBeUndefined();
      expect(results[1]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
      expect(results[2]).toMatchObject({
        accepted: true,
        serverSeq: 3,
      });
    });

    it('should detect duplicate operation via pre-check and return proper error code', async () => {
      // First, upload an operation
      const originalOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(firstResult[0].accepted).toBe(true);

      // Now try to upload the same operation again
      const duplicateOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const duplicateResult = await syncService.uploadOps(1, 'client-1', [duplicateOp]);

      // Should get DUPLICATE_OPERATION error
      expect(duplicateResult[0].accepted).toBe(false);
      expect(duplicateResult[0].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(duplicateResult[0].error).toContain('Duplicate');
    });

    it('should preserve duplicate retries when JSON field order differs', async () => {
      const originalOp = createTestOp({
        id: 'json-order-op',
        payload: {
          top: 'value',
          nested: { a: 1, b: 2 },
        },
        vectorClock: { 'client-1': 1, 'client-2': 2 },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const duplicateOp = createTestOp({
        id: 'json-order-op',
        payload: {
          nested: { b: 2, a: 1 },
          top: 'value',
        },
        vectorClock: { 'client-2': 2, 'client-1': 1 },
      });
      const duplicateResult = await syncService.uploadOps(1, 'client-1', [duplicateOp]);

      expect(duplicateResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
    });

    it('should reject same-id operations with different payload content', async () => {
      const originalOp = createTestOp({
        id: 'payload-collision-op',
        payload: { title: 'original' },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'payload-collision-op',
          payload: { title: 'changed' },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
    });

    it('should reject same-id operations with different vector clocks', async () => {
      const originalOp = createTestOp({
        id: 'vector-clock-collision-op',
        vectorClock: { 'client-1': 1 },
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'vector-clock-collision-op',
          vectorClock: { 'client-1': 2 },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
    });

    it('should reject same-id operations with different persisted metadata', async () => {
      const baseTimestamp = Date.now() - 1000;
      const originalOp = createTestOp({
        id: 'metadata-collision-op',
        timestamp: baseTimestamp,
        schemaVersion: 1,
        isPayloadEncrypted: true,
        syncImportReason: 'initial',
      });
      await syncService.uploadOps(1, 'client-1', [originalOp]);

      const collisionCases = [
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp + 1,
          schemaVersion: 1,
          isPayloadEncrypted: true,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 2,
          isPayloadEncrypted: true,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 1,
          isPayloadEncrypted: false,
          syncImportReason: 'initial',
        }),
        createTestOp({
          id: 'metadata-collision-op',
          timestamp: baseTimestamp,
          schemaVersion: 1,
          isPayloadEncrypted: true,
          syncImportReason: 'retry',
        }),
      ];

      for (const collisionOp of collisionCases) {
        const collisionResult = await syncService.uploadOps(1, 'client-1', [collisionOp]);

        expect(collisionResult[0]).toMatchObject({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        });
        expect(collisionResult[0].errorCode).not.toBe(
          SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        );
      }
    });

    it('should preserve duplicate retries when future timestamps are clamped', async () => {
      const baseTimestamp = 1_700_000_000_000;
      const farFuture = baseTimestamp + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10_000;

      vi.useFakeTimers();
      vi.setSystemTime(baseTimestamp);
      try {
        const originalOp = createTestOp({
          id: 'clamped-duplicate-op',
          timestamp: farFuture,
        });
        const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
        expect(firstResult[0]).toMatchObject({ accepted: true });

        vi.setSystemTime(baseTimestamp + 5_000);
        const duplicateResult = await syncService.uploadOps(1, 'client-1', [
          createTestOp({
            id: 'clamped-duplicate-op',
            timestamp: farFuture,
          }),
        ]);

        expect(duplicateResult[0]).toMatchObject({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should preserve clamped duplicate retries when the retry timestamp is no longer clamped', async () => {
      const baseTimestamp = 1_700_000_000_000;
      const retryTimestamp = baseTimestamp + 10_000;
      const farFuture = baseTimestamp + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10_000;

      vi.useFakeTimers();
      vi.setSystemTime(baseTimestamp);
      try {
        const originalOp = createTestOp({
          id: 'clamp-boundary-duplicate-op',
          timestamp: farFuture,
        });
        const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
        expect(firstResult[0]).toMatchObject({ accepted: true });

        vi.setSystemTime(retryTimestamp);
        const duplicateResult = await syncService.uploadOps(1, 'client-1', [
          createTestOp({
            id: 'clamp-boundary-duplicate-op',
            timestamp: farFuture,
          }),
        ]);

        expect(duplicateResult[0]).toMatchObject({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not advance server sequence for duplicate retries', async () => {
      const originalOp = createTestOp({
        id: 'seq-original',
        entityId: 'task-seq-original',
        vectorClock: { 'client-1': 1 },
      });

      const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(firstResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });

      const duplicateResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(duplicateResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
      expect(duplicateResult[0].serverSeq).toBeUndefined();

      const nextResult = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'seq-next',
          entityId: 'task-seq-next',
          vectorClock: { 'client-1': 2 },
        }),
      ]);

      expect(nextResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
    });

    it('should not abort transaction when duplicate is in the middle of batch', async () => {
      // Upload first op to make it a "duplicate" for later
      const existingOp = createTestOp({ id: 'existing-op', entityId: 'task-existing' });
      await syncService.uploadOps(1, 'client-1', [existingOp]);

      // Now upload batch where middle op is a duplicate
      const batchOps = [
        createTestOp({
          id: 'new-op-1',
          entityId: 'task-1',
          vectorClock: { 'client-1': 2 },
        }),
        createTestOp({
          id: 'existing-op',
          entityId: 'task-existing',
          vectorClock: { 'client-1': 1 },
        }), // Duplicate!
        createTestOp({
          id: 'new-op-3',
          entityId: 'task-3',
          vectorClock: { 'client-1': 3 },
        }),
      ];

      const results = await syncService.uploadOps(1, 'client-1', batchOps);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        accepted: true,
        serverSeq: 2,
      });
      expect(results[1]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
      expect(results[1].serverSeq).toBeUndefined();
      expect(results[2]).toMatchObject({
        accepted: true,
        serverSeq: 3,
      });
    });

    it('should prefer duplicate rejection over conflicts for older duplicate retries', async () => {
      const olderOp = createTestOp({
        id: 'older-op',
        entityId: 'task-same',
        vectorClock: { 'client-1': 1 },
      });
      const newerOp = createTestOp({
        id: 'newer-op',
        entityId: 'task-same',
        vectorClock: { 'client-1': 2 },
      });

      await syncService.uploadOps(1, 'client-1', [olderOp, newerOp]);

      const results = await syncService.uploadOps(1, 'client-1', [olderOp]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
      expect(results[0].serverSeq).toBeUndefined();
    });

    it('should not treat another user operation with the same ID as duplicate success', async () => {
      await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'cross-user-collision',
          clientId: 'client-1',
          entityId: 'task-user-1',
          vectorClock: { 'client-1': 1 },
        }),
      ]);

      const collisionResult = await syncService.uploadOps(2, 'client-2', [
        createTestOp({
          id: 'cross-user-collision',
          clientId: 'client-2',
          entityId: 'task-user-2',
          vectorClock: { 'client-2': 1 },
        }),
      ]);

      expect(collisionResult[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(collisionResult[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(collisionResult[0].serverSeq).toBeUndefined();

      const nextResult = await syncService.uploadOps(2, 'client-2', [
        createTestOp({
          id: 'user-2-next',
          clientId: 'client-2',
          entityId: 'task-user-2-next',
          vectorClock: { 'client-2': 2 },
        }),
      ]);

      expect(nextResult[0]).toMatchObject({
        accepted: true,
        serverSeq: 1,
      });
    });

    it('should handle duplicate insert races without aborting the transaction', async () => {
      const raceTimestamp = Date.now() - 1000;
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'race-op',
              userId: 1,
              clientId: 'client-1',
              actionType: '[Test] Action',
              opType: 'UPD',
              entityType: 'TASK',
              entityId: 'task-race',
              payload: { foo: 'bar' },
              vectorClock: { 'client-1': 1 },
              schemaVersion: 1,
              clientTimestamp: BigInt(raceTimestamp),
              receivedAt: BigInt(raceTimestamp),
              isPayloadEncrypted: false,
              syncImportReason: null,
            }),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi
            .fn()
            .mockResolvedValueOnce({ userId: 1, lastSeq: 1 })
            .mockResolvedValueOnce({ userId: 1, lastSeq: 0 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'race-op',
          entityId: 'task-race',
          timestamp: raceTimestamp,
        }),
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      });
      expect(results[0].serverSeq).toBeUndefined();
      expect(tx.operation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(1, {
        where: { userId: 1 },
        data: { lastSeq: { increment: 1 } },
      });
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(2, {
        where: { userId: 1 },
        data: { lastSeq: { decrement: 1 } },
      });
      expect(tx.syncDevice.upsert).toHaveBeenCalled();
    });

    it('should reject insert-race ID collisions instead of marking them synced', async () => {
      const raceTimestamp = Date.now() - 1000;
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              id: 'collision-race-op',
              userId: 2,
              clientId: 'client-2',
              actionType: '[Test] Action',
              opType: 'UPD',
              entityType: 'TASK',
              entityId: 'task-other-user',
              payload: { foo: 'bar' },
              vectorClock: { 'client-1': 1 },
              schemaVersion: 1,
              clientTimestamp: BigInt(raceTimestamp),
              receivedAt: BigInt(raceTimestamp),
              isPayloadEncrypted: false,
              syncImportReason: null,
            }),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi
            .fn()
            .mockResolvedValueOnce({ userId: 1, lastSeq: 1 })
            .mockResolvedValueOnce({ userId: 1, lastSeq: 0 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'collision-race-op',
          entityId: 'task-race',
          timestamp: raceTimestamp,
        }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      });
      expect(results[0].errorCode).not.toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(2, {
        where: { userId: 1 },
        data: { lastSeq: { decrement: 1 } },
      });
      expect(tx.syncDevice.upsert).toHaveBeenCalled();
    });

    it('should not report non-id insert skips as duplicate operations', async () => {
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 1 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({ id: 'seq-conflict-op', entityId: 'task-seq-conflict' }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      });
      // Generic, non-leaky message. The original Prisma exception text (which
      // can include SQL fragments, column / FK names) is only emitted to the
      // server log; the per-op error returned to the client must not leak it.
      expect(results[0].error).toBe('Transaction failed - please retry');
      expect(tx.userSyncState.update).toHaveBeenCalledTimes(1);
      expect(tx.syncDevice.upsert).not.toHaveBeenCalled();
    });

    it('should classify PostgreSQL repeatable-read serialization failures as retryable', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error('could not serialize access due to concurrent update'),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({ id: 'serialization-op', entityId: 'task-serialization' }),
      ]);

      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      });
      expect(results[0].error).toContain('Concurrent transaction conflict');
    });

    it('should roll back sequence allocation when final conflict check rejects', async () => {
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              clientId: 'client-2',
              vectorClock: { 'client-2': 1 },
            }),
          createMany: vi.fn(),
        },
        userSyncState: {
          upsert: vi.fn().mockResolvedValue({ userId: 1, lastSeq: 0 }),
          update: vi
            .fn()
            .mockResolvedValueOnce({ userId: 1, lastSeq: 1 })
            .mockResolvedValueOnce({ userId: 1, lastSeq: 0 }),
        },
        syncDevice: {
          upsert: vi.fn().mockResolvedValue({}),
          deleteMany: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) =>
        callback(tx),
      );

      const results = await syncService.uploadOps(1, 'client-1', [
        createTestOp({
          id: 'final-conflict-op',
          entityId: 'task-final-conflict',
          vectorClock: { 'client-1': 1 },
        }),
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
        existingClock: { 'client-2': 1 },
      });
      expect(results[0].serverSeq).toBeUndefined();
      expect(tx.operation.createMany).not.toHaveBeenCalled();
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(1, {
        where: { userId: 1 },
        data: { lastSeq: { increment: 1 } },
      });
      expect(tx.userSyncState.update).toHaveBeenNthCalledWith(2, {
        where: { userId: 1 },
        data: { lastSeq: { decrement: 1 } },
      });
      expect(tx.syncDevice.upsert).toHaveBeenCalled();
    });
  });

  describe('error codes', () => {
    it('should use DUPLICATE_OPERATION error code, not INTERNAL_ERROR', async () => {
      // The key regression: Before the fix, duplicates caused INTERNAL_ERROR
      // because the P2002 exception aborted the transaction and subsequent
      // queries failed with 25P02, which was caught as INTERNAL_ERROR.

      const op = createTestOp({ id: 'test-dup-error-code' });

      // Upload once
      await syncService.uploadOps(1, 'client-1', [op]);

      // Upload again (duplicate)
      const result = await syncService.uploadOps(1, 'client-1', [op]);

      // Must be DUPLICATE_OPERATION, NOT INTERNAL_ERROR
      expect(result[0].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(result[0].errorCode).not.toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
    });
  });
});

/**
 * Regression tests for issue #8332.
 *
 * When the upload transaction fails transiently (serialization conflict,
 * timeout, deadlock) `uploadOps` does NOT throw — it RETURNS a batch where
 * every op carries `errorCode: INTERNAL_ERROR` ("...please retry"). The route
 * handlers used to cache that result under the request's deterministic
 * `requestId`, so every retry of the same batch was served the cached failure
 * for the full dedup TTL (5 min) — a one-off DB hiccup became a multi-minute
 * upload stall, and the retry-safety mechanism defeated retries.
 *
 * These tests pin the fix at the route layer: a rolled-back (INTERNAL_ERROR)
 * result must NOT be cached, while successful and *deterministic* per-op
 * rejections (e.g. CONFLICT) still are.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => {
  const syncService = {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    cacheOpsRequestResults: vi.fn(),
    checkSnapshotRequestDedup: vi.fn(),
    cacheSnapshotRequestResult: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    cacheSnapshotIfReplayable: vi.fn(),
    prepareSnapshotCache: vi.fn(),
    updateStorageUsage: vi.fn(),
    incrementStorageUsage: vi.fn(),
    decrementStorageUsage: vi.fn(),
    runWithStorageUsageLock: vi.fn(),
    freeStorageForUpload: vi.fn(),
    getLatestSeq: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
    getStorageInfo: vi.fn(),
    getCachedSnapshotBytes: vi.fn(),
    getMaxClockDriftMs: vi.fn(),
  };
  const prisma = {
    operation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { syncService, prisma, notifyNewOps: vi.fn() };
});

vi.mock('../src/auth', () => ({
  verifyToken: vi
    .fn()
    .mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
}));

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => mocks.syncService,
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyNewOps: mocks.notifyNewOps }),
}));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import { syncRoutes } from '../src/sync/sync.routes';
import { SYNC_ERROR_CODES, UploadResult } from '../src/sync/sync.types';
import { RequestDeduplicationService } from '../src/sync/services/request-deduplication.service';

const authToken = 'mock-token';
const userId = 1;
const clientId = 'retrying-client';
const QUOTA = 100 * 1024 * 1024;

const createOp = (): unknown => ({
  id: 'op-1',
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Test Task' },
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
});

// The exact shape uploadOps returns when its transaction rolls back
// (sync.service.ts maps the whole batch to this).
const ROLLBACK_RESULT: UploadResult = {
  opId: 'op-1',
  accepted: false,
  error: 'Concurrent transaction conflict - please retry',
  errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
};

describe('Request dedup — transaction-failure results are not cached (#8332)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: QUOTA,
    });
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({ ops: [], latestSeq: 1 });
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 0,
      storageQuotaBytes: QUOTA,
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.syncService.getMaxClockDriftMs.mockReturnValue(60_000);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValue({ deltaBytes: 0 });
    mocks.syncService.prepareSnapshotCache.mockResolvedValue({
      stateBytes: 0,
      bytes: 0,
      cacheable: true,
    });
    mocks.prisma.operation.findFirst.mockResolvedValue(null);
    mocks.prisma.operation.findMany.mockResolvedValue([]);

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  const uploadOps = (requestId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { ops: [createOp()], clientId, requestId },
    });

  const uploadSnapshot = (requestId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: {} },
        clientId,
        reason: 'recovery',
        vectorClock: { [clientId]: 1 },
        opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
        requestId,
      },
    });

  describe('POST /api/sync/ops', () => {
    it('does NOT cache results when the whole batch rolled back', async () => {
      mocks.syncService.uploadOps.mockResolvedValue([ROLLBACK_RESULT]);

      const res = await uploadOps('ops-v1-rollback');

      expect(res.statusCode).toBe(200);
      expect(res.json().results[0].errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
      // The core of the fix: the transient failure must not poison the cache.
      expect(mocks.syncService.cacheOpsRequestResults).not.toHaveBeenCalled();
    });

    it('still re-processes the same requestId on the next attempt (no cached failure)', async () => {
      // First attempt rolls back, second succeeds — the deterministic requestId
      // must not short-circuit the second attempt to the cached failure.
      mocks.syncService.uploadOps
        .mockResolvedValueOnce([ROLLBACK_RESULT])
        .mockResolvedValueOnce([{ opId: 'op-1', accepted: true, serverSeq: 1 }]);

      const first = await uploadOps('ops-v1-retry');
      expect(first.json().results[0].accepted).toBe(false);

      const second = await uploadOps('ops-v1-retry');
      expect(second.json().results[0].accepted).toBe(true);
      // checkOpsRequestDedup always returns null in this mock (nothing cached),
      // so the handler must have called uploadOps a second time.
      expect(mocks.syncService.uploadOps).toHaveBeenCalledTimes(2);
      expect(mocks.syncService.cacheOpsRequestResults).toHaveBeenCalledTimes(1);
    });

    it('DOES cache successful results (control)', async () => {
      const results = [{ opId: 'op-1', accepted: true, serverSeq: 1 }];
      mocks.syncService.uploadOps.mockResolvedValue(results);

      await uploadOps('ops-v1-success');

      expect(mocks.syncService.cacheOpsRequestResults).toHaveBeenCalledWith(
        userId,
        'ops-v1-success',
        results,
      );
    });

    it('DOES cache deterministic per-op rejections that are not rollbacks (control)', async () => {
      // A CONFLICT is a deterministic verdict — re-running the batch yields the
      // same answer, so caching it is correct and avoids redundant work.
      const results = [
        {
          opId: 'op-1',
          accepted: false,
          error: 'Concurrent modification',
          errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
        },
      ];
      mocks.syncService.uploadOps.mockResolvedValue(results);

      await uploadOps('ops-v1-conflict');

      expect(mocks.syncService.cacheOpsRequestResults).toHaveBeenCalledWith(
        userId,
        'ops-v1-conflict',
        results,
      );
    });
  });

  describe('POST /api/sync/snapshot', () => {
    it('does NOT cache the response when the upload rolled back', async () => {
      mocks.syncService.uploadOps.mockResolvedValue([ROLLBACK_RESULT]);

      const res = await uploadSnapshot('snapshot-v1-rollback');

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(false);
      expect(mocks.syncService.cacheSnapshotRequestResult).not.toHaveBeenCalled();
    });

    it('DOES cache an accepted snapshot (control)', async () => {
      mocks.syncService.uploadOps.mockResolvedValue([
        { opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc', accepted: true, serverSeq: 5 },
      ]);

      const res = await uploadSnapshot('snapshot-v1-success');

      expect(res.json().accepted).toBe(true);
      expect(mocks.syncService.cacheSnapshotRequestResult).toHaveBeenCalledWith(
        userId,
        'snapshot-v1-success',
        { accepted: true, serverSeq: 5, error: undefined },
      );
    });
  });
});

/**
 * Stronger end-to-end variant: instead of asserting on spies, back the dedup
 * wrappers with a REAL RequestDeduplicationService so the handler's caching
 * decision is observed through an actual store + lookup round-trip. This proves
 * the *behaviour* clients depend on: a rolled-back batch leaves the cache empty
 * (so the retry re-processes), while a success is cached (so dedup still works).
 */
describe('Request dedup round-trip with the real cache (#8332)', () => {
  let app: FastifyInstance;
  let dedup: RequestDeduplicationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    dedup = new RequestDeduplicationService();
    mocks.syncService.checkOpsRequestDedup.mockImplementation((u: number, r: string) =>
      dedup.checkDeduplication(u, 'ops', r),
    );
    mocks.syncService.cacheOpsRequestResults.mockImplementation(
      (u: number, r: string, res: UploadResult[]) => dedup.cacheResults(u, 'ops', r, res),
    );
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: QUOTA,
    });
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({ ops: [], latestSeq: 1 });
    mocks.syncService.getMaxClockDriftMs.mockReturnValue(60_000);
    mocks.prisma.operation.findMany.mockResolvedValue([]);

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  const post = (requestId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { ops: [createOp()], clientId, requestId },
    });

  it('leaves the cache empty after a rollback, so the next retry re-processes', async () => {
    const REQ = 'ops-v1-roundtrip';
    mocks.syncService.uploadOps
      .mockResolvedValueOnce([ROLLBACK_RESULT])
      .mockResolvedValueOnce([{ opId: 'op-1', accepted: true, serverSeq: 1 }]);

    const first = await post(REQ);
    expect(first.json().results[0].errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
    // The real cache must NOT have stored the transient failure.
    expect(dedup.checkDeduplication(userId, 'ops', REQ)).toBeNull();
    expect(dedup.getCacheCount()).toBe(0);

    const second = await post(REQ);
    // The retry was genuinely re-processed, not short-circuited to the failure.
    expect(mocks.syncService.uploadOps).toHaveBeenCalledTimes(2);
    expect(second.json().results[0].accepted).toBe(true);
    // ...and the successful retry IS now cached for further idempotent retries.
    expect(dedup.checkDeduplication(userId, 'ops', REQ)).toEqual([
      { opId: 'op-1', accepted: true, serverSeq: 1 },
    ]);
  });

  it('still serves a cached success on retry (control: dedup is not over-disabled)', async () => {
    const REQ = 'ops-v1-success-roundtrip';
    mocks.syncService.uploadOps.mockResolvedValue([
      { opId: 'op-1', accepted: true, serverSeq: 1 },
    ]);

    await post(REQ);
    const again = await post(REQ);

    // The second call short-circuited via the real cache — uploadOps ran once.
    expect(mocks.syncService.uploadOps).toHaveBeenCalledTimes(1);
    expect(again.json().deduplicated).toBe(true);
  });
});

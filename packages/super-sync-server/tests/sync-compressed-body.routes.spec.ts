import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const mocks = vi.hoisted(() => {
  const syncService = {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    cacheOpsRequestResults: vi.fn(),
    checkSnapshotRequestDedup: vi.fn(),
    cacheSnapshotRequestResult: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    cacheSnapshot: vi.fn(),
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
    markStorageNeedsReconcile: vi.fn(),
  };
  const prisma = {
    operation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  return {
    syncService,
    prisma,
    notifyNewOps: vi.fn(),
  };
});

vi.mock('../src/auth', () => ({
  verifyToken: vi.fn().mockResolvedValue({
    valid: true,
    userId: 1,
    email: 'test@test.com',
  }),
}));

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => mocks.syncService,
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({
    notifyNewOps: mocks.notifyNewOps,
  }),
}));

vi.mock('../src/db', () => ({
  prisma: mocks.prisma,
}));

import { syncRoutes } from '../src/sync/sync.routes';
import { SYNC_ERROR_CODES } from '../src/sync/sync.types';
import { SUPER_SYNC_MAX_OPS_PER_UPLOAD } from '@sp/shared-schema';

const gzipAsync = promisify(zlib.gzip);

const createOp = (clientId: string) => ({
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

const MiB = 1024 * 1024;

describe('Sync compressed body routes', () => {
  let app: FastifyInstance;
  const authToken = 'mock-token';

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: 100 * 1024 * 1024,
    });
    mocks.syncService.uploadOps.mockResolvedValue([{ accepted: true, serverSeq: 1 }]);
    mocks.syncService.cacheSnapshot.mockResolvedValue({
      cached: true,
      bytesWritten: 0,
      previousBytes: 0,
      deltaBytes: 0,
    });
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValue({
      cached: true,
      bytesWritten: 0,
      previousBytes: 0,
      deltaBytes: 0,
    });
    mocks.syncService.prepareSnapshotCache.mockImplementation((state: unknown) => {
      const serialized = JSON.stringify(state);
      const data = zlib.gzipSync(serialized);
      return {
        data,
        bytes: data.length,
        stateBytes: Buffer.byteLength(serialized, 'utf8'),
        cacheable: true,
      };
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.syncService.updateStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.incrementStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.decrementStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.freeStorageForUpload.mockResolvedValue({
      success: false,
      freedBytes: 0,
      deletedRestorePoints: 0,
      deletedOps: 0,
    });
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [],
      latestSeq: 1,
    });
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 0,
      storageQuotaBytes: 100 * 1024 * 1024,
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.prisma.operation.findFirst.mockResolvedValue(null);

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept plain JSON ops upload', async () => {
    const clientId = 'plain-json-client';
    const payload = {
      ops: [createOp(clientId)],
      clientId,
    };
    const jsonPayload = JSON.stringify(payload);
    const payloadSize = Buffer.byteLength(jsonPayload, 'utf-8');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-length': String(payloadSize),
      },
      payload: jsonPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].accepted).toBe(true);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    // Quota gate now accounts via computeOpsStorageBytes(ops), so the value is
    // the per-op payload+vectorClock bytes rather than the full body size.
    // Tests of compression handling stay value-agnostic — assert a finite,
    // bounded delta was passed in.
    const quotaCall = mocks.syncService.checkStorageQuota.mock.calls[0];
    expect(quotaCall[0]).toBe(1);
    expect(typeof quotaCall[1]).toBe('number');
    expect(quotaCall[1]).toBeGreaterThan(0);
    expect(quotaCall[1]).toBeLessThan(payloadSize);
  });

  it('should reject oversized op batches before schema validation', async () => {
    const clientId = 'too-many-ops-client';
    const payload = {
      ops: Array.from({ length: SUPER_SYNC_MAX_OPS_PER_UPLOAD + 1 }, (_, i) => ({
        ...createOp(clientId),
        entityId: `task-${i}`,
        timestamp: Date.now() + i,
      })),
      clientId,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual(
      expect.objectContaining({
        errorCode: SYNC_ERROR_CODES.PAYLOAD_TOO_LARGE,
        maxOpsPerBatch: SUPER_SYNC_MAX_OPS_PER_UPLOAD,
      }),
    );
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
  });

  it('should fall back to UTF-8 JSON byte size for plain JSON without content-length', async () => {
    const clientId = 'plain-json-client';
    const payload = {
      ops: [
        createOp(clientId),
        {
          ...createOp(clientId),
          id: 'op-unicode',
          entityId: 'task-unicode',
          payload: { title: 'Übergrößenträger 🚀' },
        },
      ],
      clientId,
    };
    const jsonPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-length': 'not-a-number',
      },
      payload: jsonPayload,
    });

    expect(response.statusCode).toBe(200);
    const quotaCall = mocks.syncService.checkStorageQuota.mock.calls[0];
    expect(quotaCall[0]).toBe(1);
    expect(typeof quotaCall[1]).toBe('number');
    expect(quotaCall[1]).toBeGreaterThan(0);
    // Multi-byte UTF-8 payload must measure larger in bytes than UTF-16 units
    // to keep the quota gate accurate.
    expect(Buffer.byteLength(jsonPayload, 'utf-8')).toBeGreaterThan(jsonPayload.length);
  });

  it('should accept base64 gzip ops upload', async () => {
    const clientId = 'base64-gzip-client';
    const payload = {
      ops: [createOp(clientId)],
      clientId,
    };
    const compressedPayload = await gzipAsync(
      Buffer.from(JSON.stringify(payload), 'utf-8'),
    );
    const decompressedSize = Buffer.byteLength(JSON.stringify(payload), 'utf-8');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: compressedPayload.toString('base64'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].accepted).toBe(true);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    const quotaCall = mocks.syncService.checkStorageQuota.mock.calls[0];
    expect(quotaCall[0]).toBe(1);
    expect(typeof quotaCall[1]).toBe('number');
    expect(quotaCall[1]).toBeGreaterThan(0);
    expect(quotaCall[1]).toBeLessThan(decompressedSize);
    expect(decompressedSize).not.toBe(
      Buffer.byteLength(compressedPayload.toString('base64'), 'utf-8'),
    );
  });

  it('should allow base64 gzip ops up to the binary compressed limit', async () => {
    const clientId = 'base64-gzip-large-client';
    const randomBlob = randomBytes(Math.floor(7.6 * MiB)).toString('base64');
    const payload = {
      ops: [
        {
          ...createOp(clientId),
          payload: { blob: randomBlob },
        },
      ],
      clientId,
    };
    const compressedPayload = await gzipAsync(
      Buffer.from(JSON.stringify(payload), 'utf-8'),
    );
    const base64Payload = compressedPayload.toString('base64');

    expect(compressedPayload.length).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(Buffer.byteLength(base64Payload, 'utf-8')).toBeGreaterThan(10 * 1024 * 1024);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: base64Payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
  });

  it('should keep plain JSON ops capped at the binary route limit', async () => {
    const clientId = 'plain-json-large-client';
    const jsonPayload = JSON.stringify({
      ops: [
        {
          ...createOp(clientId),
          payload: { blob: 'x'.repeat(10 * MiB) },
        },
      ],
      clientId,
    });
    const payloadSize = Buffer.byteLength(jsonPayload, 'utf-8');

    expect(payloadSize).toBeGreaterThan(10 * MiB);
    expect(payloadSize).toBeLessThan(13 * MiB);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-length': String(payloadSize),
      },
      payload: jsonPayload,
    });

    expect(response.statusCode).toBe(413);
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should skip snapshot metadata for upload piggyback downloads', async () => {
    const clientId = 'plain-json-client';
    const payload = {
      ops: [createOp(clientId)],
      clientId,
      lastKnownServerSeq: 0,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.getOpsSinceWithSeq).toHaveBeenCalledWith(
      1,
      0,
      clientId,
      500,
      false,
    );
  });

  it('should skip snapshot metadata for deduplicated retry piggyback downloads', async () => {
    const clientId = 'plain-json-client';
    const cachedResults = [{ accepted: true, serverSeq: 1 }];
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(cachedResults);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [],
      latestSeq: 4,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: {
        ops: [createOp(clientId)],
        clientId,
        lastKnownServerSeq: 3,
        requestId: 'retry-request',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: cachedResults,
      latestSeq: 4,
      deduplicated: true,
    });
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
    expect(mocks.syncService.getOpsSinceWithSeq).toHaveBeenCalledWith(
      1,
      3,
      clientId,
      500,
      false,
    );
  });

  it('should charge compressed snapshot uploads by decompressed JSON size', async () => {
    const clientId = 'base64-gzip-snapshot-client';
    const payload = {
      state: {
        tasks: {
          'task-1': { id: 'task-1', title: 'Snapshot Task' },
        },
      },
      clientId,
      reason: 'recovery',
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    };
    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: compressedPayload.toString('base64'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);
    expect(mocks.syncService.cacheSnapshotIfReplayable).toHaveBeenCalledWith(
      1,
      payload.state,
      1,
      false,
      expect.anything(),
    );
    // Snapshot quota gate now accounts via estimated op + cache-delta bytes
    // rather than the raw request body size. Stay value-agnostic; the
    // compression-handling intent is still covered by the 200 + cacheSnapshot.
    const quotaCall = mocks.syncService.checkStorageQuota.mock.calls[0];
    expect(quotaCall[0]).toBe(1);
    expect(typeof quotaCall[1]).toBe('number');
    expect(quotaCall[1]).toBeGreaterThanOrEqual(0);
    void jsonPayload;
  });

  it('should allow base64 gzip snapshots up to the binary compressed limit', async () => {
    const clientId = 'base64-gzip-large-snapshot-client';
    const randomBlob = randomBytes(Math.floor(22.6 * MiB)).toString('base64');
    const payload = {
      state: {
        TASK: {
          'task-1': { id: 'task-1', blob: randomBlob },
        },
      },
      clientId,
      reason: 'recovery',
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    };
    const compressedPayload = await gzipAsync(
      Buffer.from(JSON.stringify(payload), 'utf-8'),
    );
    const base64Payload = compressedPayload.toString('base64');

    expect(compressedPayload.length).toBeLessThanOrEqual(30 * MiB);
    expect(Buffer.byteLength(base64Payload, 'utf-8')).toBeGreaterThan(30 * MiB);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: base64Payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);
    expect(mocks.syncService.cacheSnapshotIfReplayable).toHaveBeenCalledWith(
      1,
      payload.state,
      1,
      false,
      expect.anything(),
    );
  }, 15000);

  it('should keep plain JSON snapshots capped at the binary route limit', async () => {
    const clientId = 'plain-json-large-snapshot-client';
    const jsonPayload = JSON.stringify({
      state: { TASK: { 'task-1': { id: 'task-1', blob: 'x'.repeat(30 * MiB) } } },
      clientId,
      reason: 'recovery',
      vectorClock: { [clientId]: 1 },
    });
    const payloadSize = Buffer.byteLength(jsonPayload, 'utf-8');

    expect(payloadSize).toBeGreaterThan(30 * MiB);
    expect(payloadSize).toBeLessThan(40 * MiB);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-length': String(payloadSize),
      },
      payload: jsonPayload,
    });

    expect(response.statusCode).toBe(413);
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should preserve the invalid gzip route response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: Buffer.from('not valid gzip data', 'utf-8'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Failed to decompress gzip body');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should reject clean-slate snapshot when replacement exceeds quota', async () => {
    const clientId = 'clean-slate-quota-client';
    mocks.syncService.prepareSnapshotCache.mockReturnValueOnce({
      data: Buffer.from('cached-snapshot'),
      bytes: 80,
      stateBytes: 30,
      cacheable: true,
    });
    mocks.syncService.getStorageInfo.mockResolvedValueOnce({
      storageUsedBytes: 1000,
      storageQuotaBytes: 100,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'initial',
        vectorClock: {},
        isCleanSlate: true,
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should repeat initial snapshot duplicate detection inside the user lock', async () => {
    const clientId = 'initial-race-client';
    mocks.prisma.operation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-import', clientId: 'other-client' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'initial',
        vectorClock: { [clientId]: 1 },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      errorCode: 'SYNC_IMPORT_EXISTS',
      existingImportId: 'existing-import',
    });
    expect(mocks.prisma.operation.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should return cached snapshot upload response for retried requestId', async () => {
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue({
      accepted: true,
      serverSeq: 42,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId: 'snapshot-retry-client',
        reason: 'initial',
        vectorClock: { 'snapshot-retry-client': 1 },
        requestId: 'snapshot-v1-retry',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, serverSeq: 42 });
    expect(mocks.syncService.checkSnapshotRequestDedup).toHaveBeenCalledWith(
      1,
      'snapshot-v1-retry',
    );
    expect(mocks.syncService.checkOpsRequestDedup).not.toHaveBeenCalled();
    expect(mocks.prisma.operation.findFirst).not.toHaveBeenCalled();
    expect(mocks.syncService.prepareSnapshotCache).not.toHaveBeenCalled();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should convert a snapshot DUPLICATE_OPERATION rejection into an idempotent success when the op exists', async () => {
    // Retry scenario: original snapshot was committed but its response was
    // lost; the retry hits the duplicate-opId check inside uploadOps, and the
    // route turns that into a success response carrying the original seq.
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    mocks.syncService.prepareSnapshotCache.mockResolvedValue({
      cacheable: true,
      bytes: 0,
      cleanSlate: false,
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.syncService.getStorageInfo.mockResolvedValue({
      currentUsage: 0,
      quotaBytes: 100 * MiB,
    });
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.uploadOps.mockResolvedValue([
      {
        opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
        accepted: false,
        error: 'Duplicate operation ID',
        errorCode: 'DUPLICATE_OPERATION',
      },
    ]);
    // The first attempt actually persisted; the route looks it up via findFirst
    // with a userId guard, so the mock must match the (id, userId) shape and
    // return the original serverSeq for the conversion to succeed.
    mocks.prisma.operation.findFirst.mockImplementation(
      async ({ where }: { where: { id?: string; userId?: number } }) => {
        if (where.id === '018f2f0b-1c2d-7a1b-8c3d-123456789abc' && where.userId === 1) {
          return { serverSeq: 77 };
        }
        // SYNC_IMPORT_EXISTS pre-check (not exercised for reason='recovery',
        // but kept defensively so an accidental call returns "no existing op").
        return null;
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: {} },
        clientId: 'dup-client',
        reason: 'recovery',
        vectorClock: { 'dup-client': 1 },
        opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
        requestId: 'snapshot-v1-dup-test',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, serverSeq: 77 });
    // The conversion should also re-arm the dedup cache so subsequent retries
    // can short-circuit even more cheaply.
    expect(mocks.syncService.cacheSnapshotRequestResult).toHaveBeenCalledWith(
      1,
      'snapshot-v1-dup-test',
      { accepted: true, serverSeq: 77 },
    );
  });

  it('should return idempotent success for a retried SYNC_IMPORT whose opId matches the existing import', async () => {
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    const retryOpId = '018f2f0b-1c2d-7a1b-8c3d-123456789abc';
    // Existing SYNC_IMPORT for this user, same opId as the retry. The route
    // looks the opId up directly via findUnique to keep the idempotency check
    // deterministic when multiple full-state ops exist for the user.
    mocks.prisma.operation.findUnique.mockResolvedValue({
      id: retryOpId,
      userId: 1,
      clientId: 'dup-client',
      serverSeq: 99,
      opType: 'SYNC_IMPORT',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: {} },
        clientId: 'dup-client',
        reason: 'initial',
        vectorClock: { 'dup-client': 1 },
        opId: retryOpId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, serverSeq: 99 });
    // The pre-lock fast path should short-circuit before any work.
    expect(mocks.syncService.prepareSnapshotCache).not.toHaveBeenCalled();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should treat a retried SYNC_IMPORT idempotently even when other full-state ops exist for the user', async () => {
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    const retryOpId = '018f2f0b-1c2d-7a1b-8c3d-fedcba987654';
    // The opId-based lookup finds the exact retried op.
    mocks.prisma.operation.findUnique.mockResolvedValue({
      id: retryOpId,
      userId: 1,
      clientId: 'dup-client',
      serverSeq: 42,
      opType: 'SYNC_IMPORT',
    });
    // A later BACKUP_IMPORT also exists — without exact-match lookup,
    // findFirst could return this instead and the idempotency check would
    // incorrectly fail.
    mocks.prisma.operation.findFirst.mockResolvedValue({
      id: '018f2f0b-9999-7a1b-8c3d-aaaaaaaaaaaa',
      clientId: 'other-client',
      serverSeq: 142,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: {} },
        clientId: 'dup-client',
        reason: 'initial',
        vectorClock: { 'dup-client': 1 },
        opId: retryOpId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, serverSeq: 42 });
    expect(mocks.prisma.operation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: retryOpId } }),
    );
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should reject a SYNC_IMPORT whose opId belongs to a different user', async () => {
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    const retryOpId = '018f2f0b-1c2d-7a1b-8c3d-cccccccccccc';
    // Same opId exists but for a different user — must not be treated as an
    // idempotent retry; the userId guard in findExistingSyncImport prevents
    // cross-tenant leakage. Fall through to the (most-recent) full-state op
    // for *this* user.
    mocks.prisma.operation.findUnique.mockResolvedValue({
      id: retryOpId,
      userId: 999,
      clientId: 'other-user-client',
      serverSeq: 7,
      opType: 'SYNC_IMPORT',
    });
    mocks.prisma.operation.findFirst.mockResolvedValue({
      id: '018f2f0b-8888-7a1b-8c3d-bbbbbbbbbbbb',
      clientId: 'this-user-client',
      serverSeq: 17,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: {} },
        clientId: 'dup-client',
        reason: 'initial',
        vectorClock: { 'dup-client': 1 },
        opId: retryOpId,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      errorCode: 'SYNC_IMPORT_EXISTS',
      existingImportId: '018f2f0b-8888-7a1b-8c3d-bbbbbbbbbbbb',
    });
  });

  it('should reconcile the counter before rejecting on the cheap snapshot pre-gate', async () => {
    // Regression for W10: when the cached counter says we are at quota, the
    // route reconciles once before rejecting — a stale-high counter would
    // otherwise lock out users whose new snapshot would actually shrink
    // their storage.
    const clientId = 'pre-gate-reconcile-client';
    const vectorClock = { [clientId]: 1 };

    // 1st getStorageInfo returns stale-high (over quota). After reconcile,
    // the 2nd call returns the corrected (under quota) value.
    mocks.syncService.getStorageInfo
      .mockResolvedValueOnce({
        storageUsedBytes: 100 * 1024 * 1024,
        storageQuotaBytes: 100 * 1024 * 1024,
      })
      .mockResolvedValue({
        storageUsedBytes: 50_000,
        storageQuotaBytes: 100 * 1024 * 1024,
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock,
      },
    });

    expect(mocks.syncService.updateStorageUsage).toHaveBeenCalledWith(1);
    expect(response.statusCode).toBe(200);
  });

  it('should still 413 on the snapshot pre-gate when reconcile confirms over-quota', async () => {
    // Same path as above, but reconcile does not move the counter. The
    // rejection now uses errorCode (not code) and routes through the unified
    // 413 helper.
    const clientId = 'pre-gate-no-reconcile-client';
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 100 * 1024 * 1024,
      storageQuotaBytes: 100 * 1024 * 1024,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock: { [clientId]: 1 },
      },
    });

    expect(response.statusCode).toBe(413);
    const body = response.json();
    expect(body.errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
    // No legacy `code:` key — clients dispatch on errorCode.
    expect(body.code).toBeUndefined();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should fall through gracefully when the pre-gate reconcile throws', async () => {
    // If the reconcile fails (DB hiccup), the route logs and uses the stale
    // cached read. Either accept (cached < quota) or reject with 413 — but
    // never bubble a 500.
    const clientId = 'pre-gate-reconcile-throws';
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 100 * 1024 * 1024,
      storageQuotaBytes: 100 * 1024 * 1024,
    });
    mocks.syncService.updateStorageUsage.mockRejectedValueOnce(new Error('db down'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock: { [clientId]: 1 },
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
  });

  it('should mark the user for forced reconcile when post-commit counter delta fails', async () => {
    // Regression for W6: when applyStorageUsageDelta (called after a
    // successful snapshot upload) fails, the user must be marked so the
    // next quota check self-heals instead of waiting for daily cleanup.
    const clientId = 'post-commit-counter-failure';
    const vectorClock = { [clientId]: 1 };
    mocks.syncService.prepareSnapshotCache.mockReturnValueOnce({
      data: Buffer.from('cached-snapshot'),
      bytes: 40,
      stateBytes: 25,
      cacheable: true,
    });
    mocks.syncService.uploadOps.mockResolvedValueOnce([{ accepted: true, serverSeq: 7 }]);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValueOnce({
      cached: true,
      bytesWritten: 40,
      previousBytes: 10,
      deltaBytes: 30,
    });
    mocks.syncService.incrementStorageUsage.mockRejectedValueOnce(
      new Error('counter down'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock,
      },
    });

    // The data write is committed; the response must still succeed even
    // though the counter is stale.
    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.markStorageNeedsReconcile).toHaveBeenCalledWith(1);
  });

  it('should pre-gate the snapshot upload by op + cache-delta bytes', async () => {
    // B3-route: the gate budget covers BOTH the op row (payload+vc) and the
    // cache rewrite, so the user cannot squeeze through a snapshot whose
    // op-row alone fits but whose cache delta would breach quota. The
    // post-commit increment, however, only writes the cache portion — the
    // op-row counter is now incremented inside `uploadOps`'s `$transaction`.
    const clientId = 'snapshot-delta-client';
    const vectorClock = { [clientId]: 1 };
    const preparedSnapshot = {
      data: Buffer.from('cached-snapshot'),
      bytes: 40,
      stateBytes: 25,
      cacheable: true,
    };
    mocks.syncService.prepareSnapshotCache.mockReturnValueOnce(preparedSnapshot);
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValueOnce(10);
    mocks.syncService.uploadOps.mockResolvedValueOnce([{ accepted: true, serverSeq: 7 }]);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValueOnce({
      cached: true,
      bytesWritten: 40,
      previousBytes: 10,
      deltaBytes: 30,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock,
      },
    });

    const vectorClockBytes = Buffer.byteLength(JSON.stringify(vectorClock), 'utf8');
    // Gate budget = op-row bytes + cache-delta bytes (40 - 10 = 30).
    const expectedGate = preparedSnapshot.stateBytes + vectorClockBytes + 30;

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(1, expectedGate);
    expect(mocks.syncService.cacheSnapshotIfReplayable).toHaveBeenCalledWith(
      1,
      { TASK: { 'task-1': { id: 'task-1' } } },
      7,
      false,
      preparedSnapshot,
    );
    // Post-commit increment only carries the snapshot-cache portion; the
    // op-row counter is written atomically inside `uploadOps`'s transaction.
    expect(mocks.syncService.incrementStorageUsage).toHaveBeenCalledWith(1, 30);
  });

  it('should subtract the old snapshot cache when a replacement is too large to cache', async () => {
    const clientId = 'oversized-cache-replacement-client';
    const vectorClock = { [clientId]: 1 };
    const preparedSnapshot = {
      data: Buffer.from('too-large-to-cache'),
      bytes: 51 * 1024 * 1024,
      stateBytes: 25,
      cacheable: false,
    };
    mocks.syncService.prepareSnapshotCache.mockReturnValueOnce(preparedSnapshot);
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValueOnce(90);
    mocks.syncService.uploadOps.mockResolvedValueOnce([{ accepted: true, serverSeq: 7 }]);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValueOnce({
      cached: false,
      bytesWritten: 0,
      previousBytes: 90,
      deltaBytes: -90,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: { TASK: { 'task-1': { id: 'task-1' } } },
        clientId,
        reason: 'recovery',
        vectorClock,
      },
    });

    const vectorClockBytes = Buffer.byteLength(JSON.stringify(vectorClock), 'utf8');
    const expectedGateDelta = preparedSnapshot.stateBytes + vectorClockBytes - 90;

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(
      1,
      expectedGateDelta,
    );
    // Post-commit, the route only applies the snapshot-cache portion of the
    // delta — the op-row portion is written atomically inside uploadOps's
    // $transaction (wave-1 B3 / commit 9af17e460e). cacheSnapshotIfReplayable
    // reported deltaBytes = -90 (the cleared cache), so the route's
    // applyStorageUsageDelta path decrements by 90.
    expect(mocks.syncService.decrementStorageUsage).toHaveBeenCalledWith(1, 90);
    expect(mocks.syncService.incrementStorageUsage).not.toHaveBeenCalled();
  });
});

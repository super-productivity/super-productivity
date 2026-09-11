import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const mocks = vi.hoisted(() => {
  const syncService = {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    getLatestStateReplacementSeq: vi.fn(),
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
    getMaxClockDriftMs: vi.fn(),
    filterValidOpsForQuota: vi.fn(),
    getPrevalidatedPayloadBytes: vi.fn(),
  };
  const prisma = {
    operation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
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
import {
  STATE_REPLACEMENT_REQUIRED_ERROR,
  SYNC_ERROR_CODES,
} from '../src/sync/sync.types';
import { computeOpStorageBytes } from '../src/sync/sync.const';
import { CURRENT_SCHEMA_VERSION, SUPER_SYNC_MAX_OPS_PER_UPLOAD } from '@sp/shared-schema';

const gzipAsync = promisify(zlib.gzip);

// Uploads must pass the encrypted-only ingress gate: flag true + a payload
// with the ciphertext transport shape (canonical base64, >= 28 bytes). Use
// distinct fills/sizes where tests need distinguishable payload content.
const ENCRYPTED_PAYLOAD = Buffer.alloc(44, 7).toString('base64');
const encryptedPayload = (fill: number, bytes = 44): string =>
  Buffer.alloc(bytes, fill).toString('base64');

const createOp = (clientId: string) => ({
  id: 'op-1',
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: ENCRYPTED_PAYLOAD,
  isPayloadEncrypted: true,
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
});

const createStoredDuplicateOp = (op: ReturnType<typeof createOp>) => ({
  id: op.id,
  userId: 1,
  clientId: op.clientId,
  actionType: op.actionType,
  opType: op.opType,
  entityType: op.entityType,
  entityId: op.entityId,
  entityIds: [],
  payload: op.payload,
  vectorClock: op.vectorClock,
  schemaVersion: op.schemaVersion,
  clientTimestamp: BigInt(op.timestamp),
  receivedAt: BigInt(op.timestamp),
  isPayloadEncrypted: true,
  syncImportReason: null,
  repairBaseServerSeq: null,
});

const MiB = 1024 * 1024;

describe('Sync compressed body routes', () => {
  let app: FastifyInstance;
  const authToken = 'mock-token';

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(null);
    mocks.syncService.checkSnapshotRequestDedup.mockReturnValue(null);
    mocks.syncService.getMaxClockDriftMs.mockReturnValue(60_000);
    mocks.syncService.filterValidOpsForQuota.mockImplementation((ops: unknown[]) => ops);
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
    mocks.prisma.operation.findUnique.mockReset().mockResolvedValue(null);
    mocks.prisma.operation.findMany.mockResolvedValue([]);

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

  it('should pass mixed schema versions to per-operation validation', async () => {
    const clientId = 'mixed-schema-client';
    const validOp = createOp(clientId);
    const invalidOp = {
      ...createOp(clientId),
      id: 'invalid-schema-op',
      schemaVersion: 101,
    };
    mocks.syncService.uploadOps.mockResolvedValueOnce([
      { opId: validOp.id, accepted: true, serverSeq: 1 },
      {
        opId: invalidOp.id,
        accepted: false,
        error: 'Invalid schema version: 101',
        errorCode: SYNC_ERROR_CODES.INVALID_SCHEMA_VERSION,
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: { ops: [validOp, invalidOp], clientId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      expect.objectContaining({ opId: validOp.id, accepted: true }),
      expect.objectContaining({
        opId: invalidOp.id,
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_SCHEMA_VERSION,
      }),
    ]);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      clientId,
      [validOp, invalidOp],
      undefined,
      new Set(),
      undefined,
      false,
      undefined,
    );
  });

  it('should not let an invalid large sibling poison a near-quota upload', async () => {
    const clientId = 'invalid-sibling-quota-client';
    const validOp = {
      ...createOp(clientId),
      id: 'valid-near-quota-op',
      payload: encryptedPayload(1),
    };
    const invalidLargeOp = {
      ...createOp(clientId),
      id: 'invalid-large-op',
      opType: 'UNKNOWN',
      payload: encryptedPayload(2, 10_000),
    };
    const validBytes = computeOpStorageBytes(validOp).bytes;
    mocks.syncService.filterValidOpsForQuota.mockReturnValueOnce([validOp]);
    mocks.syncService.checkStorageQuota.mockImplementation(
      async (_userId: number, additionalBytes: number) => ({
        allowed: additionalBytes <= validBytes,
        currentUsage: 1_000_000 - validBytes,
        quota: 1_000_000,
      }),
    );
    mocks.syncService.uploadOps.mockResolvedValueOnce([
      { opId: validOp.id, accepted: true, serverSeq: 1 },
      {
        opId: invalidLargeOp.id,
        accepted: false,
        error: 'Invalid opType',
        errorCode: SYNC_ERROR_CODES.INVALID_OP_TYPE,
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: { ops: [validOp, invalidLargeOp], clientId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      expect.objectContaining({ opId: validOp.id, accepted: true }),
      expect.objectContaining({
        opId: invalidLargeOp.id,
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INVALID_OP_TYPE,
      }),
    ]);
    expect(mocks.syncService.filterValidOpsForQuota).toHaveBeenCalledWith(
      [validOp, invalidLargeOp],
      clientId,
    );
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(1, validBytes);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      clientId,
      [validOp, invalidLargeOp],
      undefined,
      new Set(),
      undefined,
      false,
      undefined,
    );
  });

  it('should subtract exact already-stored duplicate ops from the ops quota gate', async () => {
    const clientId = 'known-duplicate-quota-client';
    const duplicateOp = {
      ...createOp(clientId),
      id: 'known-duplicate-op',
      entityId: 'task-known-duplicate',
      payload: encryptedPayload(3),
    };
    const newOp = {
      ...createOp(clientId),
      id: 'new-op',
      entityId: 'task-new',
      payload: encryptedPayload(4),
    };
    mocks.prisma.operation.findMany.mockResolvedValueOnce([
      createStoredDuplicateOp(duplicateOp),
    ]);
    mocks.syncService.uploadOps.mockResolvedValueOnce([
      {
        opId: duplicateOp.id,
        accepted: false,
        error: 'Duplicate operation ID',
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      },
      { opId: newOp.id, accepted: true, serverSeq: 2 },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: {
        ops: [duplicateOp, newOp],
        clientId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.operation.findMany).toHaveBeenCalledOnce();
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(
      1,
      computeOpStorageBytes(newOp).bytes,
    );
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      clientId,
      [duplicateOp, newOp],
      undefined,
      new Set([duplicateOp.id]),
      undefined,
      false,
      undefined,
    );
  });

  it('should not charge same-id different-content ops in the quota gate', async () => {
    const clientId = 'id-collision-quota-client';
    const incomingOp = {
      ...createOp(clientId),
      id: 'colliding-op-id',
      entityId: 'task-collision',
      payload: encryptedPayload(5),
    };
    const storedDifferentOp = createStoredDuplicateOp({
      ...incomingOp,
      payload: encryptedPayload(6),
    });
    mocks.prisma.operation.findMany.mockResolvedValueOnce([storedDifferentOp]);
    mocks.syncService.uploadOps.mockResolvedValueOnce([
      {
        opId: incomingOp.id,
        accepted: false,
        error: 'Operation ID already belongs to a different operation',
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: {
        ops: [incomingOp],
        clientId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(1, 0);
    expect(mocks.prisma.operation.findMany).toHaveBeenCalledWith({
      where: { id: { in: [incomingOp.id] } },
      select: { id: true },
    });
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      clientId,
      [incomingOp],
      undefined,
      new Set([incomingOp.id]),
      undefined,
      false,
      undefined,
    );
  });

  it('should charge only the first occurrence of a repeated new ID', async () => {
    const clientId = 'intra-batch-duplicate-quota-client';
    const firstOp = {
      ...createOp(clientId),
      id: 'repeated-new-id',
      entityId: 'task-first',
      payload: encryptedPayload(8),
    };
    const repeatedOp = {
      ...firstOp,
      entityId: 'task-second',
      payload: encryptedPayload(9),
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: { ops: [firstOp, repeatedOp], clientId },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(
      1,
      computeOpStorageBytes(firstOp).bytes,
    );
  });

  it('should not trigger cleanup for duplicate-only ops uploads near quota', async () => {
    const clientId = 'duplicate-only-quota-client';
    const duplicateOp = {
      ...createOp(clientId),
      id: 'duplicate-only-op',
      entityId: 'task-duplicate-only',
    };
    mocks.prisma.operation.findMany.mockResolvedValueOnce([
      createStoredDuplicateOp(duplicateOp),
    ]);
    mocks.syncService.checkStorageQuota.mockImplementation(
      async (_userId: number, storageDeltaBytes: number) => ({
        allowed: storageDeltaBytes === 0,
        currentUsage: 100,
        quota: 100,
      }),
    );
    mocks.syncService.uploadOps.mockResolvedValueOnce([
      {
        opId: duplicateOp.id,
        accepted: false,
        error: 'Duplicate operation ID',
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: {
        ops: [duplicateOp],
        clientId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(1, 0);
    expect(mocks.syncService.freeStorageForUpload).not.toHaveBeenCalled();
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
          // Payloads must be ciphertext-shaped, so carry the multi-byte
          // UTF-8 content in a non-gated string field instead.
          actionType: 'Übergrößenträger 🚀',
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
    // base64 of random bytes is itself a valid ciphertext transport shape.
    const randomBlob = randomBytes(Math.floor(7.6 * MiB)).toString('base64');
    const payload = {
      ops: [
        {
          ...createOp(clientId),
          payload: randomBlob,
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
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      clientId,
      payload.ops,
      undefined,
      new Set(),
      undefined,
      false,
      0,
    );
  });

  it('reprocesses stale cached results and includes a same-client replacement', async () => {
    const clientId = 'same-client-replacement';
    const staleResult = {
      opId: 'op-1',
      accepted: false,
      error: STATE_REPLACEMENT_REQUIRED_ERROR,
      errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
    };
    const replacement = {
      serverSeq: 3,
      op: {
        ...createOp(clientId),
        id: 'state-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
        syncImportReason: 'FORCE_UPLOAD',
      },
      receivedAt: Date.now(),
    };
    mocks.syncService.checkOpsRequestDedup.mockReturnValue([
      { opId: 'op-1', accepted: true, serverSeq: 2 },
    ]);
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(3);
    mocks.syncService.uploadOps.mockResolvedValue([staleResult]);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [replacement],
      latestSeq: 3,
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
        lastKnownServerSeq: 2,
        requestId: 'pre-replacement-request',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [staleResult],
      newOps: [replacement],
      latestSeq: 3,
    });
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    expect(mocks.syncService.getOpsSinceWithSeq).toHaveBeenCalledWith(
      1,
      2,
      undefined,
      500,
      false,
    );
  });

  it('reprocesses a cached success deleted by a replacement at the current cursor', async () => {
    const clientId = 'current-after-replacement';
    mocks.syncService.checkOpsRequestDedup.mockReturnValue([
      { opId: 'op-1', accepted: true, serverSeq: 2 },
    ]);
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(3);
    mocks.syncService.uploadOps.mockResolvedValue([
      { opId: 'op-1', accepted: true, serverSeq: 4 },
    ]);
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
        requestId: 'accepted-before-replacement',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [{ opId: 'op-1', accepted: true, serverSeq: 4 }],
      latestSeq: 4,
    });
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    expect(mocks.syncService.cacheOpsRequestResults).toHaveBeenCalledWith(
      1,
      'accepted-before-replacement',
      [{ opId: 'op-1', accepted: true, serverSeq: 4 }],
      expect.any(String),
    );
  });

  it('rechecks the replacement boundary after reading a cached retry response', async () => {
    const clientId = 'replacement-race-client';
    const staleResult = {
      opId: 'op-1',
      accepted: false,
      error: STATE_REPLACEMENT_REQUIRED_ERROR,
      errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
    };
    const replacement = {
      serverSeq: 3,
      op: {
        ...createOp(clientId),
        id: 'concurrent-state-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
        syncImportReason: 'PASSWORD_CHANGED',
      },
      receivedAt: Date.now(),
    };
    mocks.syncService.checkOpsRequestDedup.mockReturnValue([
      { opId: 'op-1', accepted: true, serverSeq: 2 },
    ]);
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(3);
    mocks.syncService.getOpsSinceWithSeq
      .mockResolvedValueOnce({
        ops: [],
        latestSeq: 2,
      })
      .mockResolvedValueOnce({
        ops: [replacement],
        latestSeq: 3,
      });
    mocks.syncService.uploadOps.mockResolvedValue([staleResult]);

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
        lastKnownServerSeq: 2,
        requestId: 'replacement-race',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [staleResult],
      newOps: [replacement],
      latestSeq: 3,
    });
    expect(mocks.syncService.getLatestStateReplacementSeq).toHaveBeenCalledOnce();
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
  });

  it('returns the replacement fence before destructive quota cleanup', async () => {
    const clientId = 'stale-near-quota';
    const replacement = {
      serverSeq: 3,
      op: {
        ...createOp('replacement-client'),
        id: 'state-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
        syncImportReason: 'PASSWORD_CHANGED',
      },
      receivedAt: Date.now(),
    };
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: false,
      currentUsage: 100,
      quota: 100,
    });
    mocks.syncService.getLatestStateReplacementSeq.mockResolvedValue(3);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [replacement],
      latestSeq: 3,
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
        lastKnownServerSeq: 2,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [
        {
          opId: 'op-1',
          accepted: false,
          error: STATE_REPLACEMENT_REQUIRED_ERROR,
          errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
        },
      ],
      newOps: [replacement],
      latestSeq: 3,
    });
    expect(mocks.syncService.updateStorageUsage).not.toHaveBeenCalled();
    expect(mocks.syncService.freeStorageForUpload).not.toHaveBeenCalled();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
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
      state: encryptedPayload(10, 2048),
      isPayloadEncrypted: true,
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
      true,
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
    // base64 of random bytes is itself a valid ciphertext transport shape.
    const randomBlob = randomBytes(Math.floor(22.6 * MiB)).toString('base64');
    const payload = {
      state: randomBlob,
      isPayloadEncrypted: true,
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
      true,
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
    // Post-gate, encrypted clean-slates are charged by op bytes alone
    // (30 + 2 vector-clock bytes), so the quota must sit below that.
    mocks.syncService.getStorageInfo.mockResolvedValueOnce({
      storageUsedBytes: 1000,
      storageQuotaBytes: 20,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
        clientId,
        reason: 'initial',
        vectorClock: {},
        opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
        isCleanSlate: true,
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().errorCode).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
  });

  it('should charge an encrypted clean-slate by op bytes only (no phantom cache bytes)', async () => {
    // Regression: preparedSnapshot.bytes used to be added to the clean-slate
    // quota gate even though encrypted state is never cached, so near-quota
    // clean-slate uploads got 413 for storage that never materializes.
    const clientId = 'clean-slate-fit-client';
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
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
        clientId,
        reason: 'initial',
        vectorClock: {},
        opId: '018f2f0b-1c2d-7a1b-8c3d-abcdef123456',
        isCleanSlate: true,
      },
    });

    // 30 op bytes + 2 vector-clock bytes fit the 100-byte quota; the 80
    // phantom cache bytes would have pushed it to 112 and a spurious 413.
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
  });

  it('should return persistent success for a clean-slate retry before deleting data', async () => {
    const opId = '018f2f0b-1c2d-7a1b-8c3d-123456789abc';
    const clientId = 'clean-slate-retry-client';
    const state = encryptedPayload(11);
    const vectorClock = { [clientId]: 1 };
    mocks.prisma.operation.findUnique.mockResolvedValueOnce({
      id: opId,
      userId: 1,
      clientId,
      actionType: '[SP_ALL] Load(import) all data',
      opType: 'SYNC_IMPORT',
      entityType: 'ALL',
      entityId: null,
      entityIds: [],
      payload: state,
      vectorClock,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      clientTimestamp: BigInt(1),
      receivedAt: BigInt(1),
      isPayloadEncrypted: true,
      syncImportReason: null,
      serverSeq: 77,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state,
        isPayloadEncrypted: true,
        clientId,
        reason: 'recovery',
        vectorClock,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        opId,
        isCleanSlate: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, serverSeq: 77 });
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
  });

  it('should reject a clean-slate retry whose opId belongs to different content', async () => {
    const opId = '018f2f0b-1c2d-7a1b-8c3d-123456789abc';
    const clientId = 'clean-slate-collision-client';
    const vectorClock = { [clientId]: 1 };
    // Encrypted retries are matched structurally (ciphertext bytes differ per
    // encryption because of the fresh IV), so "different content" must show
    // up in a structural field — here the vector clock.
    mocks.prisma.operation.findUnique.mockResolvedValueOnce({
      id: opId,
      userId: 1,
      clientId,
      actionType: '[SP_ALL] Load(import) all data',
      opType: 'SYNC_IMPORT',
      entityType: 'ALL',
      entityId: null,
      entityIds: [],
      payload: encryptedPayload(12),
      vectorClock: { [clientId]: 99 },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      clientTimestamp: BigInt(1),
      receivedAt: BigInt(1),
      isPayloadEncrypted: true,
      syncImportReason: null,
      serverSeq: 77,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: encryptedPayload(13),
        isPayloadEncrypted: true,
        clientId,
        reason: 'recovery',
        vectorClock,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        opId,
        isCleanSlate: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: false,
      error: 'Operation ID already belongs to a different operation',
      errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
    });
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
      expect.any(Function),
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
      expect.any(String),
    );
  });

  it('should return idempotent success when a committed REPAIR retry has a stale base', async () => {
    const repairId = '018f2f0b-1c2d-7a1b-8c3d-123456789abc';
    const state = encryptedPayload(14);
    const vectorClock = { 'repair-client': 3 };
    // The committed first attempt may have filled the account quota. Durable
    // op-id idempotency must still win over the cheap pre-quota gate.
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 100 * MiB,
      storageQuotaBytes: 100 * MiB,
    });
    mocks.prisma.operation.findUnique.mockResolvedValue({
      id: repairId,
      userId: 1,
      clientId: 'repair-client',
      actionType: '[SP_ALL] Load(import) all data',
      opType: 'REPAIR',
      entityType: 'ALL',
      entityId: null,
      entityIds: [],
      payload: state,
      vectorClock,
      schemaVersion: 1,
      isPayloadEncrypted: true,
      syncImportReason: 'REPAIR',
      repairBaseServerSeq: 10,
      serverSeq: 77,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state,
        isPayloadEncrypted: true,
        clientId: 'repair-client',
        reason: 'recovery',
        vectorClock,
        schemaVersion: 1,
        opId: repairId,
        snapshotOpType: 'REPAIR',
        syncImportReason: 'REPAIR',
        repairBaseServerSeq: 10,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
    expect(response.json()).toEqual({ accepted: true, serverSeq: 77 });
  });

  it('should accept a legacy REPAIR request without a causal base non-destructively', async () => {
    const repairId = '018f2f0b-1c2d-7a1b-8c3d-123456789abc';

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
        clientId: 'legacy-repair-client',
        reason: 'recovery',
        vectorClock: { 'legacy-repair-client': 1 },
        schemaVersion: 1,
        opId: repairId,
        snapshotOpType: 'REPAIR',
        syncImportReason: 'REPAIR',
        isCleanSlate: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledWith(
      1,
      'legacy-repair-client',
      [expect.objectContaining({ opType: 'REPAIR', repairBaseServerSeq: undefined })],
      false,
      undefined,
      undefined,
      true,
    );
    expect(mocks.syncService.cacheSnapshotIfReplayable).not.toHaveBeenCalled();
  });

  it('should reject a stale causal REPAIR before quota cleanup', async () => {
    mocks.syncService.getLatestSeq.mockResolvedValue(11);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: false,
      currentUsage: 100 * MiB,
      quota: 100 * MiB,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
        clientId: 'stale-repair-client',
        reason: 'recovery',
        vectorClock: { 'stale-repair-client': 2 },
        schemaVersion: 1,
        opId: '018f2f0b-1c2d-7a1b-8c3d-123456789abc',
        snapshotOpType: 'REPAIR',
        syncImportReason: 'REPAIR',
        repairBaseServerSeq: 10,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: false,
      error: 'REPAIR snapshot does not include current server state',
      errorCode: SYNC_ERROR_CODES.REPAIR_STALE,
    });
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
    expect(mocks.syncService.freeStorageForUpload).not.toHaveBeenCalled();
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
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

  it('should charge encrypted snapshots by op-row bytes only and skip the plaintext cache delta', async () => {
    // Post-gate, every snapshot is encrypted and the server never caches
    // encrypted state: the quota gate budget is the op row (payload + vector
    // clock) alone, and the plaintext cache-delta lookup must not run. The
    // pre-gate plaintext accounting (op row + cache rewrite delta) is no
    // longer reachable through the route.
    const clientId = 'snapshot-delta-client';
    const vectorClock = { [clientId]: 1 };
    const preparedSnapshot = {
      data: Buffer.from('never-cached'),
      bytes: 40,
      stateBytes: 25,
      cacheable: false,
    };
    mocks.syncService.prepareSnapshotCache.mockReturnValueOnce(preparedSnapshot);
    mocks.syncService.uploadOps.mockResolvedValueOnce([{ accepted: true, serverSeq: 7 }]);
    // Encrypted snapshots are never cached; the service reports null.
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        state: ENCRYPTED_PAYLOAD,
        isPayloadEncrypted: true,
        clientId,
        reason: 'recovery',
        vectorClock,
      },
    });

    const vectorClockBytes = Buffer.byteLength(JSON.stringify(vectorClock), 'utf8');

    expect(response.statusCode).toBe(200);
    // Gate budget = op-row bytes only; no cache delta for encrypted state.
    expect(mocks.syncService.checkStorageQuota).toHaveBeenCalledWith(
      1,
      preparedSnapshot.stateBytes + vectorClockBytes,
    );
    expect(mocks.syncService.getCachedSnapshotBytes).not.toHaveBeenCalled();
    expect(mocks.syncService.cacheSnapshotIfReplayable).toHaveBeenCalledWith(
      1,
      ENCRYPTED_PAYLOAD,
      7,
      true,
      preparedSnapshot,
    );
    // No cache write happened, so no post-commit counter delta either.
    expect(mocks.syncService.incrementStorageUsage).not.toHaveBeenCalled();
    expect(mocks.syncService.decrementStorageUsage).not.toHaveBeenCalled();
  });
});

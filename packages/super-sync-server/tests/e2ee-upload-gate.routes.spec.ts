import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
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
    cacheSnapshotIfReplayable: vi.fn(),
    prepareSnapshotCache: vi.fn(),
    updateStorageUsage: vi.fn(),
    runWithStorageUsageLock: vi.fn(),
    getLatestSeq: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
    getStorageInfo: vi.fn(),
    getCachedSnapshotBytes: vi.fn(),
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
import { SYNC_ERROR_CODES } from '../src/sync/sync.types';

const gzipAsync = promisify(zlib.gzip);

// Structurally valid ciphertext transport: canonical base64 of 44 bytes
// (Argon2id envelope minimum). The classifier checks shape, not content.
const VALID_ENVELOPE_B64 = Buffer.alloc(44, 7).toString('base64');
// Canonical base64 but below the 28-byte legacy envelope minimum.
const TOO_SHORT_ENVELOPE_B64 = Buffer.alloc(27, 7).toString('base64');

const PLAINTEXT_TITLE = 'plaintext task title that must never leak';

const createEncryptedOp = (clientId: string, id = 'op-1') => ({
  id,
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: VALID_ENVELOPE_B64,
  isPayloadEncrypted: true,
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
});

const createPlaintextOp = (clientId: string, id = 'op-plain') => ({
  ...createEncryptedOp(clientId, id),
  payload: { title: PLAINTEXT_TITLE },
  isPayloadEncrypted: false,
});

const createSnapshotRequest = (
  clientId: string,
  overrides: Record<string, unknown> = {},
) => ({
  state: VALID_ENVELOPE_B64,
  clientId,
  reason: 'initial',
  vectorClock: {},
  schemaVersion: 1,
  isPayloadEncrypted: true,
  ...overrides,
});

describe('encrypted-only upload gate (E2EE_REQUIRED)', () => {
  let app: FastifyInstance;
  const authToken = 'mock-token';
  const authHeaders = {
    authorization: `Bearer ${authToken}`,
    'content-type': 'application/json',
  };

  const injectOps = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: authHeaders,
      payload: payload as Record<string, unknown>,
    });

  const injectSnapshot = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: authHeaders,
      payload: payload as Record<string, unknown>,
    });

  const expectE2eeRejection = (response: {
    statusCode: number;
    body: string;
    json: () => { error?: string; errorCode?: string };
  }): void => {
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe(SYNC_ERROR_CODES.E2EE_REQUIRED);
    // The rejected payload value must never be echoed back.
    expect(response.body).not.toContain(PLAINTEXT_TITLE);
  };

  const expectNoSideEffects = (): void => {
    expect(mocks.syncService.uploadOps).not.toHaveBeenCalled();
    expect(mocks.syncService.checkOpsRequestDedup).not.toHaveBeenCalled();
    expect(mocks.syncService.checkSnapshotRequestDedup).not.toHaveBeenCalled();
    expect(mocks.syncService.cacheOpsRequestResults).not.toHaveBeenCalled();
    expect(mocks.syncService.cacheSnapshotRequestResult).not.toHaveBeenCalled();
    expect(mocks.syncService.checkStorageQuota).not.toHaveBeenCalled();
    expect(mocks.syncService.prepareSnapshotCache).not.toHaveBeenCalled();
    expect(mocks.syncService.cacheSnapshotIfReplayable).not.toHaveBeenCalled();
    // The snapshot pre-quota gate sits directly below the E2EE gate and both
    // reads and (via reconcile) writes storage state — pin that a rejected
    // upload never reaches it either.
    expect(mocks.syncService.getStorageInfo).not.toHaveBeenCalled();
    expect(mocks.syncService.updateStorageUsage).not.toHaveBeenCalled();
    expect(mocks.syncService.getCachedSnapshotBytes).not.toHaveBeenCalled();
    expect(mocks.notifyNewOps).not.toHaveBeenCalled();
  };

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
    mocks.syncService.uploadOps.mockResolvedValue([
      { opId: 'op-1', accepted: true, serverSeq: 1 },
    ]);
    mocks.syncService.cacheSnapshotIfReplayable.mockResolvedValue(null);
    mocks.syncService.prepareSnapshotCache.mockImplementation((state: unknown) => {
      const serialized = JSON.stringify(state);
      const data = zlib.gzipSync(serialized);
      return {
        data,
        bytes: data.length,
        stateBytes: Buffer.byteLength(serialized, 'utf8'),
        cacheable: false,
      };
    });
    mocks.syncService.updateStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({ ops: [], latestSeq: 1 });
    mocks.syncService.getStorageInfo.mockResolvedValue({
      storageUsedBytes: 0,
      storageQuotaBytes: 100 * 1024 * 1024,
    });
    mocks.syncService.getCachedSnapshotBytes.mockResolvedValue(0);
    mocks.prisma.operation.findFirst.mockResolvedValue(null);
    mocks.prisma.operation.findUnique.mockResolvedValue(null);
    mocks.prisma.operation.findMany.mockResolvedValue([]);

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('ops upload', () => {
    it('rejects a plaintext op (flag false, object payload) with no side effects', async () => {
      const clientId = 'plaintext-client';
      const response = await injectOps({ ops: [createPlaintextOp(clientId)], clientId });

      expectE2eeRejection(response);
      expectNoSideEffects();
    });

    it('rejects an op with a missing encryption flag', async () => {
      const clientId = 'missing-flag-client';
      const op = createEncryptedOp(clientId) as Record<string, unknown>;
      delete op.isPayloadEncrypted;

      expectE2eeRejection(await injectOps({ ops: [op], clientId }));
      expectNoSideEffects();
    });

    it('rejects a flagged op whose payload is not a string', async () => {
      const clientId = 'object-payload-client';
      const op = { ...createEncryptedOp(clientId), payload: { title: PLAINTEXT_TITLE } };

      expectE2eeRejection(await injectOps({ ops: [op], clientId }));
      expectNoSideEffects();
    });

    it('rejects a flagged op whose payload is a non-base64 string', async () => {
      const clientId = 'json-string-client';
      const op = {
        ...createEncryptedOp(clientId),
        payload: JSON.stringify({ title: PLAINTEXT_TITLE }),
      };

      expectE2eeRejection(await injectOps({ ops: [op], clientId }));
      expectNoSideEffects();
    });

    it('rejects a flagged op whose envelope is shorter than 28 bytes', async () => {
      const clientId = 'short-envelope-client';
      const op = { ...createEncryptedOp(clientId), payload: TOO_SHORT_ENVELOPE_B64 };

      expectE2eeRejection(await injectOps({ ops: [op], clientId }));
      expectNoSideEffects();
    });

    it('rejects the whole batch when one op among valid ones violates the gate', async () => {
      const clientId = 'mixed-batch-client';
      const response = await injectOps({
        ops: [
          createEncryptedOp(clientId, 'op-good-1'),
          createPlaintextOp(clientId, 'op-bad'),
          createEncryptedOp(clientId, 'op-good-2'),
        ],
        clientId,
      });

      expectE2eeRejection(response);
      expectNoSideEffects();
    });

    it('rejects a gzip-compressed plaintext upload (gate runs after decompression)', async () => {
      const clientId = 'gzip-plaintext-client';
      const body = await gzipAsync(
        Buffer.from(JSON.stringify({ ops: [createPlaintextOp(clientId)], clientId })),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        payload: body,
      });

      expectE2eeRejection(response);
      expectNoSideEffects();
    });

    it('accepts a batch of structurally valid encrypted ops', async () => {
      const clientId = 'encrypted-client';
      const response = await injectOps({ ops: [createEncryptedOp(clientId)], clientId });

      expect(response.statusCode).toBe(200);
      expect(response.json().results[0].accepted).toBe(true);
      expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    });
  });

  describe('snapshot upload', () => {
    it.each(['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] as const)(
      'rejects a plaintext %s snapshot with no side effects',
      async (snapshotOpType) => {
        const clientId = 'snapshot-plain-client';
        const response = await injectSnapshot(
          createSnapshotRequest(clientId, {
            state: { tasks: { ids: [], entities: {} }, note: PLAINTEXT_TITLE },
            isPayloadEncrypted: false,
            snapshotOpType,
            ...(snapshotOpType === 'REPAIR' ? { repairBaseServerSeq: 1 } : {}),
          }),
        );

        expectE2eeRejection(response);
        expectNoSideEffects();
      },
    );

    it('rejects a snapshot with a missing encryption flag', async () => {
      const clientId = 'snapshot-noflag-client';
      const request = createSnapshotRequest(clientId) as Record<string, unknown>;
      delete request.isPayloadEncrypted;

      expectE2eeRejection(await injectSnapshot(request));
      expectNoSideEffects();
    });

    it('rejects a flagged snapshot whose state is not ciphertext-shaped', async () => {
      const clientId = 'snapshot-badshape-client';
      const response = await injectSnapshot(
        createSnapshotRequest(clientId, {
          state: JSON.stringify({ note: PLAINTEXT_TITLE }),
        }),
      );

      expectE2eeRejection(response);
      expectNoSideEffects();
    });

    it('rejects before the request-dedup fingerprint is consulted', async () => {
      const clientId = 'snapshot-dedup-client';
      const response = await injectSnapshot(
        createSnapshotRequest(clientId, {
          isPayloadEncrypted: false,
          state: { note: PLAINTEXT_TITLE },
          requestId: '018f6d5a-0000-7000-8000-000000000001',
        }),
      );

      expectE2eeRejection(response);
      expect(mocks.syncService.checkSnapshotRequestDedup).not.toHaveBeenCalled();
    });

    it('accepts a structurally valid encrypted snapshot', async () => {
      const clientId = 'snapshot-encrypted-client';
      mocks.syncService.uploadOps.mockResolvedValue([
        { opId: 'snap-op', accepted: true, serverSeq: 2 },
      ]);

      const response = await injectSnapshot(createSnapshotRequest(clientId));

      expect(response.statusCode).toBe(200);
      expect(response.json().accepted).toBe(true);
      expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
    });
  });
});

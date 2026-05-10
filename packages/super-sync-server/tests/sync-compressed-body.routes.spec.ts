import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as zlib from 'zlib';
import { promisify } from 'util';

const mocks = vi.hoisted(() => {
  const syncService = {
    isRateLimited: vi.fn(),
    checkRequestDeduplication: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    cacheRequestResults: vi.fn(),
    updateStorageUsage: vi.fn(),
    getLatestSeq: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
  };

  return {
    syncService,
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

import { syncRoutes } from '../src/sync/sync.routes';

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

describe('Sync compressed body routes', () => {
  let app: FastifyInstance;
  const authToken = 'mock-token';

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.syncService.isRateLimited.mockReturnValue(false);
    mocks.syncService.checkRequestDeduplication.mockReturnValue(undefined);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: 100 * 1024 * 1024,
    });
    mocks.syncService.uploadOps.mockResolvedValue([{ accepted: true, serverSeq: 1 }]);
    mocks.syncService.updateStorageUsage.mockResolvedValue(undefined);
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [],
      latestSeq: 1,
    });

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept plain JSON ops upload', async () => {
    const clientId = 'plain-json-client';

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        ops: [createOp(clientId)],
        clientId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].accepted).toBe(true);
    expect(mocks.syncService.uploadOps).toHaveBeenCalledOnce();
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
});

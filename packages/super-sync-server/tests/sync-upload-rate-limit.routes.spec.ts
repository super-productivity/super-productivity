import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

const mocks = vi.hoisted(() => {
  const uploadCountsByUser = new Map<number, number>();
  const syncService = {
    isRateLimited: vi.fn(),
    checkOpsRequestDedup: vi.fn(),
    cacheOpsRequestResults: vi.fn(),
    checkStorageQuota: vi.fn(),
    uploadOps: vi.fn(),
    runWithStorageUsageLock: vi.fn(),
    getLatestSeq: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
  };

  return {
    syncService,
    uploadCountsByUser,
    notifyNewOps: vi.fn(),
    verifyToken: vi.fn(),
  };
});

vi.mock('../src/auth', () => ({
  verifyToken: mocks.verifyToken,
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

const CUSTOM_UPLOAD_LIMIT = 3;
const ROUTE_UPLOAD_LIMIT = 100;

const authTokenForUser = (userId: number): string => `user-${userId}-token`;

const createOp = (clientId: string, entityId: string) => ({
  id: `op-${entityId}`,
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId,
  payload: { title: 'Test Task' },
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
});

describe('Sync upload route rate limiting', () => {
  let app: FastifyInstance;
  let customUploadLimit: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.uploadCountsByUser.clear();
    customUploadLimit = CUSTOM_UPLOAD_LIMIT;
    mocks.verifyToken.mockImplementation(async (token: string) => {
      if (token === authTokenForUser(1)) {
        return { valid: true, userId: 1, email: 'user-1@test.com' };
      }
      if (token === authTokenForUser(2)) {
        return { valid: true, userId: 2, email: 'user-2@test.com' };
      }
      return { valid: false, reason: 'Invalid token' };
    });
    mocks.syncService.isRateLimited.mockImplementation((userId: number) => {
      const count = mocks.uploadCountsByUser.get(userId) ?? 0;
      if (count >= customUploadLimit) return true;
      mocks.uploadCountsByUser.set(userId, count + 1);
      return false;
    });
    mocks.syncService.checkOpsRequestDedup.mockReturnValue(null);
    mocks.syncService.checkStorageQuota.mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      quota: 100 * 1024 * 1024,
    });
    mocks.syncService.uploadOps.mockResolvedValue([{ accepted: true, serverSeq: 1 }]);
    mocks.syncService.runWithStorageUsageLock.mockImplementation(
      async (_userId: number, fn: () => Promise<unknown>) => fn(),
    );
    mocks.syncService.getLatestSeq.mockResolvedValue(1);
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [],
      latestSeq: 1,
    });

    app = Fastify();
    await app.register(rateLimit, {
      max: 500,
      timeWindow: '15 minutes',
    });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const uploadOp = async (userId: number, clientId: string, entityId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${authTokenForUser(userId)}` },
      payload: {
        ops: [createOp(clientId, entityId)],
        clientId,
      },
    });

  it('keeps the custom upload limiter scoped to the authenticated user under the Fastify limiter setup', async () => {
    for (let i = 0; i < CUSTOM_UPLOAD_LIMIT; i++) {
      const response = await uploadOp(1, 'user-1-client', `user-1-task-${i}`);

      expect(response.statusCode).toBe(200);
    }

    const otherUserResponse = await uploadOp(2, 'user-2-client', 'user-2-task-1');

    expect(otherUserResponse.statusCode).toBe(200);

    const limitedResponse = await uploadOp(1, 'user-1-client', 'user-1-task-limited');

    expect(limitedResponse.statusCode).toBe(429);
    expect(limitedResponse.json()).toMatchObject({
      error: 'Rate limited',
      errorCode: 'RATE_LIMITED',
    });
  });

  it('keeps the route-level upload limiter as a shared per-IP backstop', async () => {
    customUploadLimit = Number.POSITIVE_INFINITY;

    for (let i = 0; i < ROUTE_UPLOAD_LIMIT; i++) {
      const response = await uploadOp(1, 'user-1-client', `route-limit-task-${i}`);

      expect(response.statusCode).toBe(200);
    }

    const limitedResponse = await uploadOp(2, 'user-2-client', 'route-limit-blocked');

    expect(limitedResponse.statusCode).toBe(429);
  });
});

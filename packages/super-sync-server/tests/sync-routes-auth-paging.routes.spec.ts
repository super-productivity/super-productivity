import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

/**
 * Route-level coverage the legacy sync.routes.spec.ts (excluded since
 * 2025-12-21, deleted) used to give: every `/api/sync/*` route sits behind the
 * `authenticate` preHandler, and `GET /ops` pages with `limit + 1` / `hasMore`.
 * middleware.spec.ts covers `authenticate` itself; this pins the wiring.
 */

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  syncService: {
    touchDevice: vi.fn(),
    getOpsSinceWithSeq: vi.fn(),
  },
}));

vi.mock('../src/auth', () => ({ verifyToken: mocks.verifyToken }));

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => mocks.syncService,
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ notifyNewOps: vi.fn() }),
}));

vi.mock('../src/db', () => ({ prisma: {} }));

import { syncRoutes } from '../src/sync/sync.routes';

const SYNC_ROUTES: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string }> = [
  { method: 'POST', url: '/api/sync/ops' },
  { method: 'GET', url: '/api/sync/ops?sinceSeq=0' },
  { method: 'POST', url: '/api/sync/snapshot' },
  { method: 'GET', url: '/api/sync/status' },
  { method: 'GET', url: '/api/sync/devices' },
  { method: 'DELETE', url: '/api/sync/data' },
  { method: 'GET', url: '/api/sync/restore-points' },
  { method: 'GET', url: '/api/sync/restore/1' },
];

const op = (serverSeq: number): Record<string, unknown> => ({
  serverSeq,
  receivedAt: 0,
  op: { id: `op-${serverSeq}` },
});

describe('sync routes: authentication wiring and download paging', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.verifyToken.mockImplementation(async (token: string) =>
      token === 'good-token'
        ? { valid: true, userId: 1, email: 'test@test.com', tokenVersion: 0 }
        : { valid: false, reason: 'Invalid token' },
    );
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  for (const { method, url } of SYNC_ROUTES) {
    it(`rejects ${method} ${url} without a token`, async () => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    });

    it(`rejects ${method} ${url} with an invalid token`, async () => {
      const response = await app.inject({
        method,
        url,
        headers: { authorization: 'Bearer forged-token' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Invalid token' });
      expect(mocks.verifyToken).toHaveBeenCalledWith('forged-token');
    });
  }

  const download = (query: string) =>
    app.inject({
      method: 'GET',
      url: `/api/sync/ops?${query}`,
      headers: { authorization: 'Bearer good-token' },
    });

  it('asks for one op beyond the limit and reports hasMore when it arrives', async () => {
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [op(1), op(2), op(3)],
      latestSeq: 3,
    });

    const response = await download('sinceSeq=0&limit=2');

    expect(response.statusCode).toBe(200);
    expect(mocks.syncService.getOpsSinceWithSeq).toHaveBeenCalledWith(1, 0, undefined, 3);
    const body = response.json();
    expect(body.hasMore).toBe(true);
    expect(body.ops.map((o: { serverSeq: number }) => o.serverSeq)).toEqual([1, 2]);
    expect(body.latestSeq).toBe(3);
  });

  it('reports no more ops when the extra one does not arrive', async () => {
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({
      ops: [op(1), op(2)],
      latestSeq: 2,
    });

    const body = (await download('sinceSeq=0&limit=2')).json();

    expect(body.hasMore).toBe(false);
    expect(body.ops).toHaveLength(2);
  });

  it('defaults the page to 500 ops', async () => {
    mocks.syncService.getOpsSinceWithSeq.mockResolvedValue({ ops: [], latestSeq: 0 });

    await download('sinceSeq=5');

    expect(mocks.syncService.getOpsSinceWithSeq).toHaveBeenCalledWith(
      1,
      5,
      undefined,
      501,
    );
  });

  it('refuses a page above 1000 ops or a missing cursor', async () => {
    expect((await download('sinceSeq=0&limit=1001')).statusCode).toBe(400);
    expect((await download('limit=10')).statusCode).toBe(400);
    expect(mocks.syncService.getOpsSinceWithSeq).not.toHaveBeenCalled();
  });
});

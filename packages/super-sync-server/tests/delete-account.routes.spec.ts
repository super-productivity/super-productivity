import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  userDelete: vi.fn(),
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: mocks.closeForUser }),
}));

// The global setup.ts prisma mock exposes only user.findUnique/update — this
// route's cascade call (user.delete) is not on it, so redeclare the surface.
vi.mock('../src/db', () => ({
  prisma: {
    user: { delete: (...args: unknown[]) => mocks.userDelete(...args) },
  },
}));

import { apiRoutes } from '../src/api';

/**
 * `DELETE /api/account` cascades away the user's sync_devices rows, but an open
 * websocket keeps answering pings, so the dead-connection branch never reaps
 * it. Since #9598 that socket's heartbeat touch re-INSERTs a device row every
 * throttle window, tripping sync_devices_user_id_fkey against a user that no
 * longer exists. The route must close the user's sockets, and must do it after
 * the delete so no reconnect can re-authenticate and re-orphan one.
 */
describe('DELETE /api/account (socket teardown)', () => {
  let app: FastifyInstance;

  const inject = () =>
    app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: 'Bearer some-token' },
    });

  beforeEach(async () => {
    mocks.closeForUser.mockClear();
    mocks.userDelete.mockClear().mockResolvedValue({ id: 1 });
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('closes the deleted user’s websockets', async () => {
    const res = await inject();

    expect(res.statusCode).toBe(200);
    expect(mocks.closeForUser).toHaveBeenCalledWith(1);
  });

  it('closes them after the cascade, not before', async () => {
    await inject();

    expect(mocks.userDelete).toHaveBeenCalled();
    expect(mocks.closeForUser).toHaveBeenCalled();
    expect(mocks.closeForUser.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.userDelete.mock.invocationCallOrder[0],
    );
  });

  it('leaves sockets open when the delete fails', async () => {
    mocks.userDelete.mockRejectedValue(new Error('db down'));

    const res = await inject();

    expect(res.statusCode).toBe(500);
    expect(mocks.closeForUser).not.toHaveBeenCalled();
  });
});

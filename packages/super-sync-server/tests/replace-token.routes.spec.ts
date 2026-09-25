import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  closeForUser: vi.fn(),
  replaceToken: vi.fn(),
}));

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: mocks.closeForUser }),
}));

// The global setup.ts mock of '../src/auth' lacks `replaceToken` (this
// route's service call) — redeclare the module surface with it included.
vi.mock('../src/auth', () => ({
  verifyToken: vi
    .fn()
    .mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
  VERIFICATION_TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000,
  MAX_VERIFICATION_RESEND_COUNT: 20,
  verifyEmail: vi.fn().mockResolvedValue(true),
  replaceToken: (...args: unknown[]) => mocks.replaceToken(...args),
}));

import { apiRoutes } from '../src/api';

/**
 * Wire-format coverage for `POST /api/replace-token` on a real Fastify
 * instance. The app client always sends an explicit JSON body ('{}' or
 * {clientId}): Fastify rejects a body-less POST carrying
 * `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY), and this
 * route — unlike /api/sync/* — has no empty-body-tolerant parser. Mocked
 * transports (fetchMock, header-less inject) cannot see that, so these tests
 * exercise the real body parser.
 */
describe('POST /api/replace-token (route wiring)', () => {
  let app: FastifyInstance;

  const inject = (opts: { payload?: string }) =>
    app.inject({
      method: 'POST',
      url: '/api/replace-token',
      headers: {
        authorization: 'Bearer some-token',
        'content-type': 'application/json',
      },
      ...(opts.payload === undefined ? {} : { payload: opts.payload }),
    });

  beforeEach(async () => {
    mocks.replaceToken.mockResolvedValue({
      token: 'fresh-token',
      user: { id: 1, email: 'test@test.com' },
    });
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts the client wire format: JSON content type with "{}" body', async () => {
    const response = await inject({ payload: '{}' });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBe('fresh-token');
    expect(mocks.closeForUser).toHaveBeenCalledWith(1);
  });

  it('rejects a body-less JSON POST (why the client must send "{}")', async () => {
    const response = await inject({});

    expect(response.statusCode).toBe(400);
    expect(mocks.replaceToken).not.toHaveBeenCalled();
  });

  it('ignores a clientId in the body (legacy clients sent one) and closes all sockets', async () => {
    // A clientId is self-declared and unauthenticated — honoring it as a
    // close exemption would let a stolen-token client spare its own socket.
    const response = await inject({
      payload: JSON.stringify({ clientId: 'E_caller11' }),
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.closeForUser).toHaveBeenCalledWith(1);
  });
});

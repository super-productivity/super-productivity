import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'crypto';

const TEST_JWT_SECRET = 'test-secret-key-that-is-long-enough-for-testing-purposes-1234';

// Mock authenticate to set req.user (simulates successful auth by default)
const mockAuthenticate = vi.fn();
const mockGetAuthUser = vi.fn();

vi.mock('../src/middleware', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
}));

vi.mock('../src/auth', () => ({
  getJwtSecret: () => TEST_JWT_SECRET,
  verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
  verifyEmail: vi.fn(),
  replaceToken: vi.fn(),
  requestLoginMagicLink: vi.fn(),
  verifyLoginMagicLink: vi.fn(),
  JWT_EXPIRY: '365d',
}));

vi.mock('../src/passkey', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
  requestPasskeyRecovery: vi.fn(),
  getRecoveryRegistrationOptions: vi.fn(),
  completePasskeyRecovery: vi.fn(),
}));

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    audit: vi.fn(),
  },
}));

vi.mock('../src/db', () => ({
  prisma: {
    user: { delete: vi.fn() },
  },
}));

import { apiRoutes } from '../src/api';

describe('/user/encryption-key', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: authenticate succeeds and sets req.user
    mockAuthenticate.mockImplementation(async (req: { user?: unknown }) => {
      req.user = { userId: 1, email: 'test@test.com' };
    });

    mockGetAuthUser.mockImplementation(
      (req: { user?: { userId: number; email: string } }) => {
        if (!req.user) throw new Error('User not authenticated');
        return req.user;
      },
    );

    fastify = Fastify();
    await fastify.register(apiRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('should return a valid base64 encryption key for authenticated user', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.encryptionKey).toBeDefined();
    expect(typeof body.encryptionKey).toBe('string');
    // Verify it's valid base64 by decoding and checking length
    const decoded = Buffer.from(body.encryptionKey, 'base64');
    // SHA-256 produces 32 bytes
    expect(decoded.length).toBe(32);
  });

  it('should return 401 for unauthenticated request', async () => {
    // Override authenticate to reject the request
    mockAuthenticate.mockImplementation(
      async (
        _req: unknown,
        reply: { code: (n: number) => { send: (b: unknown) => void } },
      ) => {
        return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      },
    );

    const response = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return deterministic key for the same user', async () => {
    const response1 = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer valid-token' },
    });

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer valid-token' },
    });

    const key1 = JSON.parse(response1.body).encryptionKey;
    const key2 = JSON.parse(response2.body).encryptionKey;

    expect(key1).toBe(key2);
  });

  it('should return different keys for different users', async () => {
    // First request as user 1
    const response1 = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer token-user1' },
    });

    // Change mock to return user 2
    mockAuthenticate.mockImplementation(async (req: { user?: unknown }) => {
      req.user = { userId: 2, email: 'user2@test.com' };
    });
    mockGetAuthUser.mockImplementation(
      (req: { user?: { userId: number; email: string } }) => {
        if (!req.user) throw new Error('User not authenticated');
        return req.user;
      },
    );

    const response2 = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer token-user2' },
    });

    const key1 = JSON.parse(response1.body).encryptionKey;
    const key2 = JSON.parse(response2.body).encryptionKey;

    expect(key1).not.toBe(key2);
  });

  it('should derive key via HMAC-SHA256 matching expected value', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer valid-token' },
    });

    const body = JSON.parse(response.body);

    // Compute expected key using the same algorithm
    const expectedKey = createHmac('sha256', TEST_JWT_SECRET)
      .update('sp-auto-encrypt:1')
      .digest('base64');

    expect(body.encryptionKey).toBe(expectedKey);
  });

  it('should return 500 when key derivation fails', async () => {
    // Override getAuthUser to throw, simulating an internal error
    mockGetAuthUser.mockImplementation(() => {
      throw new Error('Unexpected internal error');
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/user/encryption-key',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Failed to derive encryption key. Please try again.');
  });
});

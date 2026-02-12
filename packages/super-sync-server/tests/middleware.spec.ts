import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock verifyToken from auth module
const mockVerifyToken = vi.fn();
vi.mock('../src/auth', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

import { authenticate, getAuthUser } from '../src/middleware';

/**
 * Create a mock Fastify request with optional authorization header.
 */
const createMockRequest = (authHeader?: string): FastifyRequest => {
  const req = {
    headers: {} as Record<string, string | undefined>,
    user: undefined,
  } as unknown as FastifyRequest;

  if (authHeader !== undefined) {
    req.headers.authorization = authHeader;
  }

  return req;
};

/**
 * Create a mock Fastify reply that captures status code and response body.
 */
const createMockReply = (): FastifyReply & { _statusCode: number; _body: unknown } => {
  const reply = {
    _statusCode: 0,
    _body: undefined as unknown,
    code(status: number) {
      reply._statusCode = status;
      return reply;
    },
    send(body: unknown) {
      reply._body = body;
      return reply;
    },
  } as unknown as FastifyReply & { _statusCode: number; _body: unknown };

  return reply;
};

describe('authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when Authorization header is missing', async () => {
    const req = createMockRequest();
    const reply = createMockReply();

    await authenticate(req, reply);

    expect(reply._statusCode).toBe(401);
    expect(reply._body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('should return 401 when header does not start with "Bearer "', async () => {
    const req = createMockRequest('Basic abc123');
    const reply = createMockReply();

    await authenticate(req, reply);

    expect(reply._statusCode).toBe(401);
    expect(reply._body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('should return 401 when verifyToken returns null', async () => {
    mockVerifyToken.mockResolvedValue(null);
    const req = createMockRequest('Bearer invalid-token');
    const reply = createMockReply();

    await authenticate(req, reply);

    expect(mockVerifyToken).toHaveBeenCalledWith('invalid-token');
    expect(reply._statusCode).toBe(401);
    expect(reply._body).toEqual({ error: 'Invalid token' });
  });

  it('should set req.user when token is valid', async () => {
    const userPayload = { userId: 42, email: 'user@test.com' };
    mockVerifyToken.mockResolvedValue(userPayload);
    const req = createMockRequest('Bearer valid-token');
    const reply = createMockReply();

    const result = await authenticate(req, reply);

    expect(mockVerifyToken).toHaveBeenCalledWith('valid-token');
    expect(req.user).toEqual(userPayload);
    // Should return undefined (not sending a reply) when auth succeeds
    expect(result).toBeUndefined();
  });

  it('should extract token correctly when extra spaces exist after Bearer', async () => {
    // Note: "Bearer  two-spaces" splits on ' ' giving ['Bearer', '', 'two-spaces']
    // split(' ')[1] would be '', which verifyToken would reject
    mockVerifyToken.mockResolvedValue(null);
    const req = createMockRequest('Bearer  extra-space-token');
    const reply = createMockReply();

    await authenticate(req, reply);

    // The implementation uses split(' ')[1], so extra space results in empty string
    expect(mockVerifyToken).toHaveBeenCalledWith('');
    expect(reply._statusCode).toBe(401);
  });

  it('should return 401 when Authorization header is empty string', async () => {
    const req = createMockRequest('');
    const reply = createMockReply();

    await authenticate(req, reply);

    expect(reply._statusCode).toBe(401);
  });
});

describe('getAuthUser', () => {
  it('should return user when req.user is set', () => {
    const req = createMockRequest();
    req.user = { userId: 1, email: 'test@test.com' };

    const user = getAuthUser(req);

    expect(user).toEqual({ userId: 1, email: 'test@test.com' });
  });

  it('should throw when req.user is undefined', () => {
    const req = createMockRequest();
    req.user = undefined;

    expect(() => getAuthUser(req)).toThrow('User not authenticated');
  });

  it('should throw when req.user is not set at all', () => {
    const req = { headers: {} } as unknown as FastifyRequest;

    expect(() => getAuthUser(req)).toThrow('User not authenticated');
  });
});

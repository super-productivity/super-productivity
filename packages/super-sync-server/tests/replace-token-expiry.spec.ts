import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock (both are hoisted, but vi.hoisted first)
const jwtSignSpy = vi.hoisted(() => {
  // Must set JWT_SECRET before auth.ts loads (getJwtSecret runs at module scope)
  process.env.JWT_SECRET = 'a'.repeat(32);
  return vi.fn().mockReturnValue('mock-jwt-token');
});

// The global setup.ts mocks '../src/auth' with only verifyToken.
// We need the real replaceToken, so override with importOriginal.
vi.mock('../src/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Keep verifyToken mocked (from setup.ts pattern)
    verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
  };
});

// Spy on jwt.sign to capture its arguments
vi.mock('jsonwebtoken', () => ({
  sign: (...args: unknown[]) => jwtSignSpy(...args),
  verify: vi.fn(),
}));

// Mock logger to suppress output
vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { replaceToken, JWT_EXPIRY_PASSKEY, JWT_EXPIRY_MAGIC_LINK } from '../src/auth';
import { prisma } from '../src/db';

describe('replaceToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: $transaction calls the callback with a mock tx
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockResolvedValue({ tokenVersion: 5 }),
          },
        };
        return cb(tx);
      },
    );
  });

  it('should use JWT_EXPIRY_PASSKEY (7d), not JWT_EXPIRY_MAGIC_LINK (365d)', async () => {
    await replaceToken(1, 'user@example.com');

    expect(jwtSignSpy).toHaveBeenCalledTimes(1);
    const [, , options] = jwtSignSpy.mock.calls[0];
    expect(options.expiresIn).toBe(JWT_EXPIRY_PASSKEY);
    expect(options.expiresIn).toBe('7d');
    expect(options.expiresIn).not.toBe(JWT_EXPIRY_MAGIC_LINK);
  });

  it('should include incremented tokenVersion in JWT payload', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockResolvedValue({ tokenVersion: 42 }),
          },
        };
        return cb(tx);
      },
    );

    await replaceToken(1, 'user@example.com');

    expect(jwtSignSpy).toHaveBeenCalledTimes(1);
    const [payload] = jwtSignSpy.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        userId: 1,
        email: 'user@example.com',
        tokenVersion: 42,
      }),
    );
  });

  it('should return the correct user info and token', async () => {
    const result = await replaceToken(7, 'test@test.com');

    expect(result).toEqual({
      token: 'mock-jwt-token',
      user: { id: 7, email: 'test@test.com' },
    });
  });

  it('should increment tokenVersion via transaction', async () => {
    let capturedUpdateArgs: unknown = null;
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            update: vi.fn().mockImplementation(async (args: unknown) => {
              capturedUpdateArgs = args;
              return { tokenVersion: 10 };
            }),
          },
        };
        return cb(tx);
      },
    );

    await replaceToken(3, 'user@example.com');

    expect(capturedUpdateArgs).toEqual(
      expect.objectContaining({
        where: { id: 3 },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      }),
    );
  });
});

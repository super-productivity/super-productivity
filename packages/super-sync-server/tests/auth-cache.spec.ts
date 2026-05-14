import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwt from 'jsonwebtoken';

const jwtSecret = vi.hoisted(() => {
  const secret = 'a'.repeat(32);
  process.env.JWT_SECRET = secret;
  return secret;
});

vi.mock('../src/auth', async (importOriginal) => {
  return await importOriginal();
});

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { verifyToken, revokeAllTokens } from '../src/auth';
import { authCache } from '../src/auth-cache';
import { prisma } from '../src/db';

const createToken = (tokenVersion: number = 0): string =>
  jwt.sign({ userId: 1, email: 'user@example.com', tokenVersion }, jwtSecret, {
    expiresIn: '1h',
  });

describe('auth verification cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCache.clear();
  });

  it('should reuse a warm verified-token cache entry', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);

    const token = createToken();

    await expect(verifyToken(token)).resolves.toEqual({
      valid: true,
      userId: 1,
      email: 'user@example.com',
    });
    await expect(verifyToken(token)).resolves.toEqual({
      valid: true,
      userId: 1,
      email: 'user@example.com',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should fall through to the database on tokenVersion mismatch', async () => {
    authCache.set(1, 1, true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);

    await expect(verifyToken(createToken(0))).resolves.toEqual(
      expect.objectContaining({ valid: true }),
    );

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should invalidate the cache when revoking all tokens', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      tokenVersion: 0,
      isVerified: 1,
    } as any);
    const token = createToken();

    await verifyToken(token);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    await revokeAllTokens(1);

    vi.mocked(prisma.user.findUnique).mockClear();
    await verifyToken(token);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});

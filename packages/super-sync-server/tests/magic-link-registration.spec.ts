/**
 * Magic Link Registration Tests
 *
 * Tests for email-only registration (no passkey required).
 * Mirrors the passkey registration test patterns.
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';

// Must set JWT_SECRET before auth.ts is imported (top-level getJwtSecret() call).
// vi.hoisted runs before vi.mock factories, which are hoisted above normal code.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-validation';
});

// Mock prisma - use factory function to avoid hoisting issues
vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock email sending
vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendLoginMagicLinkEmail: vi.fn().mockResolvedValue(true),
}));

// Mock crypto.randomBytes for predictable tokens
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue(Buffer.from('test-token-1234567890'.repeat(3))),
  };
});

// Provide Prisma namespace with PrismaClientKnownRequestError for instanceof checks
vi.mock('@prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
  };
});

// Override the global setup.ts mock of ../src/auth — use the real module
// so we can test registerWithMagicLink with mocked dependencies
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

// Import mocked modules to get references
import { prisma } from '../src/db';
import { sendVerificationEmail } from '../src/email';
import { Prisma } from '@prisma/client';

// Import module under test
import { registerWithMagicLink } from '../src/auth';

describe('Magic Link Registration', () => {
  const testEmail = 'test@example.com';

  // Cast to access mock functions
  const mockPrisma = prisma as unknown as {
    user: {
      findUnique: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
      deleteMany: Mock;
    };
  };

  const mockSendVerificationEmail = sendVerificationEmail as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('New user registration', () => {
    it('should create a new user and send verification email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
      });

      const result = await registerWithMagicLink(testEmail, Date.now());

      expect(result.message).toContain('check your email');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: testEmail,
            passwordHash: null,
            verificationToken: expect.any(String),
            verificationTokenExpiresAt: expect.any(BigInt),
            termsAcceptedAt: expect.any(BigInt),
          }),
        }),
      );
      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        testEmail,
        expect.any(String),
      );
    });

    it('should normalize email to lowercase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        isVerified: 0,
      });

      await registerWithMagicLink('Test@Example.COM', Date.now());

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
          }),
        }),
      );
    });

    it('should use Date.now() for termsAcceptedAt when not provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
      });

      await registerWithMagicLink(testEmail);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            termsAcceptedAt: expect.any(BigInt),
          }),
        }),
      );
    });
  });

  describe('Existing user handling', () => {
    it('should reject registration for existing verified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
      });

      await expect(registerWithMagicLink(testEmail, Date.now())).rejects.toThrow(
        'An account with this email already exists',
      );

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockSendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should send email first, then update token for existing unverified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        verificationResendCount: 2,
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await registerWithMagicLink(testEmail, Date.now());

      expect(result.message).toContain('check your email');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      // Email sent before DB update to avoid invalidating old token on failure
      expect(mockSendVerificationEmail).toHaveBeenCalledWith(
        testEmail,
        expect.any(String),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            verificationToken: expect.any(String),
            verificationTokenExpiresAt: expect.any(BigInt),
            verificationResendCount: { increment: 1 },
          }),
        }),
      );
    });

    it('should reject when verification resend cap is reached', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        verificationResendCount: 20,
      });

      await expect(registerWithMagicLink(testEmail, Date.now())).rejects.toThrow(
        'Too many verification attempts',
      );

      expect(mockSendVerificationEmail).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('Email failure cleanup', () => {
    it('should delete newly created user when email sending fails', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // Initial lookup: no existing user
        .mockResolvedValueOnce({ id: 1, email: testEmail, isVerified: 0 }); // Cleanup lookup
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
      });
      mockSendVerificationEmail.mockResolvedValueOnce(false);
      mockPrisma.user.deleteMany.mockResolvedValue({ count: 1 });

      await expect(registerWithMagicLink(testEmail, Date.now())).rejects.toThrow(
        'Failed to send verification email',
      );

      expect(mockPrisma.user.deleteMany).toHaveBeenCalledWith({
        where: { email: testEmail, isVerified: 0 },
      });
    });

    it('should NOT delete or update pre-existing unverified user when email sending fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        verificationResendCount: 1,
      });
      mockSendVerificationEmail.mockResolvedValueOnce(false);

      await expect(registerWithMagicLink(testEmail, Date.now())).rejects.toThrow(
        'Failed to send verification email',
      );

      // Should NOT delete the pre-existing user
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      expect(mockPrisma.user.deleteMany).not.toHaveBeenCalled();
      // Should NOT have updated the token (email sent before DB update)
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('P2002 unique constraint handling', () => {
    it('should convert P2002 race condition to user-friendly error', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Use the mocked PrismaClientKnownRequestError so instanceof check matches
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002' },
      );
      mockPrisma.user.create.mockRejectedValue(prismaError);

      await expect(registerWithMagicLink(testEmail, Date.now())).rejects.toThrow(
        'An account with this email already exists',
      );
    });
  });
});

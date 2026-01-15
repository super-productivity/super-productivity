import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Mock auth module
vi.mock('../src/auth', () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  verifyEmail: vi.fn(),
  replaceToken: vi.fn(),
  verifyToken: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

// Mock middleware
vi.mock('../src/middleware', () => ({
  authenticate: vi.fn().mockImplementation(async () => {}),
  getAuthUser: vi.fn().mockReturnValue({ userId: 1, email: 'test@test.com' }),
}));

describe('Password Reset API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { apiRoutes } = await import('../src/api');

    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/forgot-password', () => {
    it('should accept valid email and return success message', async () => {
      const { requestPasswordReset } = await import('../src/auth');
      (requestPasswordReset as Mock).mockResolvedValue({
        message:
          'If an account with that email exists, a password reset link has been sent.',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/forgot-password',
        payload: { email: 'user@test.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toContain('If an account with that email exists');
      expect(requestPasswordReset).toHaveBeenCalledWith('user@test.com');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/forgot-password',
        payload: { email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/forgot-password',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 when email sending fails', async () => {
      const { requestPasswordReset } = await import('../src/auth');
      (requestPasswordReset as Mock).mockRejectedValue(
        new Error('Failed to send password reset email. Please try again later.'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/forgot-password',
        payload: { email: 'user@test.com' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe(
        'Failed to send password reset email. Please try again later.',
      );
    });

    it('should hide internal errors from client', async () => {
      const { requestPasswordReset } = await import('../src/auth');
      (requestPasswordReset as Mock).mockRejectedValue(
        new Error('Internal database error'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/forgot-password',
        payload: { email: 'user@test.com' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      // Should return generic message, not internal error
      expect(body.error).toBe('Password reset request failed. Please try again.');
    });
  });

  describe('POST /api/reset-password', () => {
    it('should reset password with valid token and new password', async () => {
      const { resetPassword } = await import('../src/auth');
      (resetPassword as Mock).mockResolvedValue({
        message:
          'Password has been reset successfully. Please log in with your new password.',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'valid-reset-token',
          password: 'newSecurePassword123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toContain('Password has been reset successfully');
      expect(resetPassword).toHaveBeenCalledWith(
        'valid-reset-token',
        'newSecurePassword123',
      );
    });

    it('should return 400 for password less than 12 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'valid-reset-token',
          password: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toContainEqual(
        expect.objectContaining({
          message: 'Password must be at least 12 characters long',
        }),
      );
    });

    it('should return 400 for missing token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          password: 'newSecurePassword123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'valid-reset-token',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid/expired token', async () => {
      const { resetPassword } = await import('../src/auth');
      (resetPassword as Mock).mockRejectedValue(
        new Error('Invalid or expired reset token'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'invalid-or-expired-token',
          password: 'newSecurePassword123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Invalid or expired reset token');
    });

    it('should hide internal errors from client', async () => {
      const { resetPassword } = await import('../src/auth');
      (resetPassword as Mock).mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'valid-reset-token',
          password: 'newSecurePassword123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      // Should return generic message, not internal error
      expect(body.error).toBe('Password reset failed. Please try again.');
    });

    it('should accept exactly 12 character password', async () => {
      const { resetPassword } = await import('../src/auth');
      (resetPassword as Mock).mockResolvedValue({
        message: 'Password has been reset successfully.',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/reset-password',
        payload: {
          token: 'valid-reset-token',
          password: '123456789012', // Exactly 12 characters
        },
      });

      expect(response.statusCode).toBe(200);
      expect(resetPassword).toHaveBeenCalled();
    });
  });
});

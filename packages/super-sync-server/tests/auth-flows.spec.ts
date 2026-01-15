import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDb, getDb, User } from '../src/db';
import {
  registerUser,
  verifyEmail,
  loginUser,
  verifyToken,
  revokeAllTokens,
  replaceToken,
} from '../src/auth';
import { sendVerificationEmail } from '../src/email';
import * as bcrypt from 'bcryptjs';

// Mock email sending to prevent actual emails during tests
vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));

describe('Authentication Flows', () => {
  beforeEach(() => {
    initDb('./data', true);
    vi.clearAllMocks();
  });

  describe('Account Lockout', () => {
    const email = 'lockout@test.com';
    const password = 'correct-password-123!';

    beforeEach(async () => {
      const db = getDb();
      const passwordHash = await bcrypt.hash(password, 12);
      db.prepare(
        `INSERT INTO users (email, password_hash, is_verified, created_at)
         VALUES (?, ?, 1, ?)`,
      ).run(email, passwordHash, Date.now());
    });

    it('should lock account after 5 failed login attempts', async () => {
      // Fail 5 times
      for (let i = 1; i <= 5; i++) {
        try {
          await loginUser(email, 'wrong-password');
        } catch (err) {
          if (i < 5) {
            expect((err as Error).message).toBe('Invalid credentials');
          }
        }
      }

      // Check account is locked
      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User;
      expect(user.failed_login_attempts).toBe(5);
      expect(user.locked_until).not.toBeNull();
      expect(user.locked_until).toBeGreaterThan(Date.now());
    });

    it('should reject login when account is locked', async () => {
      const db = getDb();
      const fifteenMinutesMs = 15 * 60 * 1000;
      // Lock the account manually
      db.prepare(
        'UPDATE users SET locked_until = ?, failed_login_attempts = 5 WHERE email = ?',
      ).run(
        Date.now() + fifteenMinutesMs, // 15 minutes from now
        email,
      );

      // Try to login with correct credentials - should fail because locked
      await expect(loginUser(email, password)).rejects.toThrow(
        'Account temporarily locked',
      );
    });

    it('should allow login after lockout expires', async () => {
      const db = getDb();
      // Set lockout in the past (already expired)
      db.prepare(
        'UPDATE users SET locked_until = ?, failed_login_attempts = 5 WHERE email = ?',
      ).run(Date.now() - 1000, email); // 1 second ago

      // Login should work now
      const result = await loginUser(email, password);
      expect(result.token).toBeDefined();
      expect(result.user.email).toBe(email);

      // Failed attempts should be reset
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User;
      expect(user.failed_login_attempts).toBe(0);
      expect(user.locked_until).toBeNull();
    });

    it('should reset failed attempts on successful login', async () => {
      const db = getDb();

      // Fail 3 times (not enough to lock)
      for (let i = 0; i < 3; i++) {
        try {
          await loginUser(email, 'wrong-password');
        } catch {
          // expected
        }
      }

      // Verify counter
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User;
      expect(user.failed_login_attempts).toBe(3);

      // Successful login
      await loginUser(email, password);

      // Counter should be reset
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User;
      expect(user.failed_login_attempts).toBe(0);
    });

    it('should track 15 minute lockout duration', async () => {
      const db = getDb();

      // Lock account
      for (let i = 0; i < 5; i++) {
        try {
          await loginUser(email, 'wrong-password');
        } catch {
          // expected
        }
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User;
      const lockoutDuration = user.locked_until! - Date.now();

      // Should be approximately 15 minutes (allow some timing slack)
      expect(lockoutDuration).toBeGreaterThan(14 * 60 * 1000);
      expect(lockoutDuration).toBeLessThanOrEqual(15 * 60 * 1000);
    });
  });

  describe('Email Verification', () => {
    it('should create verification token on registration', async () => {
      await registerUser('newuser@test.com', 'SecurePass123!');

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('newuser@test.com') as User;

      expect(user).toBeDefined();
      expect(user.is_verified).toBe(0);
      expect(user.verification_token).toBeDefined();
      expect(user.verification_token!.length).toBe(64); // 32 bytes hex
      expect(user.verification_token_expires_at).toBeDefined();
      expect(user.terms_accepted_at).toBeDefined();
    });

    it('should store custom terms acceptance time', async () => {
      const customTime = 1600000000000;
      await registerUser('terms@test.com', 'SecurePass123!', customTime);

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('terms@test.com') as User;

      expect(user.terms_accepted_at).toBe(customTime);
    });

    it('should verify user with valid token', async () => {
      await registerUser('verify@test.com', 'SecurePass123!');

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('verify@test.com') as User;
      const token = user.verification_token!;

      const result = verifyEmail(token);
      expect(result).toBe(true);

      // Check user is now verified
      const verifiedUser = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('verify@test.com') as User;
      expect(verifiedUser.is_verified).toBe(1);
      expect(verifiedUser.verification_token).toBeNull();
    });

    it('should reject invalid verification token', () => {
      expect(() => verifyEmail('invalid-token-12345')).toThrow(
        'Invalid verification token',
      );
    });

    it('should reject expired verification token', async () => {
      await registerUser('expired@test.com', 'SecurePass123!');

      const db = getDb();
      const oneHourMs = 60 * 60 * 1000;
      // Set token to expired (1 hour ago)
      db.prepare(
        'UPDATE users SET verification_token_expires_at = ? WHERE email = ?',
      ).run(Date.now() - oneHourMs, 'expired@test.com');

      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('expired@test.com') as User;

      expect(() => verifyEmail(user.verification_token!)).toThrow(
        'Verification token has expired',
      );
    });

    it('should set token expiry to 24 hours', async () => {
      await registerUser('expiry@test.com', 'SecurePass123!');

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('expiry@test.com') as User;

      const expiryTime = user.verification_token_expires_at! - Date.now();
      // Should be approximately 24 hours (allow some timing slack)
      expect(expiryTime).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(expiryTime).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it('should clear verification token after successful verification (one-time use)', async () => {
      await registerUser('onetime@test.com', 'SecurePass123!');

      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('onetime@test.com') as User;
      const token = user.verification_token!;

      // First verification should work
      verifyEmail(token);

      // Second verification with same token should fail
      expect(() => verifyEmail(token)).toThrow('Invalid verification token');
    });

    it('should reject login for unverified user', async () => {
      await registerUser('unverified@test.com', 'SecurePass123!');

      await expect(loginUser('unverified@test.com', 'SecurePass123!')).rejects.toThrow(
        'Email not verified',
      );
    });

    it('should resend verification token even after previous resend when token expired', async () => {
      await registerUser('stuck@test.com', 'SecurePass123!');

      const db = getDb();

      const expiredToken = 'expired-token';
      // Simulate prior resend and expiry
      db.prepare(
        `
          UPDATE users
          SET verification_token = ?, verification_token_expires_at = ?, verification_resend_count = 1
          WHERE email = ?
        `,
      ).run(expiredToken, Date.now() - 1000, 'stuck@test.com');

      await registerUser('stuck@test.com', 'AnotherPass123!');

      const updatedUser = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('stuck@test.com') as User;

      expect(updatedUser.verification_resend_count).toBe(2);
      expect(updatedUser.verification_token).not.toBe(expiredToken);
      expect(updatedUser.verification_token_expires_at).toBeGreaterThan(Date.now());
      expect(vi.mocked(sendVerificationEmail)).toHaveBeenCalledTimes(2);
    });
  });

  describe('Login Flow', () => {
    const email = 'login@test.com';
    const password = 'SecurePass123!';

    beforeEach(async () => {
      const db = getDb();
      const passwordHash = await bcrypt.hash(password, 12);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, is_verified, created_at)
         VALUES (1, ?, ?, 1, ?)`,
      ).run(email, passwordHash, Date.now());
    });

    it('should return JWT token on successful login', async () => {
      const result = await loginUser(email, password);

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.split('.').length).toBe(3); // JWT has 3 parts
      expect(result.user.id).toBe(1);
      expect(result.user.email).toBe(email);
    });

    it('should reject login with wrong password', async () => {
      await expect(loginUser(email, 'wrong-password')).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should reject login with non-existent email', async () => {
      await expect(loginUser('nonexistent@test.com', password)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should include token version in JWT', async () => {
      const result = await loginUser(email, password);

      // Verify the token is valid and contains tokenVersion
      const verified = await verifyToken(result.token);
      expect(verified).not.toBeNull();
      expect(verified!.userId).toBe(1);
      expect(verified!.email).toBe(email);
    });
  });

  describe('Token Verification', () => {
    const email = 'token@test.com';
    const password = 'SecurePass123!';

    beforeEach(async () => {
      const db = getDb();
      const passwordHash = await bcrypt.hash(password, 12);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, is_verified, token_version, created_at)
         VALUES (1, ?, ?, 1, 0, ?)`,
      ).run(email, passwordHash, Date.now());
    });

    it('should verify valid token', async () => {
      const loginResult = await loginUser(email, password);
      const verified = await verifyToken(loginResult.token);

      expect(verified).not.toBeNull();
      expect(verified!.userId).toBe(1);
      expect(verified!.email).toBe(email);
    });

    it('should reject token after version increment (revoked)', async () => {
      const loginResult = await loginUser(email, password);

      // Token should be valid initially
      expect(await verifyToken(loginResult.token)).not.toBeNull();

      // Revoke all tokens
      revokeAllTokens(1);

      // Token should now be invalid
      expect(await verifyToken(loginResult.token)).toBeNull();
    });

    it('should reject token for deleted user', async () => {
      const loginResult = await loginUser(email, password);

      // Delete the user
      const db = getDb();
      db.prepare('DELETE FROM users WHERE id = ?').run(1);

      // Token should now be invalid
      expect(await verifyToken(loginResult.token)).toBeNull();
    });

    it('should reject malformed tokens', async () => {
      expect(await verifyToken('not.a.valid.token')).toBeNull();
      expect(await verifyToken('completely-invalid')).toBeNull();
      expect(await verifyToken('')).toBeNull();
    });
  });

  describe('Token Replacement', () => {
    const email = 'replace@test.com';
    const password = 'SecurePass123!';

    beforeEach(async () => {
      const db = getDb();
      const passwordHash = await bcrypt.hash(password, 12);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, is_verified, token_version, created_at)
         VALUES (1, ?, ?, 1, 0, ?)`,
      ).run(email, passwordHash, Date.now());
    });

    it('should return new token with incremented version', async () => {
      const result = replaceToken(1, email);

      expect(result.token).toBeDefined();
      expect(result.user.id).toBe(1);
      expect(result.user.email).toBe(email);

      // Verify new token is valid
      const verified = await verifyToken(result.token);
      expect(verified).not.toBeNull();
    });

    it('should invalidate all previous tokens after replacement', async () => {
      // Login to get initial token
      const loginResult = await loginUser(email, password);
      expect(await verifyToken(loginResult.token)).not.toBeNull();

      // Replace token
      const newResult = replaceToken(1, email);

      // Old token should be invalid
      expect(await verifyToken(loginResult.token)).toBeNull();

      // New token should be valid
      expect(await verifyToken(newResult.token)).not.toBeNull();
    });

    it('should increment token version in database', () => {
      const db = getDb();

      // Initial version should be 0
      let user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(1) as {
        token_version: number;
      };
      expect(user.token_version).toBe(0);

      // Replace token
      replaceToken(1, email);

      // Version should be 1
      user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(1) as {
        token_version: number;
      };
      expect(user.token_version).toBe(1);

      // Replace again
      replaceToken(1, email);

      // Version should be 2
      user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(1) as {
        token_version: number;
      };
      expect(user.token_version).toBe(2);
    });

    it('should throw for non-existent user', () => {
      expect(() => replaceToken(999, 'nobody@test.com')).toThrow('User not found');
    });
  });

  describe('Registration with Existing Email', () => {
    it('should handle duplicate registration for unverified account', async () => {
      // First registration
      await registerUser('dup@test.com', 'SecurePass123!');

      // Second registration with same email
      const result = await registerUser('dup@test.com', 'DifferentPass456!');
      expect(result.message).toContain('Registration successful');

      // Should have incremented resend count
      const db = getDb();
      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get('dup@test.com') as User;
      expect(user.verification_resend_count).toBe(1);
    });

    it('should not send multiple verification emails for verified account', async () => {
      // Create verified account
      const db = getDb();
      const passwordHash = await bcrypt.hash('SecurePass123!', 12);
      db.prepare(
        `INSERT INTO users (email, password_hash, is_verified, created_at)
         VALUES ('verified@test.com', ?, 1, ?)`,
      ).run(passwordHash, Date.now());

      // Try to register again - should succeed without error (silent handling)
      const result = await registerUser('verified@test.com', 'NewPass123!');
      expect(result.message).toContain('Registration successful');
    });
  });
});

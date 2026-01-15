/**
 * Passkey Authentication Tests
 *
 * Tests for WebAuthn passkey registration, authentication, and recovery flows.
 * Uses mocked @simplewebauthn/server functions since we can't perform real
 * WebAuthn ceremonies in unit tests.
 */
import { describe, it, expect, beforeEach, vi, afterEach, Mock } from 'vitest';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';

// Mock prisma - use factory function to avoid hoisting issues
vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    passkey: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

// Mock email sending
vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasskeyRecoveryEmail: vi.fn().mockResolvedValue(true),
}));

// Mock crypto.randomBytes for predictable tokens
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue(Buffer.from('test-token-1234567890'.repeat(3))),
  };
});

// Mock @simplewebauthn/server with factory function
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// Import mocked modules to get references
import { prisma } from '../src/db';
import * as simplewebauthn from '@simplewebauthn/server';

// Import module under test
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  requestPasskeyRecovery,
  getRecoveryRegistrationOptions,
  completePasskeyRecovery,
} from '../src/passkey';

describe('Passkey Authentication', () => {
  const testEmail = 'test@example.com';
  const testChallenge = 'test-challenge-base64';

  // Cast to access mock functions
  const mockPrisma = prisma as unknown as {
    user: {
      findUnique: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
    };
    passkey: {
      create: Mock;
      update: Mock;
      deleteMany: Mock;
      findUnique: Mock;
    };
    $transaction: Mock;
  };

  const mockGenerateRegistration = simplewebauthn.generateRegistrationOptions as Mock;
  const mockVerifyRegistration = simplewebauthn.verifyRegistrationResponse as Mock;
  const mockGenerateAuthentication = simplewebauthn.generateAuthenticationOptions as Mock;
  const mockVerifyAuthentication = simplewebauthn.verifyAuthenticationResponse as Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockGenerateRegistration.mockResolvedValue({
      challenge: testChallenge,
      rp: { name: 'Test', id: 'localhost' },
      user: { id: 'user-id', name: testEmail, displayName: testEmail },
      pubKeyCredParams: [],
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      attestation: 'none',
    } as PublicKeyCredentialCreationOptionsJSON);

    mockGenerateAuthentication.mockResolvedValue({
      challenge: testChallenge,
      rpId: 'localhost',
      allowCredentials: [],
      userVerification: 'preferred',
    } as PublicKeyCredentialRequestOptionsJSON);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Registration Flow', () => {
    it('should generate registration options for new user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const options = await generateRegistrationOptions(testEmail);

      expect(options).toBeDefined();
      expect(options.challenge).toBe(testChallenge);
      expect(mockGenerateRegistration).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: testEmail,
          userDisplayName: testEmail,
          excludeCredentials: [],
        }),
      );
    });

    it('should reject registration for existing verified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [],
      });

      await expect(generateRegistrationOptions(testEmail)).rejects.toThrow(
        'An account with this email already exists',
      );
    });

    it('should allow re-registration for unverified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        passkeys: [{ credentialId: Buffer.from('old-cred'), transports: null }],
      });

      const options = await generateRegistrationOptions(testEmail);

      expect(options).toBeDefined();
      expect(mockGenerateRegistration).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({ id: expect.any(String) }),
          ]),
        }),
      );
    });

    it('should verify registration and create new user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const mockCredentialId = new Uint8Array([1, 2, 3, 4]);
      const mockPublicKey = new Uint8Array([5, 6, 7, 8]);

      mockVerifyRegistration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: mockCredentialId,
            publicKey: mockPublicKey,
            counter: 0,
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      });

      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
      });

      // First generate options to store challenge
      await generateRegistrationOptions(testEmail);

      // Then verify
      const mockCredential = {
        id: 'credential-id-base64',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
          transports: ['internal'],
        },
        clientExtensionResults: {},
      };

      const result = await verifyRegistration(testEmail, mockCredential as any);

      expect(result.message).toContain('check your email');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should reject verification with expired challenge', async () => {
      // Don't generate options first - no challenge stored
      const mockCredential = {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      };

      await expect(verifyRegistration(testEmail, mockCredential as any)).rejects.toThrow(
        'Challenge expired or not found',
      );
    });

    it('should reject verification when WebAuthn verification fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      mockVerifyRegistration.mockRejectedValue(new Error('Verification failed'));

      // Generate options first
      await generateRegistrationOptions(testEmail);

      const mockCredential = {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      };

      await expect(verifyRegistration(testEmail, mockCredential as any)).rejects.toThrow(
        'Passkey verification failed',
      );
    });
  });

  describe('Authentication Flow', () => {
    const mockPasskey = {
      id: 1,
      credentialId: Buffer.from([1, 2, 3, 4]),
      publicKey: Buffer.from([5, 6, 7, 8]),
      counter: BigInt(0),
      transports: JSON.stringify(['internal']),
    };

    it('should generate authentication options for existing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      const options = await generateAuthenticationOptions(testEmail);

      expect(options).toBeDefined();
      expect(options.challenge).toBe(testChallenge);
      // Implementation uses discoverable credentials (no allowCredentials)
      // to let browser show all available passkeys for this RP
      expect(mockGenerateAuthentication).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          userVerification: 'preferred',
        }),
      );
    });

    it('should generate dummy options for non-existent user (no user enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const options = await generateAuthenticationOptions(testEmail);

      // Should still return options (dummy) to prevent user enumeration
      expect(options).toBeDefined();
      expect(options.challenge).toBe(testChallenge);
    });

    it('should verify authentication and return user info', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      // Mock passkey lookup by credential ID (new implementation uses discoverable credentials)
      mockPrisma.passkey.findUnique.mockResolvedValue({
        ...mockPasskey,
        user: {
          id: 1,
          email: testEmail,
          isVerified: 1,
        },
      });

      mockVerifyAuthentication.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 1,
        },
      });

      mockPrisma.passkey.update.mockResolvedValue({});

      // Generate options first to store challenge
      await generateAuthenticationOptions(testEmail);

      const mockCredential = {
        id: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      };

      const result = await verifyAuthentication(testEmail, mockCredential as any);

      expect(result.userId).toBe(1);
      expect(result.email).toBe(testEmail);
      expect(mockPrisma.passkey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            counter: BigInt(1),
          }),
        }),
      );
    });

    it('should reject authentication for unverified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        passkeys: [mockPasskey],
      });

      // Mock passkey lookup - user is unverified
      mockPrisma.passkey.findUnique.mockResolvedValue({
        ...mockPasskey,
        user: {
          id: 1,
          email: testEmail,
          isVerified: 0,
        },
      });

      // Generate options first
      await generateAuthenticationOptions(testEmail);

      const mockCredential = {
        id: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      };

      await expect(
        verifyAuthentication(testEmail, mockCredential as any),
      ).rejects.toThrow('Email not verified');
    });

    it('should reject authentication with wrong passkey', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      // Mock passkey lookup returns null (credential not found)
      mockPrisma.passkey.findUnique.mockResolvedValue(null);

      // Generate options first
      await generateAuthenticationOptions(testEmail);

      const mockCredential = {
        id: 'wrong-credential-id', // Different from stored passkey
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      };

      await expect(
        verifyAuthentication(testEmail, mockCredential as any),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should reject authentication with expired challenge', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      // Don't generate options - no challenge stored
      const mockCredential = {
        id: Buffer.from([1, 2, 3, 4]).toString('base64url'),
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
        clientExtensionResults: {},
      };

      await expect(
        verifyAuthentication(testEmail, mockCredential as any),
      ).rejects.toThrow('Challenge expired or not found');
    });
  });

  describe('Recovery Flow', () => {
    const mockPasskey = {
      id: 1,
      credentialId: Buffer.from([1, 2, 3, 4]),
      publicKey: Buffer.from([5, 6, 7, 8]),
      counter: BigInt(0),
      transports: null,
    };

    it('should request recovery for passkey-only user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        passwordHash: null, // Passkey-only user
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      mockPrisma.user.update.mockResolvedValue({});

      const result = await requestPasskeyRecovery(testEmail);

      expect(result.message).toContain('recovery link has been sent');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passkeyRecoveryToken: expect.any(String),
            passkeyRecoveryTokenExpiresAt: expect.any(BigInt),
          }),
        }),
      );
    });

    it('should return success message for non-existent user (no enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await requestPasskeyRecovery(testEmail);

      // Should return same message to prevent user enumeration
      expect(result.message).toContain('recovery link has been sent');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should return success message for password user (no recovery needed)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        passwordHash: 'some-hash', // Has password
        isVerified: 1,
        passkeys: [mockPasskey],
      });

      const result = await requestPasskeyRecovery(testEmail);

      // Should not send recovery email for password users
      expect(result.message).toContain('recovery link has been sent');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should get recovery registration options with valid token', async () => {
      const recoveryToken = 'valid-recovery-token';

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: testEmail,
        passkeyRecoveryToken: recoveryToken,
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() + 3600000), // 1 hour from now
        passkeys: [],
      });

      const result = await getRecoveryRegistrationOptions(recoveryToken);

      expect(result.email).toBe(testEmail);
      expect(result.options).toBeDefined();
      expect(result.options.challenge).toBe(testChallenge);
    });

    it('should reject recovery options with invalid token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(getRecoveryRegistrationOptions('invalid-token')).rejects.toThrow(
        'Invalid or expired recovery token',
      );
    });

    it('should reject recovery options with expired token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: testEmail,
        passkeyRecoveryToken: 'expired-token',
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() - 1000), // Expired
        passkeys: [],
      });

      mockPrisma.user.update.mockResolvedValue({});

      await expect(getRecoveryRegistrationOptions('expired-token')).rejects.toThrow(
        'Invalid or expired recovery token',
      );

      // Should clear expired token
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passkeyRecoveryToken: null,
            passkeyRecoveryTokenExpiresAt: null,
          }),
        }),
      );
    });

    it('should complete recovery and invalidate old tokens', async () => {
      const recoveryToken = 'valid-recovery-token';

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: testEmail,
        passkeyRecoveryToken: recoveryToken,
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() + 3600000),
      });

      const mockCredentialId = new Uint8Array([9, 10, 11, 12]);
      const mockPublicKey = new Uint8Array([13, 14, 15, 16]);

      mockVerifyRegistration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: mockCredentialId,
            publicKey: mockPublicKey,
            counter: 0,
          },
        },
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          passkey: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({}),
          },
          user: {
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      });

      // First get recovery options to store challenge
      await getRecoveryRegistrationOptions(recoveryToken);

      // Reset the findFirst mock for the completion step
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: testEmail,
        passkeyRecoveryToken: recoveryToken,
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() + 3600000),
      });

      const mockCredential = {
        id: 'new-credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
          transports: ['internal'],
        },
        clientExtensionResults: {},
      };

      const result = await completePasskeyRecovery(recoveryToken, mockCredential as any);

      expect(result.message).toContain('reset successfully');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('Challenge Expiration', () => {
    it('should reject verification if challenge used twice', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      mockVerifyRegistration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: new Uint8Array([1, 2, 3, 4]),
            publicKey: new Uint8Array([5, 6, 7, 8]),
            counter: 0,
          },
        },
      });

      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
      });

      // Generate options
      await generateRegistrationOptions(testEmail);

      const mockCredential = {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      };

      // First verification should succeed
      await verifyRegistration(testEmail, mockCredential as any);

      // Second verification should fail (challenge consumed)
      await expect(verifyRegistration(testEmail, mockCredential as any)).rejects.toThrow(
        'Challenge expired or not found',
      );
    });
  });
});

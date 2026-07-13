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
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

// Mock prisma - use factory function to avoid hoisting issues
vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
import { sendPasskeyRecoveryEmail, sendVerificationEmail } from '../src/email';
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
  const registrationResponse = {
    message: 'Registration successful. Please check your email to verify your account.',
  };
  const recoveryResponse = {
    message: 'If an account with that email exists, a recovery link has been sent.',
  };

  type RecoveryTransaction = {
    user: { updateMany: Mock };
    passkey: { deleteMany: Mock; create: Mock };
  };
  type RecoveryTransactionCallback = (
    transaction: RecoveryTransaction,
  ) => Promise<unknown>;

  // Cast to access mock functions
  const mockPrisma = prisma as unknown as {
    user: {
      findUnique: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      updateMany: Mock;
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

    it('should generate the same registration options for an existing verified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [],
      });

      const options = await generateRegistrationOptions(testEmail);

      expect(options.challenge).toBe(testChallenge);
      expect(mockGenerateRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ excludeCredentials: [] }),
      );
    });

    it('should not disclose an unverified user passkey through excluded credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        passkeys: [{ credentialId: Buffer.from('old-cred'), transports: null }],
      });

      const options = await generateRegistrationOptions(testEmail);

      expect(options).toBeDefined();
      expect(mockGenerateRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ excludeCredentials: [] }),
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

      // In TEST_MODE, auto-verify returns different message
      expect(
        result.message.includes('check your email') ||
          result.message.includes('automatically verified'),
      ).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should return the neutral response without changing an existing verified user', async () => {
      const mockCredentialId = new Uint8Array([1, 2, 3, 4]);
      mockVerifyRegistration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: mockCredentialId,
            publicKey: new Uint8Array([5, 6, 7, 8]),
            counter: 0,
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
      });
      await generateRegistrationOptions(testEmail);

      const result = await verifyRegistration(testEmail, {
        id: 'credential-id-base64',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
          transports: ['internal'],
        },
        clientExtensionResults: {},
      } as RegistrationResponseJSON);

      expect(result).toEqual(registrationResponse);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should return the neutral response when an unverified user reaches the resend cap', async () => {
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
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 0,
        verificationResendCount: 20,
      });
      await generateRegistrationOptions(testEmail);

      const result = await verifyRegistration(testEmail, {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      } as RegistrationResponseJSON);

      expect(result).toEqual(registrationResponse);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should return the neutral response when verification email delivery fails', async () => {
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
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 1, email: testEmail, isVerified: 0 });
      mockPrisma.user.create.mockResolvedValue({ id: 1 });
      (sendVerificationEmail as Mock).mockResolvedValueOnce(false);
      await generateRegistrationOptions(testEmail);

      const result = await verifyRegistration(testEmail, {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      } as RegistrationResponseJSON);

      expect(result).toEqual(registrationResponse);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 1 } });
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
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      });

      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await requestPasskeyRecovery(testEmail);

      expect(result).toEqual(recoveryResponse);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          OR: [
            { passkeyRecoveryToken: null },
            { passkeyRecoveryTokenExpiresAt: null },
            { passkeyRecoveryTokenExpiresAt: { lte: expect.any(BigInt) } },
          ],
        },
        data: {
          passkeyRecoveryToken: expect.any(String),
          passkeyRecoveryTokenExpiresAt: expect.any(BigInt),
        },
      });
    });

    it('should not rotate or resend a still-valid recovery token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        passwordHash: null,
        isVerified: 1,
        passkeys: [mockPasskey],
        passkeyRecoveryToken: 'active-token',
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() + 60_000),
      });

      await requestPasskeyRecovery(testEmail);

      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
      expect(sendPasskeyRecoveryEmail).not.toHaveBeenCalled();
    });

    it('should return the neutral response and clear only its claimed token when email fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        passwordHash: null,
        isVerified: 1,
        passkeys: [mockPasskey],
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      (sendPasskeyRecoveryEmail as Mock).mockResolvedValueOnce(false);

      const result = await requestPasskeyRecovery(testEmail);

      expect(result).toEqual(recoveryResponse);
      const claimedToken =
        mockPrisma.user.updateMany.mock.calls[0][0].data.passkeyRecoveryToken;
      expect(mockPrisma.user.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 1, passkeyRecoveryToken: claimedToken },
        data: {
          passkeyRecoveryToken: null,
          passkeyRecoveryTokenExpiresAt: null,
        },
      });
    });

    it('should not send when another recovery request wins the token claim race', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        passwordHash: null,
        isVerified: 1,
        passkeys: [mockPasskey],
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      await requestPasskeyRecovery(testEmail);

      expect(sendPasskeyRecoveryEmail).not.toHaveBeenCalled();
    });

    it('should return success message for non-existent user (no enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await requestPasskeyRecovery(testEmail);

      // Should return same message to prevent user enumeration
      expect(result).toEqual(recoveryResponse);
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
      expect(result).toEqual(recoveryResponse);
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

      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      await expect(getRecoveryRegistrationOptions('expired-token')).rejects.toThrow(
        'Invalid or expired recovery token',
      );

      // Should clear expired token
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 1, passkeyRecoveryToken: 'expired-token' },
        data: {
          passkeyRecoveryToken: null,
          passkeyRecoveryTokenExpiresAt: null,
        },
      });
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

      const txPasskeyDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const txPasskeyCreate = vi.fn().mockResolvedValue({});
      const txUserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation(
        async (callback: RecoveryTransactionCallback) => {
          const tx = {
            passkey: {
              deleteMany: txPasskeyDeleteMany,
              create: txPasskeyCreate,
            },
            user: {
              updateMany: txUserUpdateMany,
            },
          };
          return callback(tx);
        },
      );

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
      expect(txUserUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          passkeyRecoveryToken: recoveryToken,
          OR: [
            { passkeyRecoveryTokenExpiresAt: null },
            { passkeyRecoveryTokenExpiresAt: { gte: expect.any(BigInt) } },
          ],
        },
        data: {
          passkeyRecoveryToken: null,
          passkeyRecoveryTokenExpiresAt: null,
          tokenVersion: { increment: 1 },
        },
      });
      expect(txPasskeyDeleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(txPasskeyCreate).toHaveBeenCalledOnce();
    });

    it('should reject recovery already consumed by another request before replacing passkeys', async () => {
      const recoveryToken = 'raced-recovery-token';
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: testEmail,
        passkeyRecoveryToken: recoveryToken,
        passkeyRecoveryTokenExpiresAt: BigInt(Date.now() + 3600000),
      });
      mockVerifyRegistration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: new Uint8Array([9, 10, 11, 12]),
            publicKey: new Uint8Array([13, 14, 15, 16]),
            counter: 0,
          },
        },
      });
      const txPasskeyDeleteMany = vi.fn();
      mockPrisma.$transaction.mockImplementation(
        async (callback: RecoveryTransactionCallback) =>
          callback({
            user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
            passkey: { deleteMany: txPasskeyDeleteMany, create: vi.fn() },
          }),
      );
      await getRecoveryRegistrationOptions(recoveryToken);

      await expect(
        completePasskeyRecovery(recoveryToken, {
          id: 'new-credential-id',
          rawId: 'raw-id',
          type: 'public-key',
          response: {
            clientDataJSON: 'client-data',
            attestationObject: 'attestation',
          },
          clientExtensionResults: {},
        } as RegistrationResponseJSON),
      ).rejects.toThrow('Invalid or expired recovery token');
      expect(txPasskeyDeleteMany).not.toHaveBeenCalled();
    });
  });

  describe('Challenge Expiration', () => {
    it('should isolate registration challenges from authentication challenges', async () => {
      const registrationChallenge = 'registration-challenge';
      const authenticationChallenge = 'authentication-challenge';
      mockGenerateRegistration.mockResolvedValueOnce({
        challenge: registrationChallenge,
        rp: { name: 'Test', id: 'localhost' },
        user: { id: 'user-id', name: testEmail, displayName: testEmail },
        pubKeyCredParams: [],
      });
      mockGenerateAuthentication.mockResolvedValueOnce({
        challenge: authenticationChallenge,
        rpId: 'localhost',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: testEmail,
        isVerified: 1,
        passkeys: [{}],
      });
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

      await generateRegistrationOptions(testEmail);
      await generateAuthenticationOptions(testEmail);
      await verifyRegistration(testEmail, {
        id: 'credential-id',
        rawId: 'raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
        clientExtensionResults: {},
      } as RegistrationResponseJSON);

      expect(mockVerifyRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ expectedChallenge: registrationChallenge }),
      );
    });

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

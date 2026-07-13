/**
 * Real-PostgreSQL coverage for registration races that mocks cannot prove.
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db
 *
 * Run with:
 *   npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/registration-races.integration.spec.ts
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  Mock,
  vi,
} from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-characters';
  delete process.env.TEST_MODE;
  delete process.env.TEST_MODE_CONFIRM;
});

vi.mock('../../src/email', () => ({
  sendVerificationEmail: vi.fn(),
  sendLoginMagicLinkEmail: vi.fn(),
  sendPasskeyRecoveryEmail: vi.fn(),
}));

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: vi.fn(),
}));

import { disconnectDb } from '../../src/db';
import { sendVerificationEmail } from '../../src/email';
import * as webAuthn from '@simplewebauthn/server';
import { registerWithMagicLink } from '../../src/auth';
import { generateRegistrationOptions, verifyRegistration } from '../../src/passkey';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const RUN_ID = `${Date.now()}-${process.pid}`;
const EMAIL_PREFIX = `registration-race-${RUN_ID}`;

const mockSendVerificationEmail = sendVerificationEmail as Mock;
const mockVerifyRegistrationResponse = webAuthn.verifyRegistrationResponse as Mock;

const registrationCredential = (id: string): RegistrationResponseJSON => ({
  id,
  rawId: id,
  type: 'public-key',
  response: {
    clientDataJSON: 'client-data',
    attestationObject: 'attestation',
    transports: ['internal'],
  },
  clientExtensionResults: {},
});

const preparePasskeyRegistration = (credentialId: Buffer): void => {
  const credentialIdBase64url = credentialId.toString('base64url');
  mockVerifyRegistrationResponse.mockResolvedValueOnce({
    verified: true,
    registrationInfo: {
      credential: {
        id: new Uint8Array(Buffer.from(credentialIdBase64url)),
        publicKey: new Uint8Array([5, 6, 7, 8]),
        counter: 0,
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  });
};

const registerPasskey = async (email: string, credentialId: Buffer): Promise<void> => {
  preparePasskeyRegistration(credentialId);
  await generateRegistrationOptions(email);
  await verifyRegistration(
    email,
    registrationCredential(credentialId.toString('base64url')),
  );
};

describeWithDb('Registration races (PostgreSQL)', () => {
  let observer: PrismaClient;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendVerificationEmail.mockResolvedValue(true);
  });

  afterEach(async () => {
    await observer.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  });

  afterAll(async () => {
    await observer.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await observer.$disconnect();
    await disconnectDb();
  });

  it('keeps the original passkey when an unverified email is registered again', async () => {
    const email = `${EMAIL_PREFIX}-existing@test.local`;
    const originalCredentialId = Buffer.from(`original-${RUN_ID}`);
    const submittedCredentialId = Buffer.from(`submitted-${RUN_ID}`);
    await observer.user.create({
      data: {
        email,
        verificationToken: 'original-verification-token',
        verificationTokenExpiresAt: BigInt(Date.now() + 60_000),
        verificationResendCount: 1,
        passkeys: {
          create: {
            credentialId: originalCredentialId,
            publicKey: Buffer.from([1, 2, 3, 4]),
          },
        },
      },
    });

    await registerPasskey(email, submittedCredentialId);

    const storedUser = await observer.user.findUniqueOrThrow({
      where: { email },
      include: { passkeys: true },
    });
    expect(storedUser.passkeys).toHaveLength(1);
    expect(storedUser.passkeys[0].credentialId).toEqual(originalCredentialId);
    expect(storedUser.verificationToken).not.toBe('original-verification-token');
    expect(storedUser.verificationResendCount).toBe(2);
  });

  it('does not delete a new passkey user after a concurrent token rotation', async () => {
    const email = `${EMAIL_PREFIX}-passkey-cleanup@test.local`;
    const rotatedToken = 'concurrently-rotated-passkey-token';
    mockSendVerificationEmail.mockImplementationOnce(async () => {
      await observer.user.update({
        where: { email },
        data: { verificationToken: rotatedToken },
      });
      return false;
    });

    await registerPasskey(email, Buffer.from(`cleanup-${RUN_ID}`));

    const storedUser = await observer.user.findUnique({
      where: { email },
      include: { passkeys: true },
    });
    expect(storedUser?.verificationToken).toBe(rotatedToken);
    expect(storedUser?.passkeys).toHaveLength(1);
  });

  it('does not delete a new magic-link user after a concurrent token rotation', async () => {
    const email = `${EMAIL_PREFIX}-magic-link-cleanup@test.local`;
    const rotatedToken = 'concurrently-rotated-magic-link-token';
    mockSendVerificationEmail.mockImplementationOnce(async () => {
      await observer.user.update({
        where: { email },
        data: { verificationToken: rotatedToken },
      });
      return false;
    });

    await registerWithMagicLink(email, Date.now());

    const storedUser = await observer.user.findUnique({ where: { email } });
    expect(storedUser?.verificationToken).toBe(rotatedToken);
  });
});

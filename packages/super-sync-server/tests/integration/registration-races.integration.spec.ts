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
import { registerWithMagicLink, verifyEmail } from '../../src/auth';
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

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

  it('activates only the passkey bound to the verification link', async () => {
    const email = `${EMAIL_PREFIX}-existing@test.local`;
    const attackerCredentialId = Buffer.from(`attacker-${RUN_ID}`);
    const ownerCredentialId = Buffer.from(`owner-${RUN_ID}`);
    await observer.user.create({
      data: {
        email,
        verificationToken: 'original-verification-token',
        verificationTokenExpiresAt: BigInt(Date.now() + 60_000),
        verificationResendCount: 1,
        passkeys: {
          create: {
            credentialId: attackerCredentialId,
            publicKey: Buffer.from([1, 2, 3, 4]),
          },
        },
      },
    });

    await registerPasskey(email, ownerCredentialId);
    const verificationToken = mockSendVerificationEmail.mock.calls[0][1] as string;
    await verifyEmail(verificationToken);

    const storedUser = await observer.user.findUniqueOrThrow({
      where: { email },
      include: { passkeys: true },
    });
    expect(storedUser.passkeys).toHaveLength(1);
    expect(storedUser.passkeys[0].credentialId).toEqual(ownerCredentialId);
    expect(storedUser.isVerified).toBe(1);
  });

  it('keeps a passkey registration valid when a concurrent email delivery fails', async () => {
    const email = `${EMAIL_PREFIX}-passkey-cleanup@test.local`;
    const firstCredentialId = Buffer.from(`first-${RUN_ID}`);
    const secondCredentialId = Buffer.from(`second-${RUN_ID}`);
    const firstEmailStarted = deferred<void>();
    const secondEmailStarted = deferred<void>();
    const firstEmailResult = deferred<boolean>();
    const secondEmailResult = deferred<boolean>();
    mockSendVerificationEmail
      .mockImplementationOnce(async () => {
        firstEmailStarted.resolve();
        return firstEmailResult.promise;
      })
      .mockImplementationOnce(async () => {
        secondEmailStarted.resolve();
        return secondEmailResult.promise;
      });

    const firstRegistration = registerPasskey(email, firstCredentialId);
    await firstEmailStarted.promise;
    const secondRegistration = registerPasskey(email, secondCredentialId);
    await secondEmailStarted.promise;
    firstEmailResult.resolve(false);
    await firstRegistration;
    secondEmailResult.resolve(true);
    await secondRegistration;
    const secondVerificationToken = mockSendVerificationEmail.mock.calls[1][1] as string;
    await verifyEmail(secondVerificationToken);

    const storedUser = await observer.user.findUnique({
      where: { email },
      include: { passkeys: true },
    });
    expect(storedUser?.passkeys).toHaveLength(1);
    expect(storedUser?.passkeys[0].credentialId).toEqual(secondCredentialId);
    expect(storedUser?.isVerified).toBe(1);
  });

  it('keeps a magic-link registration valid when a concurrent email delivery fails', async () => {
    const email = `${EMAIL_PREFIX}-magic-link-cleanup@test.local`;
    const firstEmailStarted = deferred<void>();
    const secondEmailStarted = deferred<void>();
    const firstEmailResult = deferred<boolean>();
    const secondEmailResult = deferred<boolean>();
    mockSendVerificationEmail
      .mockImplementationOnce(async () => {
        firstEmailStarted.resolve();
        return firstEmailResult.promise;
      })
      .mockImplementationOnce(async () => {
        secondEmailStarted.resolve();
        return secondEmailResult.promise;
      });

    const firstRegistration = registerWithMagicLink(email, Date.now());
    await firstEmailStarted.promise;
    const secondRegistration = registerWithMagicLink(email, Date.now());
    await secondEmailStarted.promise;
    firstEmailResult.resolve(false);
    await firstRegistration;
    secondEmailResult.resolve(true);
    await secondRegistration;
    const secondVerificationToken = mockSendVerificationEmail.mock.calls[1][1] as string;
    await verifyEmail(secondVerificationToken);

    const storedUser = await observer.user.findUnique({ where: { email } });
    expect(storedUser).not.toBeNull();
    expect(storedUser?.isVerified).toBe(1);
  });

  it('does not let a later passkey attempt invalidate a magic-link verification', async () => {
    const email = `${EMAIL_PREFIX}-magic-before-passkey@test.local`;
    await registerWithMagicLink(email, Date.now());
    const magicLinkToken = mockSendVerificationEmail.mock.calls[0][1] as string;

    await registerPasskey(email, Buffer.from(`untrusted-${RUN_ID}`));
    await verifyEmail(magicLinkToken);

    const storedUser = await observer.user.findUniqueOrThrow({
      where: { email },
      include: { passkeys: true, pendingPasskeyRegistrations: true },
    });
    expect(storedUser.isVerified).toBe(1);
    expect(storedUser.passkeys).toHaveLength(0);
    expect(storedUser.pendingPasskeyRegistrations).toHaveLength(0);
  });
});

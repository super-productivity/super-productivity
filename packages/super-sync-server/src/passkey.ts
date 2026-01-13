import {
  generateRegistrationOptions as webAuthnGenerateRegistration,
  verifyRegistrationResponse,
  generateAuthenticationOptions as webAuthnGenerateAuthentication,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from './db';
import { Logger } from './logger';
import { randomBytes } from 'crypto';
import { sendPasskeyRecoveryEmail } from './email';
import { Prisma } from '@prisma/client';

// Constants
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RECOVERY_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// WebAuthn configuration from environment
const getWebAuthnConfig = (): { rpName: string; rpID: string; origin: string } => {
  const rpName = process.env.WEBAUTHN_RP_NAME || 'Super Productivity Sync';
  const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
  const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:1900';

  Logger.info(`WebAuthn config: rpID=${rpID}, origin=${origin}`);
  return { rpName, rpID, origin };
};

// In-memory challenge storage (short-lived, per-email)
// In production with multiple instances, use Redis or similar
const challenges = new Map<string, { challenge: string; expiresAt: number }>();

// Warn at startup if running with in-memory storage in production
if (process.env.NODE_ENV === 'production') {
  Logger.warn(
    'Passkey challenge storage is using in-memory Map. ' +
      'This will not work correctly with multiple server instances. ' +
      'For multi-instance deployments, implement Redis-based challenge storage.',
  );
}

// Cleanup expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of challenges.entries()) {
    if (data.expiresAt < now) {
      challenges.delete(email);
    }
  }
}, 60 * 1000); // Every minute

const storeChallenge = (email: string, challenge: string): void => {
  challenges.set(email.toLowerCase(), {
    challenge,
    expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
  });
};

const getAndClearChallenge = (email: string): string | null => {
  const key = email.toLowerCase();
  const data = challenges.get(key);
  if (!data) return null;

  challenges.delete(key);

  if (data.expiresAt < Date.now()) {
    return null; // Expired
  }

  return data.challenge;
};

/**
 * Generate registration options for passkey creation (new user)
 */
export const generateRegistrationOptions = async (
  email: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> => {
  const { rpName, rpID } = getWebAuthnConfig();

  // Check if email already exists and is verified
  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { passkeys: true },
  });

  if (existingUser?.isVerified === 1) {
    throw new Error('An account with this email already exists');
  }

  // Generate options
  const options = await webAuthnGenerateRegistration({
    rpName,
    rpID,
    userName: email,
    userDisplayName: email,
    // Prevent re-registering existing passkeys
    excludeCredentials:
      existingUser?.passkeys.map((pk) => ({
        id: Buffer.from(pk.credentialId).toString('base64url'),
        transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      })) || [],
    authenticatorSelection: {
      residentKey: 'required', // Required for synced passkeys (Google Password Manager)
      userVerification: 'preferred',
    },
    attestationType: 'none', // We don't need attestation
  });

  storeChallenge(email, options.challenge);

  Logger.info(
    `Registration options for ${email}: ${JSON.stringify({
      rp: options.rp,
      user: options.user,
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
    })}`,
  );
  return options;
};

/**
 * Verify passkey registration and create user
 */
export const verifyRegistration = async (
  email: string,
  credential: RegistrationResponseJSON,
  termsAcceptedAt?: number,
): Promise<{ message: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const expectedChallenge = getAndClearChallenge(email);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
    });
  } catch (err) {
    Logger.warn(`Passkey registration verification failed for ${email}: ${err}`);
    throw new Error('Passkey verification failed. Please try again.');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey verification failed');
  }

  const { credential: credentialInfo } = verification.registrationInfo;

  // credentialInfo.id from SimpleWebAuthn is a Uint8Array containing the base64url string as UTF-8 bytes
  // We need to decode it to get the actual raw credential ID bytes
  const credentialIdBase64url = Buffer.from(credentialInfo.id).toString('utf-8');
  const credentialIdRawBytes = Buffer.from(credentialIdBase64url, 'base64url');
  Logger.info(`[DEBUG] Registration credentialId base64url: ${credentialIdBase64url}`);
  Logger.info(
    `[DEBUG] Registration credentialId raw bytes (hex): ${credentialIdRawBytes.toString('hex')}`,
  );

  const verificationToken = randomBytes(32).toString('hex');
  const tokenExpiresAt = BigInt(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);
  const acceptedAt = termsAcceptedAt ? BigInt(termsAcceptedAt) : BigInt(Date.now());

  try {
    // Check if unverified user exists (re-registration attempt)
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      if (existingUser.isVerified === 1) {
        throw new Error('An account with this email already exists');
      }

      // Update existing unverified user with new passkey
      await prisma.$transaction(async (tx) => {
        // Delete old passkeys
        await tx.passkey.deleteMany({ where: { userId: existingUser.id } });

        // Create new passkey
        await tx.passkey.create({
          data: {
            credentialId: credentialIdRawBytes,
            publicKey: Buffer.from(credentialInfo.publicKey),
            counter: BigInt(credentialInfo.counter),
            transports: credential.response.transports
              ? JSON.stringify(credential.response.transports)
              : null,
            userId: existingUser.id,
          },
        });

        // Update user with new verification token
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            verificationToken,
            verificationTokenExpiresAt: tokenExpiresAt,
            verificationResendCount: { increment: 1 },
          },
        });
      });

      Logger.info(`Updated passkey for unverified user (ID: ${existingUser.id})`);
    } else {
      // Create new user with passkey
      await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash: null, // Passkey-only user
          verificationToken,
          verificationTokenExpiresAt: tokenExpiresAt,
          termsAcceptedAt: acceptedAt,
          passkeys: {
            create: {
              credentialId: credentialIdRawBytes,
              publicKey: Buffer.from(credentialInfo.publicKey),
              counter: BigInt(credentialInfo.counter),
              transports: credential.response.transports
                ? JSON.stringify(credential.response.transports)
                : null,
            },
          },
        },
      });

      Logger.info(`Created new passkey user for ${email}`);
    }

    // Send verification email
    const { sendVerificationEmail } = await import('./email');
    const emailSent = await sendVerificationEmail(email, verificationToken);

    if (!emailSent) {
      // Clean up on email failure for new users
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (user && user.isVerified === 0) {
        await prisma.user.delete({ where: { id: user.id } });
        Logger.info(`Cleaned up failed passkey registration for ${email}`);
      }
      throw new Error('Failed to send verification email. Please try again later.');
    }

    Logger.info(`Passkey registration initiated for ${email}`);
    return {
      message: 'Registration successful. Please check your email to verify your account.',
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('An account with this email already exists');
    }
    throw err;
  }
};

/**
 * Generate authentication options for passkey login
 */
export const generateAuthenticationOptions = async (
  email: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  const { rpID } = getWebAuthnConfig();

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { passkeys: true },
  });

  if (!user || user.passkeys.length === 0) {
    // Don't reveal if user exists - generate dummy options
    const options = await webAuthnGenerateAuthentication({
      rpID,
      userVerification: 'preferred',
    });
    storeChallenge(email, options.challenge);
    return options;
  }

  // Don't provide allowCredentials - let browser discover resident credentials
  // This works because we use residentKey: 'required' during registration
  Logger.info(`Login for ${email}: using discoverable credentials (no allowCredentials)`);

  const options = await webAuthnGenerateAuthentication({
    rpID,
    // allowCredentials omitted - browser will show all discoverable passkeys for this RP
    userVerification: 'preferred',
  });

  storeChallenge(email, options.challenge);

  Logger.info(
    `Generated passkey authentication options for ${email}: rpId=${options.rpId}, discoverable=true`,
  );
  return options;
};

/**
 * Verify passkey authentication and return JWT-compatible user info
 */
export const verifyAuthentication = async (
  email: string,
  credential: AuthenticationResponseJSON,
): Promise<{ userId: number; email: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const expectedChallenge = getAndClearChallenge(email);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  // With discoverable credentials, look up the passkey by credential ID
  // instead of by email, since the user might select any passkey for this RP
  const credentialIdBuffer = Buffer.from(credential.id, 'base64url');

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: credentialIdBuffer },
    include: { user: true },
  });

  if (!passkey) {
    Logger.warn(
      `Passkey not found for credential ID: ${credential.id.substring(0, 20)}...`,
    );
    throw new Error('Invalid credentials');
  }

  const user = passkey.user;

  if (user.isVerified === 0) {
    throw new Error('Email not verified');
  }

  // Log if the email doesn't match (user selected a different account's passkey)
  if (user.email.toLowerCase() !== email.toLowerCase()) {
    Logger.info(`User authenticated with passkey for ${user.email} but entered ${email}`);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
      credential: {
        id: passkey.credentialId.toString('base64url'),
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
  } catch (err) {
    Logger.warn(`Passkey authentication verification failed for ${email}: ${err}`);
    throw new Error('Invalid credentials');
  }

  if (!verification.verified) {
    throw new Error('Invalid credentials');
  }

  // Update counter and last used timestamp
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  Logger.info(`User logged in via passkey (ID: ${user.id})`);

  return { userId: user.id, email: user.email };
};

/**
 * Request passkey recovery - sends magic link email
 */
export const requestPasskeyRecovery = async (
  email: string,
): Promise<{ message: string }> => {
  const successMessage = {
    message: 'If an account with that email exists, a recovery link has been sent.',
  };

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { passkeys: true },
  });

  // Don't reveal if user exists
  if (!user) {
    Logger.debug(`Passkey recovery requested for non-existent email`);
    return successMessage;
  }

  // Only for passkey users (no password)
  if (user.passwordHash) {
    Logger.debug(`Passkey recovery requested for password user (ID: ${user.id})`);
    return successMessage;
  }

  if (user.isVerified === 0) {
    Logger.debug(`Passkey recovery requested for unverified account (ID: ${user.id})`);
    return successMessage;
  }

  if (user.passkeys.length === 0) {
    Logger.debug(`Passkey recovery requested for user with no passkeys (ID: ${user.id})`);
    return successMessage;
  }

  const recoveryToken = randomBytes(32).toString('hex');
  const expiresAt = BigInt(Date.now() + RECOVERY_TOKEN_EXPIRY_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passkeyRecoveryToken: recoveryToken,
      passkeyRecoveryTokenExpiresAt: expiresAt,
    },
  });

  const emailSent = await sendPasskeyRecoveryEmail(email, recoveryToken);
  if (!emailSent) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      },
    });
    throw new Error('Failed to send recovery email. Please try again later.');
  }

  Logger.info(`Passkey recovery requested (ID: ${user.id})`);
  return successMessage;
};

/**
 * Validate recovery token and return registration options
 */
export const getRecoveryRegistrationOptions = async (
  token: string,
): Promise<{ email: string; options: PublicKeyCredentialCreationOptionsJSON }> => {
  const user = await prisma.user.findFirst({
    where: { passkeyRecoveryToken: token },
    include: { passkeys: true },
  });

  if (!user) {
    throw new Error('Invalid or expired recovery token');
  }

  if (
    user.passkeyRecoveryTokenExpiresAt &&
    user.passkeyRecoveryTokenExpiresAt < BigInt(Date.now())
  ) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      },
    });
    throw new Error('Invalid or expired recovery token');
  }

  const { rpName, rpID } = getWebAuthnConfig();

  const options = await webAuthnGenerateRegistration({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    // Don't exclude existing passkeys - we're replacing them
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestationType: 'none',
  });

  // Store challenge with recovery token as key (since we don't want to leak email)
  storeChallenge(`recovery:${token}`, options.challenge);

  Logger.debug(`Generated recovery registration options for user ${user.id}`);
  return { email: user.email, options };
};

/**
 * Complete passkey recovery - register new passkey and delete old ones
 */
export const completePasskeyRecovery = async (
  token: string,
  credential: RegistrationResponseJSON,
): Promise<{ message: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const user = await prisma.user.findFirst({
    where: { passkeyRecoveryToken: token },
  });

  if (!user) {
    throw new Error('Invalid or expired recovery token');
  }

  if (
    user.passkeyRecoveryTokenExpiresAt &&
    user.passkeyRecoveryTokenExpiresAt < BigInt(Date.now())
  ) {
    throw new Error('Invalid or expired recovery token');
  }

  const expectedChallenge = getAndClearChallenge(`recovery:${token}`);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
    });
  } catch (err) {
    Logger.warn(`Passkey recovery verification failed for user ${user.id}: ${err}`);
    throw new Error('Passkey verification failed. Please try again.');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey verification failed');
  }

  const { credential: credentialInfo } = verification.registrationInfo;

  // credentialInfo.id from SimpleWebAuthn is a Uint8Array containing the base64url string as UTF-8 bytes
  // We need to decode it to get the actual raw credential ID bytes
  const credentialIdBase64url = Buffer.from(credentialInfo.id).toString('utf-8');
  const credentialIdRawBytes = Buffer.from(credentialIdBase64url, 'base64url');

  // Delete old passkeys and create new one, clear recovery token, invalidate sessions
  await prisma.$transaction(async (tx) => {
    await tx.passkey.deleteMany({ where: { userId: user.id } });

    await tx.passkey.create({
      data: {
        credentialId: credentialIdRawBytes,
        publicKey: Buffer.from(credentialInfo.publicKey),
        counter: BigInt(credentialInfo.counter),
        transports: credential.response.transports
          ? JSON.stringify(credential.response.transports)
          : null,
        userId: user.id,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
        tokenVersion: { increment: 1 }, // Invalidate all existing JWT tokens
      },
    });
  });

  Logger.info(`Passkey recovery completed (ID: ${user.id})`);

  return {
    message:
      'Passkey has been reset successfully. You can now log in with your new passkey.',
  };
};

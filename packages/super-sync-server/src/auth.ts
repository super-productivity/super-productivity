import { prisma } from './db';
import * as jwt from 'jsonwebtoken';
import { Logger } from './logger';
import { randomBytes } from 'crypto';
import { sendLoginMagicLinkEmail } from './email';

// Auth constants
const MIN_JWT_SECRET_LENGTH = 32;
const JWT_EXPIRY = '365d';
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOGIN_MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters for security`,
    );
  }
  return secret;
};

const JWT_SECRET = getJwtSecret();

export const verifyEmail = async (token: string): Promise<boolean> => {
  const user = await prisma.user.findFirst({
    where: { verificationToken: token },
  });

  if (!user) {
    throw new Error('Invalid verification token');
  }

  if (
    user.verificationTokenExpiresAt &&
    user.verificationTokenExpiresAt < BigInt(Date.now())
  ) {
    throw new Error('Verification token has expired');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: 1,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      verificationResendCount: 0,
    },
  });

  Logger.info(`User verified (ID: ${user.id})`);
  return true;
};

/**
 * Revoke all existing tokens for a user by incrementing their token version.
 * Call this when the user explicitly logs out all devices.
 */
export const revokeAllTokens = async (userId: number): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  Logger.info(`All tokens revoked for user ${userId}`);
};

/**
 * Replace the current JWT with a new one.
 * This invalidates all existing tokens (including the current one) and returns a fresh token.
 */
export const replaceToken = async (
  userId: number,
  email: string,
): Promise<{ token: string; user: { id: number; email: string } }> => {
  // Use transaction to ensure atomicity of version increment and read
  const newTokenVersion = await prisma.$transaction(async (tx) => {
    // Increment token version to invalidate all existing tokens
    const user = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return user.tokenVersion;
  });

  const token = jwt.sign({ userId, email, tokenVersion: newTokenVersion }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });

  Logger.info(`Token replaced for user ${userId} (new version: ${newTokenVersion})`);

  return { token, user: { id: userId, email } };
};

export const verifyToken = async (
  token: string,
): Promise<{ userId: number; email: string } | null> => {
  try {
    const payload = await new Promise<{
      userId: number;
      email: string;
      tokenVersion?: number;
    }>((resolve, reject) => {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as { userId: number; email: string; tokenVersion?: number });
      });
    });

    // Verify user exists and token version matches
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, tokenVersion: true },
    });

    if (!user) {
      Logger.warn(`Token verification failed: User ${payload.userId} not found in DB`);
      return null;
    }

    // Check token version - if it doesn't match, the token has been revoked
    // (e.g., user changed password). Tokens without version are treated as version 0.
    const tokenVersion = payload.tokenVersion ?? 0;
    const currentVersion = user.tokenVersion ?? 0;
    if (tokenVersion !== currentVersion) {
      Logger.warn(
        `Token verification failed: Token version mismatch for user ${payload.userId} ` +
          `(token: ${tokenVersion}, current: ${currentVersion})`,
      );
      return null;
    }

    return { userId: payload.userId, email: payload.email };
  } catch (err) {
    return null;
  }
};

/**
 * Request a magic link for passwordless login.
 * Generates a login token, stores it in the database, and sends an email.
 * Always returns success message to prevent email enumeration.
 */
export const requestLoginMagicLink = async (
  email: string,
): Promise<{ message: string }> => {
  const successMessage = {
    message: 'If an account with that email exists, a login link has been sent.',
  };

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    Logger.debug(`Magic link requested for non-existent email`);
    return successMessage;
  }

  if (user.isVerified === 0) {
    Logger.debug(`Magic link requested for unverified account (ID: ${user.id})`);
    return successMessage;
  }

  const loginToken = randomBytes(32).toString('hex');
  const expiresAt = BigInt(Date.now() + LOGIN_MAGIC_LINK_EXPIRY_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginToken,
      loginTokenExpiresAt: expiresAt,
    },
  });

  const emailSent = await sendLoginMagicLinkEmail(email, loginToken);
  if (!emailSent) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginToken: null,
        loginTokenExpiresAt: null,
      },
    });
    throw new Error('Failed to send login email. Please try again later.');
  }

  Logger.info(`Magic link login requested (ID: ${user.id})`);
  return successMessage;
};

/**
 * Verify a magic link login token and return a JWT.
 */
export const verifyLoginMagicLink = async (
  token: string,
): Promise<{ token: string; user: { id: number; email: string } }> => {
  const user = await prisma.user.findFirst({
    where: { loginToken: token },
  });

  if (!user) {
    throw new Error('Invalid or expired login link');
  }

  if (user.loginTokenExpiresAt && user.loginTokenExpiresAt < BigInt(Date.now())) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginToken: null,
        loginTokenExpiresAt: null,
      },
    });
    throw new Error('Invalid or expired login link');
  }

  // Clear the token (single use) and reset any failed attempts
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginToken: null,
      loginTokenExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  const tokenVersion = user.tokenVersion ?? 0;
  const jwtToken = jwt.sign(
    { userId: user.id, email: user.email, tokenVersion },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );

  Logger.info(`User logged in via magic link (ID: ${user.id})`);

  return { token: jwtToken, user: { id: user.id, email: user.email } };
};

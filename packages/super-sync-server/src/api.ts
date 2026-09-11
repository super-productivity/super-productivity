import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEmailAllowed } from './email-allowlist';
import * as jwt from 'jsonwebtoken';
import {
  verifyEmail,
  replaceToken,
  requestLoginMagicLink,
  verifyLoginMagicLink,
  registerWithMagicLink,
  getJwtSecret,
  JWT_EXPIRY,
} from './auth';
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  requestPasskeyRecovery,
  getRecoveryRegistrationOptions,
  completePasskeyRecovery,
} from './passkey';
import { authenticate, getAuthUser } from './middleware';
import { Logger } from './logger';
import { prisma } from './db';
import { authCache } from './auth-cache';
import { getWsConnectionService } from './sync/services/websocket-connection.service';

// Zod Schemas
const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Deliberately does not name the Terms of Service: an instance may publish only a
// privacy policy, in which case the consent label reads "I agree to the Privacy Policy"
// and naming a document that is not served would be wrong.
const TERMS_REQUIRED_MESSAGE = 'You must accept the linked legal documents to register';

/**
 * Registration body, with consent required only where legal pages exist. The generic image
 * ships no Terms of Service and publishes no privacy policy until the operator configures
 * `PRIVACY_*`, so an unconfigured instance must not demand agreement to documents it does
 * not serve.
 *
 * `z.literal(true)` rather than `z.boolean().optional().refine(...)` is load-bearing: in
 * zod 4 an issue raised by a refinement on an *optional* field is discarded when the key is
 * absent from the input, so the refinement form accepted `{"email":"..."}` with no consent
 * at all. A required literal has no such hole — an absent key is a type error, not a
 * skipped check. Guarded by tests/legal-pages.spec.ts.
 */
export const buildRegisterBodySchema = (
  requireConsent: boolean,
): z.ZodType<{ email: string; termsAccepted?: boolean }> =>
  z.object({
    email: z.string().email('Invalid email format'),
    termsAccepted: requireConsent
      ? z.literal(true, { message: TERMS_REQUIRED_MESSAGE })
      : z.boolean().optional(),
  });

const PasskeyRegisterVerifySchema = z.object({
  email: z.string().email('Invalid email format'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

const PasskeyLoginOptionsSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const PasskeyLoginVerifySchema = z.object({
  email: z.string().email('Invalid email format'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

const PasskeyRecoveryRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const PasskeyRecoveryOptionsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const PasskeyRecoveryCompleteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

// Magic Link Schemas
const MagicLinkRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const MagicLinkVerifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

type VerifyEmailBody = z.infer<typeof VerifyEmailSchema>;
type RegisterBody = { email: string; termsAccepted?: boolean };
type PasskeyRegisterOptionsBody = RegisterBody;
type PasskeyRegisterVerifyBody = z.infer<typeof PasskeyRegisterVerifySchema>;
type PasskeyLoginOptionsBody = z.infer<typeof PasskeyLoginOptionsSchema>;
type PasskeyLoginVerifyBody = z.infer<typeof PasskeyLoginVerifySchema>;
type PasskeyRecoveryRequestBody = z.infer<typeof PasskeyRecoveryRequestSchema>;
type PasskeyRecoveryOptionsBody = z.infer<typeof PasskeyRecoveryOptionsSchema>;
type PasskeyRecoveryCompleteBody = z.infer<typeof PasskeyRecoveryCompleteSchema>;
type MagicLinkRegisterBody = RegisterBody;
type MagicLinkRequestBody = z.infer<typeof MagicLinkRequestSchema>;
type MagicLinkVerifyBody = z.infer<typeof MagicLinkVerifySchema>;

// Known safe error messages that can be shown to clients
const SAFE_ERROR_MESSAGES = new Set([
  'Email not verified',
  'Invalid verification token',
  'Verification token has expired',
  'Registration successful. Please check your email to verify your account.',
  // Passkey-specific messages
  'Challenge expired or not found. Please try again.',
  'Passkey verification failed. Please try again.',
  'Passkey verification failed',
  'If an account with that email exists, a recovery link has been sent.',
  'Invalid or expired recovery token',
  'Passkey has been reset successfully. You can now log in with your new passkey.',
  // Magic link messages
  'If an account with that email exists, a login link has been sent.',
  'Invalid or expired login link',
]);

// Returns a safe error message for clients (hides internal details)
const getSafeErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && SAFE_ERROR_MESSAGES.has(err.message)) {
    return err.message;
  }
  return fallback;
};

export interface ApiRoutesOptions {
  /** True when this instance publishes a privacy policy, so consent can be demanded. */
  requireTermsConsent: boolean;
}

export const apiRoutes = async (
  fastify: FastifyInstance,
  opts: ApiRoutesOptions,
): Promise<void> => {
  const PasskeyRegisterOptionsSchema = buildRegisterBodySchema(opts.requireTermsConsent);
  const MagicLinkRegisterSchema = PasskeyRegisterOptionsSchema;

  // Moderate rate limiting for email verification (20 attempts per 15 minutes)
  fastify.post<{ Body: VerifyEmailBody }>(
    '/verify-email',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = VerifyEmailSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        await verifyEmail(token);
        return reply.send({ message: 'Email verified successfully' });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Verification error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Verification failed. Please try again.'),
        });
      }
    },
  );

  // Replace JWT token (requires authentication)
  // Use this when a token was accidentally shared or compromised
  fastify.post(
    '/replace-token',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const user = getAuthUser(req);
        const result = await replaceToken(user.userId, user.email);
        // Sockets authenticate only at upgrade, so revoked tokens would keep
        // receiving op notifications through already-open connections — close
        // them all, the caller's own socket included: a socket's clientId is
        // self-declared and unauthenticated, so sparing "the caller's" socket
        // by id would let a stolen-token client exempt itself by claiming it.
        // The caller reconnects with its fresh token on the next sync cycle.
        // Any request body (legacy clients sent their clientId) is ignored.
        getWsConnectionService().closeForUser(user.userId);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Token replacement error: ${errMsg}`);
        return reply.status(500).send({
          error: 'Failed to replace token. Please try again.',
        });
      }
    },
  );

  // Delete user account (requires authentication)
  // This permanently deletes the user and all associated data (operations, sync state, devices)
  fastify.delete(
    '/account',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;

        Logger.info(`[user:${userId}] DELETE ACCOUNT requested`);

        // AUTH_CACHE_INVALIDATION: account deletion must not leave a ghost-token window.
        authCache.invalidate(userId);

        // Cascade delete handles: operations, syncState, devices (via Prisma schema)
        await prisma.user.delete({ where: { id: userId } });
        // AUTH_CACHE_INVALIDATION: account deletion must not leave a ghost-token window.
        authCache.invalidate(userId);

        // The cascade removed this user's sync_devices rows, but an open socket
        // keeps answering pings, so the dead-connection branch never reaps it.
        // Its heartbeat touch would then re-INSERT a device row for a user that
        // no longer exists and trip the FK every throttle window. Closed after
        // the delete, not before: with the user row already gone no reconnect
        // can re-authenticate and re-orphan a socket.
        getWsConnectionService().closeForUser(userId);

        Logger.audit({ event: 'USER_ACCOUNT_DELETED', userId });

        return reply.send({ success: true });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Delete account error: ${errMsg}`);
        return reply.status(500).send({
          error: 'Failed to delete account. Please try again.',
        });
      }
    },
  );

  // ============================================
  // PASSKEY ENDPOINTS
  // ============================================

  // Get passkey registration options (for new user signup)
  fastify.post<{ Body: PasskeyRegisterOptionsBody }>(
    '/register/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRegisterOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const options = await generateRegistrationOptions(email);
        return reply.send(options);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey registration options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to generate registration options.'),
        });
      }
    },
  );

  // Verify passkey registration and create user
  fastify.post<{ Body: PasskeyRegisterVerifyBody }>(
    '/register/passkey/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRegisterVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email, credential } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const result = await verifyRegistration(email, credential as any, Date.now());
        return reply.status(201).send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey registration verify error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(
            err,
            'Passkey registration failed. Please try again.',
          ),
        });
      }
    },
  );

  // Get passkey authentication options (for login)
  fastify.post<{ Body: PasskeyLoginOptionsBody }>(
    '/login/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyLoginOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const options = await generateAuthenticationOptions(email);
        return reply.send(options);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey login options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to generate login options.'),
        });
      }
    },
  );

  // Verify passkey authentication and return JWT
  fastify.post<{ Body: PasskeyLoginVerifyBody }>(
    '/login/passkey/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyLoginVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email, credential } = parseResult.data;

        const userInfo = await verifyAuthentication(email, credential as any);

        // Get token version for JWT
        const user = await prisma.user.findUnique({
          where: { id: userInfo.userId },
          select: { tokenVersion: true },
        });
        const tokenVersion = user?.tokenVersion ?? 0;

        // Sign JWT (same format as password login)
        const token = jwt.sign(
          { userId: userInfo.userId, email: userInfo.email, tokenVersion },
          getJwtSecret(),
          { expiresIn: JWT_EXPIRY },
        );

        return reply.send({
          token,
          user: { id: userInfo.userId, email: userInfo.email },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey login verify error: ${errMsg}`);
        return reply.status(401).send({
          error: getSafeErrorMessage(err, 'Authentication failed'),
        });
      }
    },
  );

  // Request passkey recovery (sends magic link)
  fastify.post<{ Body: PasskeyRecoveryRequestBody }>(
    '/recover/passkey',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const result = await requestPasskeyRecovery(email);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery request error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Recovery request failed. Please try again.'),
        });
      }
    },
  );

  // Get registration options for passkey recovery
  fastify.post<{ Body: PasskeyRecoveryOptionsBody }>(
    '/recover/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        const result = await getRecoveryRegistrationOptions(token);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Invalid or expired recovery token'),
        });
      }
    },
  );

  // Complete passkey recovery (register new passkey)
  fastify.post<{ Body: PasskeyRecoveryCompleteBody }>(
    '/recover/passkey/complete',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryCompleteSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token, credential } = parseResult.data;

        const result = await completePasskeyRecovery(token, credential as any);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery complete error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Passkey recovery failed. Please try again.'),
        });
      }
    },
  );

  // ============================================
  // MAGIC LINK ENDPOINTS
  // ============================================

  // Register with magic link (email-only, no passkey)
  fastify.post<{ Body: MagicLinkRegisterBody }>(
    '/register/magic-link',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkRegisterSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const result = await registerWithMagicLink(email, Date.now());
        return reply.status(201).send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link registration error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Registration failed. Please try again.'),
        });
      }
    },
  );

  // Request magic link login email
  fastify.post<{ Body: MagicLinkRequestBody }>(
    '/login/magic-link',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const result = await requestLoginMagicLink(email);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link request error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to send login link. Please try again.'),
        });
      }
    },
  );

  // Verify magic link token and return JWT
  fastify.post<{ Body: MagicLinkVerifyBody }>(
    '/login/magic-link/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        const result = await verifyLoginMagicLink(token);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link verify error: ${errMsg}`);
        return reply.status(401).send({
          error: getSafeErrorMessage(err, 'Invalid or expired login link'),
        });
      }
    },
  );
};

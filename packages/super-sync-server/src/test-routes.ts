/**
 * Test-only routes for E2E testing.
 * These routes are only available when TEST_MODE=true.
 *
 * NEVER enable in production!
 */
import { FastifyInstance } from 'fastify';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { prisma } from './db';
import { Logger } from './logger';
import { getJwtSecret, JWT_EXPIRY } from './auth';

const BCRYPT_ROUNDS = 12;

interface CreateUserBody {
  email: string;
  password: string;
}

export const testRoutes = async (fastify: FastifyInstance): Promise<void> => {
  /**
   * Create a test user with auto-verification.
   * Returns a JWT token immediately without email verification.
   */
  fastify.post<{ Body: CreateUserBody }>(
    '/create-user',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
      // Disable rate limiting for test user creation to allow rapid E2E test execution
      config: {
        rateLimit: false,
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        let userId: number;
        let tokenVersion: number;

        if (existingUser) {
          userId = existingUser.id;
          tokenVersion = existingUser.tokenVersion ?? 0;
          Logger.info(
            `[TEST] Returning existing user: ${email} (ID: ${userId}) - Clearing old data`,
          );

          // Clear old data for this user to ensure clean state.
          // Unlike production clean-slate (which preserves lastSeq for existing clients),
          // test reset deletes everything — no existing clients need sequence continuity.
          await prisma.$transaction([
            prisma.operation.deleteMany({ where: { userId } }),
            prisma.syncDevice.deleteMany({ where: { userId } }),
            prisma.userSyncState.deleteMany({ where: { userId } }),
          ]);
        } else {
          // Create user with isVerified=1 (skip email verification)
          const user = await prisma.user.create({
            data: {
              email,
              passwordHash,
              isVerified: 1,
              verificationToken: null,
              verificationTokenExpiresAt: null,
              tokenVersion: 0,
            },
          });

          userId = user.id;
          tokenVersion = 0;
          Logger.info(`[TEST] Created test user: ${email} (ID: ${userId})`);
        }

        // Generate JWT token (include tokenVersion for consistency with auth.ts)
        const token = jwt.sign({ userId, email, tokenVersion }, getJwtSecret(), {
          expiresIn: JWT_EXPIRY,
        });

        return reply.status(201).send({
          token,
          userId,
          email,
        });
      } catch (err: unknown) {
        Logger.error('[TEST] Failed to create test user:', err);
        return reply.status(500).send({
          error: 'Failed to create test user',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * Clean up all test data.
   * Wipes users, operations, sync state, and devices.
   */
  fastify.post(
    '/cleanup',
    {
      // Disable rate limiting for cleanup endpoint
      config: {
        rateLimit: false,
      },
    },
    async (_request, reply) => {
      try {
        // Delete in correct order due to foreign key constraints (cascades usually handle it, but explicit is safer)
        await prisma.$transaction([
          prisma.operation.deleteMany(),
          prisma.syncDevice.deleteMany(),
          prisma.userSyncState.deleteMany(),
          prisma.user.deleteMany(),
        ]);

        Logger.info('[TEST] All test data cleaned up');

        return reply.send({ cleaned: true });
      } catch (err: unknown) {
        Logger.error('[TEST] Cleanup failed:', err);
        return reply.status(500).send({
          error: 'Cleanup failed',
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * Delete a test user by userId.
   * Used by E2E tests to simulate account deletion scenarios.
   */
  fastify.delete<{ Params: { userId: string } }>(
    '/user/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
          },
        },
      },
      config: {
        rateLimit: false,
      },
    },
    async (request, reply) => {
      const userId = parseInt(request.params.userId, 10);

      if (isNaN(userId)) {
        return reply.status(400).send({ error: 'Invalid userId' });
      }

      try {
        // CASCADE delete handles: operations, syncState, devices (via Prisma schema)
        await prisma.user.delete({ where: { id: userId } });
        Logger.info(`[TEST] Deleted test user ID: ${userId}`);
        return reply.send({ deleted: true, userId });
      } catch (err: unknown) {
        Logger.error('[TEST] Failed to delete test user:', err);
        return reply.status(404).send({
          error: 'User not found or already deleted',
          message: (err as Error).message,
        });
      }
    },
  );

  Logger.info('[TEST] Test routes registered at /api/test/*');
};

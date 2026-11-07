/**
 * Real-PostgreSQL coverage for the browser sign-in claim, which PGlite (one
 * connection) cannot prove: parallel polls of one approved request hand out
 * exactly one token, and a sign-out racing the claim never leaves a token that
 * outlives it.
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db
 *   (`npm run supersync:db` publishes it on 55432 and applies the schema)
 *
 * Run with:
 *   npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/connect-claim-race.integration.spec.ts
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-characters';
});

import { disconnectDb, prisma } from '../../src/db';
import { revokeAllTokens } from '../../src/auth';
import {
  approveConnectRequest,
  createConnectRequest,
  pollConnectRequest,
} from '../../src/connect/connect-request.store';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const EMAIL = `connect-race-${Date.now()}-${process.pid}@example.com`;

describeWithDb('connect claim races (real PostgreSQL)', () => {
  let userId: number;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    userId = (await prisma.user.create({ data: { email: EMAIL, isVerified: 1 } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await disconnectDb();
  });

  const approvedRequest = async () => {
    const req = await createConnectRequest({ deviceName: 'race', platform: 'web' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(
      await approveConnectRequest(req.requestId, {
        userId,
        tokenVersion: user.tokenVersion,
      }),
    ).toBe(true);
    return req;
  };

  it('hands out exactly one token for parallel polls', async () => {
    const req = await approvedRequest();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pollConnectRequest(req.requestId, req.pollSecret)),
    );
    expect(results.filter((r) => r.status === 'approved')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'expired')).toHaveLength(19);
  });

  it('never hands out a token newer than a racing sign-out', async () => {
    for (let i = 0; i < 10; i++) {
      const req = await approvedRequest();
      const [claim] = await Promise.all([
        pollConnectRequest(req.requestId, req.pollSecret),
        revokeAllTokens(userId),
      ]);
      const { tokenVersion } = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      // Either the claim lost, or its token carries the version the sign-out revoked.
      if (claim.status === 'approved')
        expect(claim.tokenVersion).toBeLessThan(tokenVersion);
      else expect(claim.status).toBe('expired');
    }
  });
});

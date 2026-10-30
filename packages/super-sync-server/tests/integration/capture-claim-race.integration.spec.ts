/**
 * Real-PostgreSQL coverage for capture races that PGlite (one connection)
 * cannot prove: concurrent claims never share an item, and concurrent
 * enqueues at the cap stop exactly at it.
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db
 *   (`npm run supersync:db` publishes it on 55432 and applies the schema)
 *
 * Run with:
 *   npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/capture-claim-race.integration.spec.ts
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-characters';
});

import { createECDH } from 'crypto';
import { disconnectDb, prisma } from '../../src/db';
import { captureKeyFingerprint } from '../../src/capture/capture-seal';
import {
  disableCaptureKey,
  registerCaptureKey,
} from '../../src/capture/capture-key.store';
import {
  authenticateCaptureToken,
  createCaptureTokenGrant,
  revokeAllCaptureGrants,
} from '../../src/capture/capture-grant.store';
import {
  approveCaptureAuthorization,
  createCaptureAuthorization,
  createCaptureConnectCode,
  exchangeCaptureAuthorization,
  refreshCaptureAuthorization,
} from '../../src/capture/capture-oauth.store';
import { pkceChallenge } from '../../src/capture/capture-oauth-token';
import {
  CapturePayload,
  claimCaptures,
  enqueueCapture,
} from '../../src/capture/capture-queue.store';
import { CAPTURE_MAX_PENDING_PER_GRANT } from '../../src/capture/capture.const';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const EMAIL = `capture-race-${Date.now()}-${process.pid}@example.com`;

const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);
const newPublicKey = (): string => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return Buffer.concat([P256_SPKI_PREFIX, ecdh.getPublicKey()]).toString('base64');
};

const payload = (title: string): CapturePayload => ({
  v: 1,
  title,
  createdAt: Date.now(),
  client: 'race',
});

describeWithDb('capture races (real PostgreSQL)', () => {
  let userId: number;
  let grantId: string;
  let fingerprint: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    userId = (await prisma.user.create({ data: { email: EMAIL, isVerified: 1 } })).id;
    const publicKey = newPublicKey();
    fingerprint = captureKeyFingerprint(publicKey);
    await registerCaptureKey(userId, publicKey);
    grantId = (await createCaptureTokenGrant(userId, 'race')).grant.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await disconnectDb();
  });

  const signingKey = 'integration-test-jwt-secret-at-least-32-characters';
  const authorizationInput = {
    clientId: 'https://client.example/metadata',
    clientName: 'race',
    redirectUri: 'https://client.example/callback',
    resource: 'https://sync.example/mcp',
    verifier: 'v'.repeat(43),
  };
  const approvedCode = async (): Promise<string> => {
    const id = await createCaptureAuthorization({
      ...authorizationInput,
      state: 'race',
      scope: 'tasks:capture offline_access',
      codeChallenge: pkceChallenge(authorizationInput.verifier),
    });
    const connect = await createCaptureConnectCode(userId, 0);
    const redirect = await approveCaptureAuthorization(
      id,
      connect!.code,
      'https://sync.example',
    );
    return new URL(redirect!).searchParams.get('code')!;
  };

  it('issues one grant for concurrent exchanges and one successor for concurrent refreshes', async () => {
    const code = await approvedCode();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        exchangeCaptureAuthorization({ ...authorizationInput, code }, signingKey),
      ),
    );
    const issued = results.filter((r) => r !== null);
    expect(issued).toHaveLength(1);
    const refresh = issued[0]!.refresh_token!;
    const refreshed = await Promise.all(
      Array.from({ length: 4 }, () =>
        refreshCaptureAuthorization(
          refresh,
          authorizationInput.clientId,
          authorizationInput.resource,
          signingKey,
        ),
      ),
    );
    expect(refreshed.every((r) => r !== null)).toBe(true);
    expect(new Set(refreshed.map((r) => r!.refresh_token)).size).toBe(1);
    expect(new Set(refreshed.map((r) => r!.access_token)).size).toBe(1);
  });

  it('rejects an in-flight exchange after sign-out commits', async () => {
    const code = await approvedCode();
    let release: () => void = () => undefined;
    let locked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        locked();
        await held;
        await tx.user.update({
          where: { id: userId },
          data: { tokenVersion: { increment: 1 } },
        });
        await revokeAllCaptureGrants(tx, userId);
      },
      { timeout: 10000 },
    );
    await ready;
    const exchange = exchangeCaptureAuthorization(
      { ...authorizationInput, code },
      signingKey,
    );
    try {
      // Observe the real exchange waiting on our user lock, not a mocked store seam.
      await expect
        .poll(
          async () => {
            const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE '%SELECT token_version FROM users%FOR SHARE%'`;
            return Number(rows[0].count);
          },
          { timeout: 3000 },
        )
        .toBeGreaterThan(0);
    } finally {
      release();
      await blocker;
    }
    expect(await exchange).toBeNull();
    expect(
      await exchangeCaptureAuthorization({ ...authorizationInput, code }, signingKey),
    ).toBeNull();
  });

  it('feature-off racing refresh leaves no usable access or refresh token', async () => {
    const first = await exchangeCaptureAuthorization(
      { ...authorizationInput, code: await approvedCode() },
      signingKey,
    );
    let release: () => void = () => undefined;
    let locked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT user_id FROM capture_keys WHERE user_id = ${userId} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 10000 },
    );
    const waitForKeyLock = async (queryPattern: string): Promise<void> => {
      await expect
        .poll(
          async () => {
            const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
              SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
                AND wait_event_type = 'Lock' AND query LIKE ${queryPattern}`;
            return Number(rows[0].count);
          },
          { timeout: 1500 },
        )
        .toBeGreaterThan(0);
    };
    await ready;
    const disabled = disableCaptureKey(userId);
    let refreshing: ReturnType<typeof refreshCaptureAuthorization> | undefined;
    try {
      await waitForKeyLock('%UPDATE capture_keys SET disabled_at%');
      refreshing = refreshCaptureAuthorization(
        first!.refresh_token!,
        authorizationInput.clientId,
        authorizationInput.resource,
        signingKey,
      );
      // Both operations are in flight; PostgreSQL queues refresh behind feature-off.
      await waitForKeyLock('%SELECT user_id FROM capture_keys%FOR SHARE%');
    } finally {
      release();
      await blocker;
      await disabled;
    }
    expect(await refreshing).toBeNull();
    expect(await authenticateCaptureToken(first!.access_token)).toBeNull();
    expect(
      await refreshCaptureAuthorization(
        first!.refresh_token!,
        authorizationInput.clientId,
        authorizationInput.resource,
        signingKey,
      ),
    ).toBeNull();
  });

  it('never leases one item to two devices claiming at once', async () => {
    await prisma.$executeRaw`
      INSERT INTO capture_items (id, user_id, grant_id, ciphertext, task_id, created_at)
      SELECT 'race-' || i, ${userId}, ${grantId}, 'x', 'race-' || i, i
      FROM generate_series(1, 120) AS i`;

    const claims = await Promise.all(
      ['dev-a', 'dev-b', 'dev-c', 'dev-d'].map((device) =>
        claimCaptures(userId, device, fingerprint),
      ),
    );
    const itemIds = claims.flatMap((claim) =>
      claim.status === 'ok' ? claim.items.map((item) => item.itemId) : [],
    );
    expect(new Set(itemIds).size).toBe(itemIds.length);
    // SKIP LOCKED may leave a device short; it never hands out more than exist.
    expect(itemIds.length).toBeLessThanOrEqual(120);
    expect(itemIds.length).toBeGreaterThan(0);
  });

  it('stops concurrent enqueues exactly at the per-grant cap', async () => {
    const prefill = CAPTURE_MAX_PENDING_PER_GRANT - 5;
    await prisma.$executeRaw`
      INSERT INTO capture_items (id, user_id, grant_id, ciphertext, task_id, created_at)
      SELECT 'cap-' || i, ${userId}, ${grantId}, 'x', 'cap-' || i, i
      FROM generate_series(1, ${prefill}) AS i`;

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        enqueueCapture(userId, grantId, payload(`t${i}`)),
      ),
    );
    expect(results.filter((r) => r === 'queued')).toHaveLength(5);
    expect(results.filter((r) => r === 'queue_full')).toHaveLength(7);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { captureKeyFingerprint } from '../src/capture/capture-seal';
import { disableCaptureKey, registerCaptureKey } from '../src/capture/capture-key.store';
import {
  authenticateCaptureToken,
  createCaptureTokenGrant,
  deleteDeadCaptureGrants,
  listCaptureGrants,
  revokeAllCaptureGrants,
  revokeCaptureGrant,
} from '../src/capture/capture-grant.store';
import {
  ackCaptures,
  CapturePayload,
  claimCaptures,
  deleteExpiredCaptures,
  enqueueCapture,
} from '../src/capture/capture-queue.store';
import { CAPTURE_LEASE_MS } from '../src/capture/capture.const';
import {
  addUser,
  createCapturePrisma,
  createCaptureSchema,
  newCaptureKeyPair,
  openCapture,
} from './capture-pglite.helper';

/** The capture stores' shipped SQL on PGlite, against the shipped migration. */

const mocked = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }));
vi.mock('../src/db', () => ({ prisma: mocked.prisma }));

const NOW = 1_800_000_000_000;
const payload = (title: string): CapturePayload => ({
  v: 1,
  title,
  createdAt: NOW,
  client: 'Claude',
});

describe('capture stores (PGlite)', () => {
  let db: PGlite;
  let userId: number;
  let key: ReturnType<typeof newCaptureKeyPair>;
  let fingerprint: string;

  const count = async (table: string): Promise<number> =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

  /** Bulk rows for the caps, without paying for a seal each. */
  const fillQueue = async (grantId: string, n: number): Promise<void> => {
    await db.query(
      `INSERT INTO capture_items (id, user_id, grant_id, ciphertext, task_id, created_at)
       SELECT 'fill-' || $2 || '-' || i, $1, $2, 'x', 'fill-' || $2 || '-' || i, $3
       FROM generate_series(1, $4) AS i`,
      [userId, grantId, NOW, n],
    );
  };

  const newGrant = async (): Promise<string> =>
    (await createCaptureTokenGrant(userId, 'Claude', NOW)).grant.id;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    Object.assign(mocked.prisma, createCapturePrisma(db));
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await createCaptureSchema(db);
    userId = await addUser(db, 'a@example.com');
    key = newCaptureKeyPair();
    fingerprint = captureKeyFingerprint(key.publicKey);
    await registerCaptureKey(userId, key.publicKey, NOW);
  });

  it('seals each item to the user key, bound to its id, with taskId = itemId', async () => {
    const grantId = await newGrant();
    expect(await enqueueCapture(userId, grantId, payload('Buy milk'))).toBe('queued');

    const claimed = await claimCaptures(userId, 'dev-a', fingerprint, NOW);
    if (claimed.status !== 'ok') throw new Error(claimed.status);
    const [item] = claimed.items;
    expect(item.taskId).toBe(item.itemId);
    expect(openCapture(key.ecdh, item.itemId, item.ciphertext)).toEqual(
      payload('Buy milk'),
    );
  });

  it('refuses to enqueue without an active key', async () => {
    const other = await addUser(db, 'b@example.com');
    const grantId = (await createCaptureTokenGrant(other, 'Claude', NOW)).grant.id;
    expect(await enqueueCapture(other, grantId, payload('x'))).toBe('switched_off');
    expect(await claimCaptures(other, 'dev-a', fingerprint, NOW)).toEqual({
      status: 'no_key',
    });
  });

  it('refuses to enqueue under a grant revoked after auth', async () => {
    const grantId = await newGrant();
    await revokeCaptureGrant(userId, grantId, true, NOW);
    expect(await enqueueCapture(userId, grantId, payload('x'))).toBe('revoked');
    expect(await count('capture_items')).toBe(0);
  });

  it('caps pending items per grant (200) and per user (500)', async () => {
    const grantA = await newGrant();
    await fillQueue(grantA, 199);
    expect(await enqueueCapture(userId, grantA, payload('200th'))).toBe('queued');
    expect(await enqueueCapture(userId, grantA, payload('201st'))).toBe('queue_full');

    const grantB = await newGrant();
    await fillQueue(grantB, 199);
    const grantC = await newGrant();
    await fillQueue(grantC, 100);
    expect(await enqueueCapture(userId, grantC, payload('500th'))).toBe('queued');
    expect(await enqueueCapture(userId, grantC, payload('501st'))).toBe('queue_full');
  });

  it('gives a device its own leases back first, with the same task ids', async () => {
    const grantId = await newGrant();
    await fillQueue(grantId, 60);
    const first = await claimCaptures(userId, 'dev-a', fingerprint, NOW);
    const second = await claimCaptures(userId, 'dev-b', fingerprint, NOW);
    const again = await claimCaptures(userId, 'dev-a', fingerprint, NOW + 1);
    if (first.status !== 'ok' || second.status !== 'ok' || again.status !== 'ok') {
      throw new Error('claim failed');
    }
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(10);
    expect(again.items.map((i) => [i.itemId, i.taskId])).toEqual(
      first.items.map((i) => [i.itemId, i.taskId]),
    );
  });

  it('issues a new task id on takeover, so a stale ack deletes nothing (A→B→A)', async () => {
    const grantId = await newGrant();
    await enqueueCapture(userId, grantId, payload('x'));
    const leaseA1 = await claimCaptures(userId, 'dev-a', fingerprint, NOW);
    const leaseB = await claimCaptures(
      userId,
      'dev-b',
      fingerprint,
      NOW + CAPTURE_LEASE_MS + 1,
    );
    const leaseA2 = await claimCaptures(
      userId,
      'dev-a',
      fingerprint,
      NOW + 2 * CAPTURE_LEASE_MS + 2,
    );
    if (leaseA1.status !== 'ok' || leaseB.status !== 'ok' || leaseA2.status !== 'ok') {
      throw new Error('claim failed');
    }
    const [a1, b, a2] = [leaseA1.items[0], leaseB.items[0], leaseA2.items[0]];
    expect(new Set([a1.taskId, b.taskId, a2.taskId]).size).toBe(3);

    expect(await ackCaptures(userId, 'dev-a', [a1])).toBe(0);
    expect(await ackCaptures(userId, 'dev-b', [b])).toBe(0);
    expect(await ackCaptures(userId, 'dev-a', [a2])).toBe(1);
    expect(await count('capture_items')).toBe(0);
  });

  it('refuses a claim under another key', async () => {
    expect(await claimCaptures(userId, 'dev-a', 'other', NOW)).toEqual({
      status: 'key_mismatch',
    });
  });

  it('drops pending items when the key is replaced', async () => {
    const grantId = await newGrant();
    await enqueueCapture(userId, grantId, payload('x'));
    expect(await registerCaptureKey(userId, key.publicKey, NOW)).toEqual({
      status: 'unchanged',
      discarded: 0,
    });
    const next = newCaptureKeyPair();
    expect(await registerCaptureKey(userId, next.publicKey, NOW)).toEqual({
      status: 'registered',
      discarded: 1,
    });
  });

  it('switching off drops items, revokes grants and refuses the same key again', async () => {
    const { token, grant } = await createCaptureTokenGrant(userId, 'Claude', NOW);
    await enqueueCapture(userId, grant.id, payload('x'));
    expect(await disableCaptureKey(userId, NOW)).toEqual({ discarded: 1 });
    expect(await authenticateCaptureToken(token, NOW)).toBeNull();
    expect(await registerCaptureKey(userId, key.publicKey, NOW)).toEqual({
      status: 'disabled',
    });
    // A new key is a deliberate re-enable.
    expect(
      (await registerCaptureKey(userId, newCaptureKeyPair().publicKey, NOW)).status,
    ).toBe('registered');
  });

  it('revokes one grant, keeping or discarding its pending items', async () => {
    const keep = await createCaptureTokenGrant(userId, 'Keep', NOW);
    const drop = await createCaptureTokenGrant(userId, 'Drop', NOW);
    await enqueueCapture(userId, keep.grant.id, payload('k'));
    await enqueueCapture(userId, drop.grant.id, payload('d'));
    expect((await listCaptureGrants(userId, NOW)).map((g) => g.pendingCount)).toEqual([
      1, 1,
    ]);

    expect(await revokeCaptureGrant(userId, keep.grant.id, false, NOW)).toEqual({
      discarded: 0,
    });
    expect(await revokeCaptureGrant(userId, drop.grant.id, true, NOW)).toEqual({
      discarded: 1,
    });
    expect(await revokeCaptureGrant(userId, drop.grant.id, true, NOW)).toBeNull();
    expect(await authenticateCaptureToken(keep.token, NOW)).toBeNull();
    expect(await listCaptureGrants(userId, NOW)).toEqual([]);
    expect(await count('capture_items')).toBe(1);
  });

  it("does not let a user revoke another user's grant", async () => {
    const grantId = await newGrant();
    const other = await addUser(db, 'b@example.com');
    expect(await revokeCaptureGrant(other, grantId, true, NOW)).toBeNull();
  });

  it('revokeAll kills every grant of the user', async () => {
    const a = await createCaptureTokenGrant(userId, 'A', NOW);
    const b = await createCaptureTokenGrant(userId, 'B', NOW);
    await (
      mocked.prisma as unknown as {
        $transaction: (
          fn: (tx: Prisma.TransactionClient) => Promise<void>,
        ) => Promise<void>;
      }
    ).$transaction((tx) => revokeAllCaptureGrants(tx, userId, NOW));
    expect(await authenticateCaptureToken(a.token, NOW)).toBeNull();
    expect(await authenticateCaptureToken(b.token, NOW)).toBeNull();
  });

  it('authenticates only a live token with the right secret', async () => {
    const { token, grant } = await createCaptureTokenGrant(userId, 'Claude', NOW);
    expect(await authenticateCaptureToken(token, NOW)).toEqual({
      grantId: grant.id,
      userId,
      clientName: 'Claude',
    });
    expect(await authenticateCaptureToken(`${token}x`, NOW)).toBeNull();
    expect(await authenticateCaptureToken(token, grant.expiresAt)).toBeNull();
  });

  it('cascades on account deletion', async () => {
    const grantId = await newGrant();
    await enqueueCapture(userId, grantId, payload('x'));
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    for (const table of ['capture_items', 'capture_grants', 'capture_keys']) {
      expect(await count(table)).toBe(0);
    }
  });

  it('cleanup drops expired items and dead grants', async () => {
    const live = await createCaptureTokenGrant(userId, 'Live', NOW);
    const revoked = await newGrant();
    await revokeCaptureGrant(userId, revoked, false, NOW);
    await enqueueCapture(userId, live.grant.id, payload('x'));

    expect(await deleteExpiredCaptures(NOW)).toBe(0);
    expect(await deleteExpiredCaptures(NOW + 1)).toBe(1);
    expect(await deleteDeadCaptureGrants(NOW)).toBe(1);
    expect(await authenticateCaptureToken(live.token, NOW)).not.toBeNull();
    expect(await deleteDeadCaptureGrants(live.grant.expiresAt)).toBe(1);
  });
});

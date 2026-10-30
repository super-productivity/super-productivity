import { prisma } from '../db';
import { captureKeyFingerprint } from './capture-seal';
import { revokeAllCaptureGrants } from './capture-grant.store';

/**
 * The user's registered capture public key. Raw SQL throughout so the
 * PGlite specs run the shipped statements.
 */

export type RegisterCaptureKeyResult =
  | { status: 'registered' | 'unchanged'; discarded: number }
  | { status: 'disabled' };

interface KeyRow {
  fingerprint: string;
  disabled_at: bigint | null;
}

/**
 * Same fingerprint: no-op. A different key replaces the old one and drops
 * the items sealed to it, which nobody holding the new key can open. The
 * same fingerprint as a switched-off key is refused, so a stale device can't
 * turn the feature back on.
 */
export const registerCaptureKey = async (
  userId: number,
  publicKey: string,
  now: number = Date.now(),
): Promise<RegisterCaptureKeyResult> => {
  const fingerprint = captureKeyFingerprint(publicKey);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<KeyRow[]>`
      SELECT fingerprint, disabled_at FROM capture_keys
      WHERE user_id = ${userId} FOR UPDATE`;
    const current = rows[0];
    if (current?.fingerprint === fingerprint) {
      return current.disabled_at === null
        ? { status: 'unchanged', discarded: 0 }
        : { status: 'disabled' };
    }
    await tx.$executeRaw`
      INSERT INTO capture_keys (user_id, public_key, fingerprint, created_at)
      VALUES (${userId}, ${publicKey}, ${fingerprint}, ${BigInt(now)})
      ON CONFLICT (user_id) DO UPDATE SET
        public_key = EXCLUDED.public_key,
        fingerprint = EXCLUDED.fingerprint,
        created_at = EXCLUDED.created_at,
        disabled_at = NULL`;
    const discarded = await tx.$executeRaw`
      DELETE FROM capture_items WHERE user_id = ${userId}`;
    return { status: 'registered', discarded };
  });
};

/** Feature off: marks the key disabled, drops pending items and revokes every grant. */
export const disableCaptureKey = async (
  userId: number,
  now: number = Date.now(),
): Promise<{ discarded: number }> =>
  prisma.$transaction(async (tx) => {
    // Lock order key, grants, items: the order enqueue and revoke use.
    await tx.$executeRaw`
      UPDATE capture_keys SET disabled_at = ${BigInt(now)}
      WHERE user_id = ${userId} AND disabled_at IS NULL`;
    await revokeAllCaptureGrants(tx, userId, now);
    const discarded = await tx.$executeRaw`
      DELETE FROM capture_items WHERE user_id = ${userId}`;
    return { discarded };
  });

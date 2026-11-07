import { Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { prisma } from '../db';

/**
 * Browser sign-in of a new device. The app creates a request and polls it with
 * its secret; the browser page, logged in as the user, approves it; the next
 * poll claims a normal account token once. No token is stored.
 *
 * Every sign-out path bumps the user's token version; the claim compares it with
 * the version stored at approval, so a sign-out in between stops the claim.
 * Lock order is user row, then request row.
 */

type Tx = Prisma.TransactionClient;

export const CONNECT_REQUEST_TTL_MS = 10 * 60 * 1000;
export const CONNECT_POLL_INTERVAL_MS = 3000;
export const CONNECT_PLATFORMS = [
  'android',
  'ios',
  'mac',
  'windows',
  'linux',
  'web',
] as const;
export type ConnectPlatform = (typeof CONNECT_PLATFORMS)[number];

/** 16 random bytes, base64url. */
export const CONNECT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** 32 random bytes, base64url. */
export const CONNECT_POLL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// No 0/O, 1/I/L: the user compares it by eye between two screens.
const MATCH_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const newMatchCode = (): string => {
  const chars = Array.from(
    randomBytes(6),
    (b) => MATCH_CODE_ALPHABET[b % MATCH_CODE_ALPHABET.length],
  ).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
};

interface RequestRow {
  poll_secret_hash: string;
  match_code: string;
  device_name: string;
  platform: string;
  status: 'pending' | 'approved' | 'denied' | 'claimed';
  user_id: number | null;
  token_version: number | null;
  expires_at: bigint;
}

export interface CreatedConnectRequest {
  requestId: string;
  pollSecret: string;
  matchCode: string;
  expiresAt: number;
}

export const createConnectRequest = async (
  device: { deviceName: string; platform: ConnectPlatform },
  now = Date.now(),
): Promise<CreatedConnectRequest> => {
  const requestId = randomBytes(16).toString('base64url');
  const pollSecret = randomBytes(32).toString('base64url');
  const matchCode = newMatchCode();
  const expiresAt = now + CONNECT_REQUEST_TTL_MS;
  await deleteExpiredConnectRequests(now);
  await prisma.$executeRaw`
    INSERT INTO connect_requests
      (id, poll_secret_hash, match_code, device_name, platform, expires_at)
    VALUES (${requestId}, ${sha256Hex(pollSecret)}, ${matchCode}, ${device.deviceName},
      ${device.platform}, ${BigInt(expiresAt)})`;
  return { requestId, pollSecret, matchCode, expiresAt };
};

/** What the browser page shows before Connect; null once it can't be approved. */
export const getPendingConnectRequest = async (
  requestId: string,
  now = Date.now(),
): Promise<{ deviceName: string; platform: string; matchCode: string } | null> => {
  const rows = await prisma.$queryRaw<RequestRow[]>`
    SELECT device_name, platform, match_code FROM connect_requests
    WHERE id = ${requestId} AND status = 'pending' AND expires_at > ${BigInt(now)}`;
  const row = rows[0];
  return row
    ? { deviceName: row.device_name, platform: row.platform, matchCode: row.match_code }
    : null;
};

/** The id while its request can still be approved, so emails never link a dead one. */
export const pendingConnectRequestId = async (
  requestId: string | undefined,
): Promise<string | undefined> =>
  requestId && (await getPendingConnectRequest(requestId)) ? requestId : undefined;

/** Verified user's token version, locked against a concurrent sign-out. */
const lockVerifiedUser = async (
  tx: Tx,
  userId: number,
): Promise<{ email: string; tokenVersion: number } | null> => {
  const users = await tx.$queryRaw<Array<{ email: string; token_version: number }>>`
    SELECT email, token_version FROM users
    WHERE id = ${userId} AND is_verified = 1 FOR SHARE`;
  return users[0]
    ? { email: users[0].email, tokenVersion: users[0].token_version }
    : null;
};

/**
 * Binds a pending request to the logged-in account. Refuses when the account
 * signed out since the page's token was issued, so the claim can't outlive it.
 */
export const approveConnectRequest = async (
  requestId: string,
  approver: { userId: number; tokenVersion: number },
  now = Date.now(),
): Promise<boolean> =>
  prisma.$transaction(async (tx) => {
    const user = await lockVerifiedUser(tx, approver.userId);
    if (!user || user.tokenVersion !== approver.tokenVersion) return false;
    const updated = await tx.$executeRaw`
      UPDATE connect_requests
      SET status = 'approved', user_id = ${approver.userId}, token_version = ${user.tokenVersion}
      WHERE id = ${requestId} AND status = 'pending' AND expires_at > ${BigInt(now)}`;
    return updated === 1;
  });

/** Denies a pending request, or one this account approved but the app hasn't claimed. */
export const cancelConnectRequest = async (
  requestId: string,
  userId: number,
  now = Date.now(),
): Promise<boolean> => {
  const updated = await prisma.$executeRaw`
    UPDATE connect_requests SET status = 'denied'
    WHERE id = ${requestId} AND expires_at > ${BigInt(now)}
      AND (status = 'pending' OR (status = 'approved' AND user_id = ${userId}))`;
  return updated === 1;
};

export type ConnectPollResult =
  | { status: 'pending' | 'denied' | 'expired' }
  | { status: 'approved'; userId: number; email: string; tokenVersion: number };

const isSecretValid = (secret: string, storedHash: string): boolean =>
  timingSafeEqual(Buffer.from(sha256Hex(secret), 'hex'), Buffer.from(storedHash, 'hex'));

/**
 * The app's poll. An approved request is claimed here exactly once. Unknown id,
 * wrong secret, already claimed and signed out since approval all read as
 * expired, so a poller learns nothing about requests it didn't create.
 */
export const pollConnectRequest = async (
  requestId: string,
  pollSecret: string,
  now = Date.now(),
): Promise<ConnectPollResult> =>
  prisma.$transaction(async (tx): Promise<ConnectPollResult> => {
    const expired = { status: 'expired' } as const;
    const peek = await tx.$queryRaw<RequestRow[]>`
      SELECT user_id FROM connect_requests WHERE id = ${requestId}`;
    if (!peek[0]) return expired;
    const userId = peek[0].user_id;
    const user = userId ? await lockVerifiedUser(tx, userId) : null;
    const rows = await tx.$queryRaw<RequestRow[]>`
      SELECT * FROM connect_requests WHERE id = ${requestId} FOR UPDATE`;
    const row = rows[0];
    if (!row || !isSecretValid(pollSecret, row.poll_secret_hash)) return expired;
    if (Number(row.expires_at) <= now || row.status === 'claimed') return expired;
    if (row.status !== 'approved') return { status: row.status };
    if (
      !user ||
      !userId ||
      row.user_id !== userId ||
      row.token_version !== user.tokenVersion
    ) {
      return expired;
    }
    await tx.$executeRaw`
      UPDATE connect_requests SET status = 'claimed' WHERE id = ${requestId}`;
    return {
      status: 'approved',
      userId,
      email: user.email,
      tokenVersion: user.tokenVersion,
    };
  });

export const deleteExpiredConnectRequests = async (now = Date.now()): Promise<number> =>
  prisma.$executeRaw`DELETE FROM connect_requests WHERE expires_at <= ${BigInt(now)}`;

import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { CAPTURE_TOKEN_TTL_MS } from './capture.const';
import {
  isCaptureSecretValid,
  mintCaptureToken,
  parseCaptureToken,
} from './capture-token';

/** Capture grants: who may add tasks. Tokens now; OAuth grants share the revoke path. */

export interface CaptureGrantInfo {
  id: string;
  kind: string;
  clientName: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
  pendingCount: number;
}

export interface AuthenticatedGrant {
  grantId: string;
  userId: number;
  clientName: string;
}

type Tx = Prisma.TransactionClient;

export const createCaptureTokenGrant = async (
  userId: number,
  clientName: string,
  now: number = Date.now(),
): Promise<{ token: string; grant: CaptureGrantInfo }> => {
  const { grantId, token, secretHash } = mintCaptureToken();
  const expiresAt = now + CAPTURE_TOKEN_TTL_MS;
  await prisma.$executeRaw`
    INSERT INTO capture_grants
      (id, user_id, kind, client_name, secret_hash, created_at, expires_at)
    VALUES (${grantId}, ${userId}, 'token', ${clientName}, ${secretHash},
      ${BigInt(now)}, ${BigInt(expiresAt)})`;
  return {
    token,
    grant: {
      id: grantId,
      kind: 'token',
      clientName,
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      pendingCount: 0,
    },
  };
};

export const listCaptureGrants = async (
  userId: number,
  now: number = Date.now(),
): Promise<CaptureGrantInfo[]> => {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      kind: string;
      client_name: string;
      created_at: bigint;
      last_used_at: bigint | null;
      expires_at: bigint;
      pending_count: bigint;
    }>
  >`
    SELECT g.id, g.kind, g.client_name, g.created_at, g.last_used_at, COALESCE(g.refresh_expires_at, g.expires_at) AS expires_at,
      (SELECT count(*) FROM capture_items i
        WHERE i.user_id = g.user_id AND i.grant_id = g.id) AS pending_count
    FROM capture_grants g
    WHERE g.user_id = ${userId} AND g.revoked_at IS NULL AND COALESCE(g.refresh_expires_at, g.expires_at) > ${BigInt(now)}
    ORDER BY g.created_at`;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    clientName: row.client_name,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    expiresAt: Number(row.expires_at),
    pendingCount: Number(row.pending_count),
  }));
};

/** Returns null when the grant is unknown or already revoked. */
export const revokeCaptureGrant = async (
  userId: number,
  grantId: string,
  discardPending: boolean,
  now: number = Date.now(),
): Promise<{ discarded: number } | null> =>
  prisma.$transaction(async (tx) => {
    const revoked = await tx.$executeRaw`
      UPDATE capture_grants SET revoked_at = ${BigInt(now)}
      WHERE id = ${grantId} AND user_id = ${userId} AND revoked_at IS NULL`;
    if (revoked === 0) return null;
    const discarded = discardPending
      ? await tx.$executeRaw`
          DELETE FROM capture_items WHERE user_id = ${userId} AND grant_id = ${grantId}`
      : 0;
    return { discarded };
  });

/**
 * Part of every "sign out everywhere" path: revokeAllTokens, replaceToken,
 * passkey recovery and switching capture off. Pending items stay; the
 * devices still import them.
 */
export const revokeAllCaptureGrants = async (
  tx: Tx,
  userId: number,
  now: number = Date.now(),
): Promise<void> => {
  await tx.$executeRaw`
    UPDATE capture_grants SET revoked_at = ${BigInt(now)}
    WHERE user_id = ${userId} AND revoked_at IS NULL`;
  await tx.$executeRaw`DELETE FROM capture_connect_codes WHERE user_id = ${userId}`;
  await tx.$executeRaw`DELETE FROM capture_auth WHERE user_id = ${userId}`;
};

export const authenticateCaptureToken = async (
  token: string,
  now: number = Date.now(),
  resource?: string,
): Promise<AuthenticatedGrant | null> => {
  const parsed = parseCaptureToken(token);
  if (!parsed) return null;
  const rows = await prisma.$queryRaw<
    Array<{
      user_id: number;
      client_name: string;
      secret_hash: string;
      kind: string;
      resource: string | null;
    }>
  >`
    SELECT user_id, client_name, secret_hash, kind, resource FROM capture_grants
    WHERE id = ${parsed.grantId} AND revoked_at IS NULL AND expires_at > ${BigInt(now)}`;
  const row = rows[0];
  if (row?.kind === 'oauth' && resource !== undefined && row.resource !== resource)
    return null;
  if (!row || !isCaptureSecretValid(parsed.secret, row.secret_hash)) return null;
  return { grantId: parsed.grantId, userId: row.user_id, clientName: row.client_name };
};

export const touchCaptureGrant = async (
  grantId: string,
  now: number = Date.now(),
): Promise<void> => {
  // Hourly precision is enough for "last used" and spares a write per call.
  await prisma.$executeRaw`
    UPDATE capture_grants SET last_used_at = ${BigInt(now)}
    WHERE id = ${grantId}
      AND (last_used_at IS NULL OR last_used_at < ${BigInt(now - 60 * 60 * 1000)})`;
};

/** Revoked and expired grants can never authenticate again. */
export const deleteDeadCaptureGrants = async (now: number): Promise<number> => {
  await prisma.$executeRaw`DELETE FROM capture_auth WHERE expires_at <= ${BigInt(now)}`;
  await prisma.$executeRaw`DELETE FROM capture_connect_codes WHERE expires_at <= ${BigInt(now)}`;
  return prisma.$executeRaw`
    DELETE FROM capture_grants
    WHERE revoked_at IS NOT NULL OR COALESCE(refresh_expires_at, expires_at) <= ${BigInt(now)}`;
};

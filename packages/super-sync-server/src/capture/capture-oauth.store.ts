import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { prisma } from '../db';
import { hashCaptureSecret, isCaptureSecretValid } from './capture-token';
import {
  CaptureReviewAccess,
  isCaptureReviewCode,
  normalizeCaptureCode,
} from './capture-review';
import { Logger } from '../logger';
import {
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  REFRESH_GRACE_MS,
  randomOAuthSecret,
  pkceChallenge,
  newRefreshSecret,
  nextRefreshSecret,
  parseRefreshToken,
  oauthAccessHash,
  oauthTokenPair,
} from './capture-oauth-token';

type Tx = Prisma.TransactionClient;
const CONNECT_TTL_MS = 10 * 60 * 1000;

/** Lock before auth/code/grant rows. Sign-out locks the user; feature-off locks the key. */
const lockCaptureUser = async (tx: Tx, userId: number): Promise<number | null> => {
  const users = await tx.$queryRaw<Array<{ token_version: number }>>`
    SELECT token_version FROM users WHERE id = ${userId} AND is_verified = 1 FOR SHARE`;
  if (!users[0]) return null;
  const keys = await tx.$queryRaw<Array<{ user_id: number }>>`
    SELECT user_id FROM capture_keys WHERE user_id = ${userId} AND disabled_at IS NULL FOR SHARE`;
  return keys.length ? users[0].token_version : null;
};

export const createCaptureConnectCode = async (
  userId: number,
  expectedTokenVersion: number,
  now = Date.now(),
): Promise<{ code: string; expiresAt: number } | null> =>
  prisma.$transaction(async (tx) => {
    const tokenVersion = await lockCaptureUser(tx, userId);
    if (tokenVersion === null || tokenVersion !== expectedTokenVersion) return null;
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const raw = Array.from(randomBytes(10), (b) => alphabet[b & 31]).join('');
    const expiresAt = now + CONNECT_TTL_MS;
    await tx.$executeRaw`
      INSERT INTO capture_connect_codes (user_id, code_hash, token_version, expires_at)
      VALUES (${userId}, ${hashCaptureSecret(raw)}, ${tokenVersion}, ${BigInt(expiresAt)})
      ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
        token_version = EXCLUDED.token_version, expires_at = EXCLUDED.expires_at`;
    return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
  });

export interface CaptureAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  state: string;
  scope: string;
}

interface AuthRow {
  user_id: number | null;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  state: string;
  scope: string;
  code_hash: string | null;
  token_version: number | null;
  expires_at: bigint;
}

export const createCaptureAuthorization = async (
  auth: CaptureAuthorization,
  now = Date.now(),
): Promise<string> => {
  const id = randomOAuthSecret();
  await prisma.$executeRaw`
    INSERT INTO capture_auth
      (id, client_id, client_name, redirect_uri, code_challenge, resource, state, scope, expires_at)
    VALUES (${id}, ${auth.clientId}, ${auth.clientName}, ${auth.redirectUri},
      ${auth.codeChallenge}, ${auth.resource}, ${auth.state}, ${auth.scope}, ${BigInt(now + CONNECT_TTL_MS)})`;
  return id;
};

/** The account a consent-page code approves for, before its checks run. */
interface ApprovingCode {
  userId: number;
  /** A connect code is only good for the token version it was minted under. */
  tokenVersion?: number;
  isReview: boolean;
}

export const approveCaptureAuthorization = async (
  authId: string,
  code: string,
  issuer: string,
  review?: CaptureReviewAccess,
  now = Date.now(),
): Promise<string | null> => {
  const codeHash = hashCaptureSecret(normalizeCaptureCode(code));
  // Connect codes are 10 characters and review codes at least 20, so one
  // submitted code can never match both.
  const isReview = isCaptureReviewCode(review, code);
  return prisma.$transaction(async (tx) => {
    let approving: ApprovingCode;
    if (isReview) {
      const users = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM users WHERE email = ${review.email}`;
      if (!users[0]) return null;
      approving = { userId: users[0].id, isReview: true };
    } else {
      const codes = await tx.$queryRaw<Array<{ user_id: number; token_version: number }>>`
        SELECT user_id, token_version FROM capture_connect_codes
        WHERE code_hash = ${codeHash} AND expires_at > ${BigInt(now)}`;
      if (!codes[0]) return null;
      approving = {
        userId: codes[0].user_id,
        tokenVersion: codes[0].token_version,
        isReview: false,
      };
    }
    // Verified, capture switched on, and (for a connect code) not signed out since.
    const version = await lockCaptureUser(tx, approving.userId);
    if (
      version === null ||
      (approving.tokenVersion !== undefined && version !== approving.tokenVersion)
    )
      return null;
    const rows = await tx.$queryRaw<AuthRow[]>`
      SELECT * FROM capture_auth WHERE id = ${authId} FOR UPDATE`;
    const auth = rows[0];
    if (!auth || auth.code_hash || Number(auth.expires_at) <= now) return null;
    // A connect code is single use; the review code stays valid until unset.
    if (!approving.isReview) {
      const consumed = await tx.$executeRaw`
        DELETE FROM capture_connect_codes WHERE user_id = ${approving.userId}
          AND code_hash = ${codeHash} AND expires_at > ${BigInt(now)}`;
      if (!consumed) return null;
    }
    const authCode = randomOAuthSecret();
    await tx.$executeRaw`
      UPDATE capture_auth SET user_id = ${approving.userId}, token_version = ${version},
        code_hash = ${hashCaptureSecret(authCode)}, expires_at = ${BigInt(now + 60_000)}
      WHERE id = ${authId}`;
    if (approving.isReview) {
      Logger.info(
        `[capture] Reviewer code approved an authorization for ${auth.client_name}`,
      );
    }
    const redirect = new URL(auth.redirect_uri);
    redirect.searchParams.set('code', authCode);
    redirect.searchParams.set('state', auth.state);
    redirect.searchParams.set('iss', issuer);
    return redirect.href;
  });
};

export const exchangeCaptureAuthorization = async (
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
    resource: string;
  },
  signingKey: string,
  now = Date.now(),
) =>
  prisma.$transaction(async (tx) => {
    const codeHash = hashCaptureSecret(input.code);
    const candidates = await tx.$queryRaw<AuthRow[]>`
    SELECT * FROM capture_auth WHERE code_hash = ${codeHash}`;
    const candidate = candidates[0];
    if (!candidate?.user_id) return null;
    const version = await lockCaptureUser(tx, candidate.user_id);
    if (version === null) return null;
    const rows = await tx.$queryRaw<AuthRow[]>`
    SELECT * FROM capture_auth WHERE code_hash = ${codeHash} FOR UPDATE`;
    const auth = rows[0];
    if (
      !auth ||
      auth.token_version !== version ||
      Number(auth.expires_at) <= now ||
      auth.client_id !== input.clientId ||
      auth.redirect_uri !== input.redirectUri ||
      auth.resource !== input.resource ||
      auth.code_challenge !== pkceChallenge(input.verifier)
    )
      return null;
    await tx.$executeRaw`DELETE FROM capture_auth WHERE code_hash = ${codeHash}`;
    const grantId = uuidv7();
    const refresh = newRefreshSecret(signingKey, grantId);
    const offline = auth.scope.split(' ').includes('offline_access');
    const expiresAt = now + ACCESS_TTL_MS;
    await tx.$executeRaw`
    INSERT INTO capture_grants (id, user_id, kind, client_name, secret_hash, created_at,
      expires_at, client_id, resource, refresh_hash, refresh_expires_at)
    VALUES (${grantId}, ${candidate.user_id}, 'oauth', ${auth.client_name},
      ${oauthAccessHash(signingKey, grantId, refresh)}, ${BigInt(now)}, ${BigInt(expiresAt)},
      ${auth.client_id}, ${auth.resource}, ${offline ? hashCaptureSecret(refresh) : null},
      ${offline ? BigInt(now + REFRESH_TTL_MS) : null})`;
    return oauthTokenPair(signingKey, grantId, refresh, expiresAt, now, offline);
  });

interface RefreshRow {
  user_id: number;
  client_id: string;
  resource: string;
  refresh_hash: string;
  prev_refresh_hash: string | null;
  rotated_at: bigint | null;
  refresh_expires_at: bigint;
  expires_at: bigint;
  revoked_at: bigint | null;
}

export const refreshCaptureAuthorization = async (
  token: string,
  clientId: string,
  resource: string,
  signingKey: string,
  now = Date.now(),
) => {
  const parsed = parseRefreshToken(signingKey, token);
  if (!parsed) return null;
  const { grantId, secret } = parsed;
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ user_id: number }>>`
      SELECT user_id FROM capture_grants WHERE id = ${grantId} AND kind = 'oauth'`;
    if (!candidates[0] || (await lockCaptureUser(tx, candidates[0].user_id)) === null)
      return null;
    const rows = await tx.$queryRaw<RefreshRow[]>`
      SELECT * FROM capture_grants WHERE id = ${grantId} FOR UPDATE`;
    const grant = rows[0];
    if (
      !grant ||
      grant.revoked_at !== null ||
      !grant.refresh_hash ||
      Number(grant.refresh_expires_at) <= now ||
      grant.client_id !== clientId ||
      grant.resource !== resource
    )
      return null;
    const next = nextRefreshSecret(signingKey, grantId, secret);
    if (!isCaptureSecretValid(secret, grant.refresh_hash)) {
      if (
        grant.prev_refresh_hash &&
        isCaptureSecretValid(secret, grant.prev_refresh_hash) &&
        grant.rotated_at !== null &&
        now < Number(grant.rotated_at) + REFRESH_GRACE_MS &&
        isCaptureSecretValid(next, grant.refresh_hash)
      ) {
        return oauthTokenPair(
          signingKey,
          grantId,
          next,
          Number(grant.expires_at),
          now,
          true,
        );
      }
      // The signature proves it was issued for this grant; this is replay, not a guess.
      await tx.$executeRaw`UPDATE capture_grants SET revoked_at = ${BigInt(now)} WHERE id = ${grantId}`;
      return null;
    }
    const expiresAt = now + ACCESS_TTL_MS;
    await tx.$executeRaw`
      UPDATE capture_grants SET prev_refresh_hash = refresh_hash,
        refresh_hash = ${hashCaptureSecret(next)}, rotated_at = ${BigInt(now)},
        secret_hash = ${oauthAccessHash(signingKey, grantId, next)}, expires_at = ${BigInt(expiresAt)},
        refresh_expires_at = ${BigInt(now + REFRESH_TTL_MS)} WHERE id = ${grantId}`;
    return oauthTokenPair(signingKey, grantId, next, expiresAt, now, true);
  });
};

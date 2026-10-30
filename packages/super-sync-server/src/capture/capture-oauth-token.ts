import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { hashCaptureSecret } from './capture-token';

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 90 * 24 * ACCESS_TTL_MS;
export const REFRESH_GRACE_MS = 2 * 60 * 1000;
/** Random 256-bit tokens, not user-chosen passwords. */
export const randomOAuthSecret = (): string => randomBytes(32).toString('base64url');
/** PKCE S256 requires SHA-256 of the verifier. */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

const mac = (key: string, purpose: string, grantId: string, value: string): string =>
  createHmac('sha256', key)
    .update(`sp-capture-oauth-v1:${purpose}:${grantId}:${value}`)
    .digest('base64url');

const signRefresh = (key: string, grantId: string, nonce: string): string =>
  `${nonce}.${mac(key, 'sign', grantId, nonce)}`;

export const newRefreshSecret = (key: string, grantId: string): string =>
  signRefresh(key, grantId, randomOAuthSecret());

/**
 * A previous token deterministically reproduces the same successor during the
 * retry grace period. Only hashes are stored; the DB alone cannot mint tokens.
 */
export const nextRefreshSecret = (
  key: string,
  grantId: string,
  previous: string,
): string => signRefresh(key, grantId, mac(key, 'rotate', grantId, previous));

export const accessSecret = (key: string, grantId: string, refresh: string): string =>
  mac(key, 'access', grantId, refresh);

/** Authenticate before treating an old token as replay: a guessed id must not revoke it. */
export const parseRefreshToken = (
  key: string,
  token: string,
): { grantId: string; secret: string } | null => {
  const match = /^sp_rt_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(
    token,
  );
  if (!match) return null;
  const [, grantId, nonce, signature] = match;
  const expected = mac(key, 'sign', grantId, nonce);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { grantId, secret: `${nonce}.${signature}` };
};

export const oauthTokenPair = (
  key: string,
  grantId: string,
  refresh: string,
  expiresAt: number,
  now: number,
  offline: boolean,
) => ({
  access_token: `sp_cap_${grantId}_${accessSecret(key, grantId, refresh)}`,
  token_type: 'Bearer' as const,
  expires_in: Math.max(0, Math.floor((expiresAt - now) / 1000)),
  scope: offline ? 'tasks:capture offline_access' : 'tasks:capture',
  ...(offline ? { refresh_token: `sp_rt_${grantId}_${refresh}` } : {}),
});

export const oauthAccessHash = (key: string, grantId: string, refresh: string): string =>
  hashCaptureSecret(accessSecret(key, grantId, refresh));

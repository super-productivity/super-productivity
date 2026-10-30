import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { CAPTURE_TOKEN_PREFIX } from './capture.const';

/**
 * Opaque capture tokens: `sp_cap_<grantId>_<secret>`. The grant id makes the
 * lookup a primary-key read; only the SHA-256 of the secret is stored.
 */

// uuidv7 ids contain no underscore, so the first `_` after the prefix ends the id.
const GRANT_ID_PATTERN = /^[0-9a-f-]{36}$/;

export const hashCaptureSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

export const mintCaptureToken = (): {
  grantId: string;
  token: string;
  secretHash: string;
} => {
  const grantId = uuidv7();
  const secret = randomBytes(32).toString('base64url');
  return {
    grantId,
    token: `${CAPTURE_TOKEN_PREFIX}${grantId}_${secret}`,
    secretHash: hashCaptureSecret(secret),
  };
};

export const parseCaptureToken = (
  token: string,
): { grantId: string; secret: string } | null => {
  if (!token.startsWith(CAPTURE_TOKEN_PREFIX)) return null;
  const rest = token.slice(CAPTURE_TOKEN_PREFIX.length);
  const separator = rest.indexOf('_');
  if (separator === -1) return null;
  const grantId = rest.slice(0, separator);
  const secret = rest.slice(separator + 1);
  if (!GRANT_ID_PATTERN.test(grantId) || secret.length === 0) return null;
  return { grantId, secret };
};

export const isCaptureSecretValid = (secret: string, storedHash: string): boolean => {
  const actual = Buffer.from(hashCaptureSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

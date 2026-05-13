import { WebCryptoNotAvailableError } from '../web-crypto-error';
import {
  ALGORITHM,
  IV_LENGTH,
  TEXT_DECODER,
  TEXT_ENCODER,
  decodeBase64,
  getRequiredSubtle,
  hashPasswordForCache,
  isCryptoSubtleAvailable,
} from './web-crypto';

// ============================================================================
// LEGACY KDF WARNING HANDLER
// ============================================================================
// PBKDF2-with-password-as-salt is cryptographically weak. When legacy
// ciphertext is decrypted, hosts can register a handler to surface a
// deprecation signal to users (e.g. "consider re-syncing to migrate").

type LegacyKdfWarningHandler = () => void;
let _legacyKdfWarningHandler: LegacyKdfWarningHandler | null = null;

/**
 * Registers a handler invoked after a successful legacy PBKDF2 decryption.
 * Pass `null` to unregister. The host is responsible for de-duplicating /
 * throttling user-facing messages — the handler may fire on every legacy
 * decrypt.
 */
export const setLegacyKdfWarningHandler = (
  handler: LegacyKdfWarningHandler | null,
): void => {
  _legacyKdfWarningHandler = handler;
};

// ============================================================================
// LEGACY PBKDF2 KEY CACHE
// ============================================================================

const sessionLegacyKeyCache = new Map<string, CryptoKey>();

/** Clears the legacy PBKDF2 key cache. Called by clearSessionKeyCache(). */
export const clearLegacyKeyCache = (): void => {
  sessionLegacyKeyCache.clear();
};

const getOrDeriveLegacyKey = async (password: string): Promise<CryptoKey> => {
  const passwordHash = hashPasswordForCache(password);
  const cached = sessionLegacyKeyCache.get(passwordHash);
  if (cached) {
    return cached;
  }

  const subtle = getRequiredSubtle();
  const passwordBuffer = TEXT_ENCODER.encode(password);
  const keyMaterial = await subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  const key = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      // Using password as salt is insecure but kept for backward compatibility.
      salt: TEXT_ENCODER.encode(password),
      iterations: 1000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  sessionLegacyKeyCache.set(passwordHash, key);
  return key;
};

/**
 * Decrypts data produced by the legacy PBKDF2 format (kept for backward
 * compatibility). Requires WebCrypto — there is no @noble fallback for the
 * legacy path; mobile clients without WebCrypto must first sync from desktop
 * to migrate.
 */
export const decryptLegacy = async (data: string, password: string): Promise<string> => {
  if (!isCryptoSubtleAvailable()) {
    throw new WebCryptoNotAvailableError(
      'Cannot decrypt legacy data on this device. ' +
        'Your encrypted data uses an older format that requires WebCrypto. ' +
        'Please sync from a desktop browser first to migrate your data to the newer format.',
    );
  }

  const dataBuffer = decodeBase64(data);
  const iv = new Uint8Array(dataBuffer, 0, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, IV_LENGTH);
  const key = await getOrDeriveLegacyKey(password);
  const decryptedContent = await getRequiredSubtle().decrypt(
    { name: ALGORITHM, iv },
    key,
    encryptedData,
  );

  _legacyKdfWarningHandler?.();
  return TEXT_DECODER.decode(decryptedContent);
};

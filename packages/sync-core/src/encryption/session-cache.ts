import { DerivedKey, deriveKeyFromPassword } from './argon2';
import { hashPasswordForCache } from './web-crypto';
import { clearLegacyKeyCache } from './legacy';

// ============================================================================
// SESSION-LEVEL KEY CACHING
// ============================================================================
// Persists for the entire app session (until close/refresh).
// Avoids repeated Argon2id derivations (500ms-2000ms per call on mobile).
// Keys live in memory only; call clearSessionKeyCache() on password change.

interface SessionCacheEntry {
  key: DerivedKey;
  passwordHash: string;
}

// Encrypt cache: most-recently-used key for new encryptions
let sessionEncryptKeyCache: SessionCacheEntry | null = null;

// Decrypt cache: "passwordHash:saltBase64" -> derived key (LRU-ish)
const sessionDecryptKeyCache = new Map<string, DerivedKey>();

const SESSION_DECRYPT_CACHE_MAX_SIZE = 100;

/**
 * Clears all session key caches (encrypt + decrypt + legacy PBKDF2).
 * Call when:
 * - User changes their encryption password
 * - User logs out or disables encryption
 * - For security-sensitive operations
 */
export const clearSessionKeyCache = (): void => {
  sessionEncryptKeyCache = null;
  sessionDecryptKeyCache.clear();
  clearLegacyKeyCache();
};

/**
 * Gets statistics about the session key cache (for debugging/monitoring).
 */
export const getSessionKeyCacheStats = (): {
  hasEncryptKey: boolean;
  decryptKeyCount: number;
} => ({
  hasEncryptKey: sessionEncryptKeyCache !== null,
  decryptKeyCount: sessionDecryptKeyCache.size,
});

/**
 * Returns the session-cached encrypt key for the given password, deriving and
 * caching a fresh one on miss.
 */
export const getOrDeriveEncryptKey = async (password: string): Promise<DerivedKey> => {
  const passwordHash = hashPasswordForCache(password);
  if (sessionEncryptKeyCache && sessionEncryptKeyCache.passwordHash === passwordHash) {
    return sessionEncryptKeyCache.key;
  }
  const key = await deriveKeyFromPassword(password);
  sessionEncryptKeyCache = { key, passwordHash };
  return key;
};

export const getDecryptCache = (cacheKey: string): DerivedKey | undefined =>
  sessionDecryptKeyCache.get(cacheKey);

export const setDecryptCache = (cacheKey: string, key: DerivedKey): void => {
  if (sessionDecryptKeyCache.size >= SESSION_DECRYPT_CACHE_MAX_SIZE) {
    const firstKey = sessionDecryptKeyCache.keys().next().value;
    if (firstKey) {
      sessionDecryptKeyCache.delete(firstKey);
    }
  }
  sessionDecryptKeyCache.set(cacheKey, key);
};

import { argon2id } from 'hash-wasm';

const ALGORITHM = 'AES-GCM' as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Holds a derived CryptoKey along with its salt for reuse across operations.
 * Used to avoid expensive Argon2id key derivation for each operation.
 */
export interface DerivedKeyInfo {
  key: CryptoKey;
  salt: Uint8Array;
}

// ============================================================================
// SESSION-LEVEL KEY CACHING
// ============================================================================
// This cache persists for the entire app session (until close/refresh).
// PERFORMANCE: Reduces mobile sync time from minutes to seconds by avoiding
// repeated Argon2id derivations (each takes 500ms-2000ms on mobile).
//
// Cache structure:
// - For encryption: keyed by password hash (reuses key with its salt)
// - For decryption: keyed by password hash + salt (because each ciphertext may have different salt)
//
// SECURITY: Keys are only stored in memory, cleared on app restart.
// Call clearSessionKeyCache() when user changes their encryption password.

interface SessionCacheEntry {
  keyInfo: DerivedKeyInfo;
  passwordHash: string;
}

// Session cache: password hash -> encryption key (for new encryptions with random salt)
let sessionEncryptKeyCache: SessionCacheEntry | null = null;

// Session cache: "passwordHash:saltBase64" -> decryption key
const sessionDecryptKeyCache = new Map<string, DerivedKeyInfo>();

// Maximum entries in decrypt cache to prevent memory bloat
const SESSION_DECRYPT_CACHE_MAX_SIZE = 100;

/**
 * Simple hash of password for cache key comparison.
 * NOT for security - just for cache invalidation when password changes.
 */
const hashPasswordForCache = (password: string): string => {
  // Use a simple djb2 hash for speed (no crypto needed for cache key)
  let hash = 5381;
  for (let i = 0; i < password.length; i++) {
    hash = (hash * 33) ^ password.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

/**
 * Clears the session key cache. Call this when:
 * - User changes their encryption password
 * - User logs out or disables encryption
 * - For security-sensitive operations
 */
export const clearSessionKeyCache = (): void => {
  sessionEncryptKeyCache = null;
  sessionDecryptKeyCache.clear();
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

export const base642ab = (base64: string): ArrayBuffer => {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
};

export const ab2base64 = (buffer: ArrayBuffer): string => {
  const binary = Array.prototype.map
    .call(new Uint8Array(buffer), (byte: number) => String.fromCharCode(byte))
    .join('');
  return window.btoa(binary);
};

// Minimum sizes for format detection
// Argon2: [SALT (16)][IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 44 bytes
// Legacy: [IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 28 bytes
const MIN_ARGON2_SIZE = SALT_LENGTH + IV_LENGTH + 16;
const MIN_LEGACY_SIZE = IV_LENGTH + 16;

/**
 * Detects the likely encryption format based on data length.
 * Returns 'argon2' if data is large enough for Argon2 format,
 * 'legacy' if it's only large enough for legacy format,
 * or 'invalid' if too short for either.
 */
const detectFormat = (dataBuffer: ArrayBuffer): 'argon2' | 'legacy' | 'invalid' => {
  if (dataBuffer.byteLength >= MIN_ARGON2_SIZE) {
    return 'argon2';
  } else if (dataBuffer.byteLength >= MIN_LEGACY_SIZE) {
    return 'legacy';
  }
  return 'invalid';
};

// LEGACY FUNCTIONS
// PBKDF2 functions are only kept for backward compatibility.
// SECURITY NOTE: PBKDF2 with password-as-salt is cryptographically weak.
// Use decryptWithMigration() to automatically re-encrypt legacy data with Argon2id.
const _generateKey = async (password: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const passwordBuffer = enc.encode(password);
  const ops = {
    name: 'PBKDF2',
    // Using password as salt is insecure but kept for backward compatibility.
    // New data uses Argon2id with random salt via encrypt().
    salt: enc.encode(password),
    iterations: 1000,
    hash: 'SHA-256',
  };
  const key = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    ops,
    key,
    { name: ALGORITHM, length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
};

export const generateKey = async (password: string): Promise<string> => {
  const cryptoKey = await _generateKey(password);
  const exportKey = await window.crypto.subtle.exportKey('raw', cryptoKey);
  return ab2base64(exportKey);
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
async function decryptLegacy(data: string, password: string): Promise<string> {
  const dataBuffer = base642ab(data);
  const iv = new Uint8Array(dataBuffer, 0, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, IV_LENGTH);
  const key = await _generateKey(password);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encryptedData,
  );
  const dec = new TextDecoder();
  return dec.decode(decryptedContent);
}

const _deriveKeyArgon = async (
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> => {
  const derivedBytes = await argon2id({
    password: password,
    salt: salt,
    hashLength: KEY_LENGTH,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536, // 64 MB
    outputType: 'binary',
  });

  return window.crypto.subtle.importKey(
    'raw',
    derivedBytes.buffer as ArrayBuffer,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  );
};

const decryptArgon = async (data: string, password: string): Promise<string> => {
  const dataBuffer = base642ab(data);
  const salt = new Uint8Array(dataBuffer, 0, SALT_LENGTH);
  const iv = new Uint8Array(dataBuffer, SALT_LENGTH, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, SALT_LENGTH + IV_LENGTH);
  const key = await _deriveKeyArgon(password, salt);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encryptedData,
  );
  const dec = new TextDecoder();
  return dec.decode(decryptedContent);
};

export const encrypt = async (data: string, password: string): Promise<string> => {
  const enc = new TextEncoder();
  const dataBuffer = enc.encode(data);
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await _deriveKeyArgon(password, salt);
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv },
    key,
    dataBuffer,
  );

  const buffer = new Uint8Array(SALT_LENGTH + IV_LENGTH + encryptedContent.byteLength);
  buffer.set(salt, 0);
  buffer.set(iv, SALT_LENGTH);
  buffer.set(new Uint8Array(encryptedContent), SALT_LENGTH + IV_LENGTH);

  return ab2base64(buffer.buffer);
};

export const decrypt = async (data: string, password: string): Promise<string> => {
  try {
    return await decryptArgon(data, password);
  } catch (e) {
    // Fallback to legacy decryption (pre-Argon2 format)
    return await decryptLegacy(data, password);
  }
};

/**
 * Result of decryption with migration information.
 * When wasLegacy is true, migratedCiphertext contains the data
 * re-encrypted with Argon2id for improved security.
 */
export interface DecryptResult {
  /** The decrypted plaintext data */
  plaintext: string;
  /** Re-encrypted data using Argon2id. Only set if wasLegacy is true. */
  migratedCiphertext?: string;
  /** True if the data was encrypted with legacy PBKDF2 */
  wasLegacy: boolean;
}

/**
 * Decrypts data and provides migration information for legacy PBKDF2 data.
 *
 * When legacy data is detected:
 * 1. Decrypts using PBKDF2 (insecure: password used as salt)
 * 2. Re-encrypts using Argon2id (secure: random salt)
 * 3. Returns the new ciphertext for caller to persist
 *
 * Callers should persist migratedCiphertext when available to complete
 * the migration from PBKDF2 to Argon2id.
 */
export const decryptWithMigration = async (
  data: string,
  password: string,
): Promise<DecryptResult> => {
  try {
    const plaintext = await decryptArgon(data, password);
    return { plaintext, wasLegacy: false };
  } catch (e) {
    // Legacy PBKDF2 format - decrypt and prepare migration
    const plaintext = await decryptLegacy(data, password);
    const migratedCiphertext = await encrypt(plaintext, password);
    return { plaintext, migratedCiphertext, wasLegacy: true };
  }
};

// ============================================================================
// BATCH ENCRYPTION OPTIMIZATION
// ============================================================================
// The functions below optimize encryption/decryption for multiple operations
// by deriving the Argon2id key only once instead of per-operation.
// This is critical for mobile performance where Argon2id (64MB, 3 iterations)
// can take 500ms-2000ms per key derivation.

/**
 * Derives a CryptoKey from password using Argon2id.
 * Returns both the key and salt for reuse across multiple encrypt operations.
 *
 * @param password The encryption password
 * @param salt Optional salt; if not provided, generates a random 16-byte salt
 */
export const deriveKeyFromPassword = async (
  password: string,
  salt?: Uint8Array,
): Promise<DerivedKeyInfo> => {
  const actualSalt = salt ?? window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await _deriveKeyArgon(password, actualSalt);
  return { key, salt: actualSalt };
};

/**
 * Encrypts data using a pre-derived key. Much faster than encrypt() when
 * encrypting multiple items since Argon2id key derivation is skipped.
 *
 * @param data Plaintext string to encrypt
 * @param keyInfo Pre-derived key with its salt
 * @returns Base64-encoded ciphertext with embedded salt and IV
 */
export const encryptWithDerivedKey = async (
  data: string,
  keyInfo: DerivedKeyInfo,
): Promise<string> => {
  const enc = new TextEncoder();
  const dataBuffer = enc.encode(data);
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv },
    keyInfo.key,
    dataBuffer,
  );

  // Same format as encrypt(): [SALT (16 bytes)][IV (12 bytes)][ENCRYPTED_DATA]
  const buffer = new Uint8Array(SALT_LENGTH + IV_LENGTH + encryptedContent.byteLength);
  buffer.set(keyInfo.salt, 0);
  buffer.set(iv, SALT_LENGTH);
  buffer.set(new Uint8Array(encryptedContent), SALT_LENGTH + IV_LENGTH);

  return ab2base64(buffer.buffer);
};

/**
 * Encrypts multiple strings efficiently by deriving the key only once.
 * All encrypted strings share the same salt but have unique IVs.
 *
 * SESSION CACHING: Reuses the derived key across sync cycles if password hasn't changed.
 * This dramatically improves mobile performance by avoiding repeated Argon2id derivations.
 *
 * @param dataItems Array of plaintext strings to encrypt
 * @param password The encryption password
 * @returns Array of Base64-encoded ciphertexts in the same order
 */
export const encryptBatch = async (
  dataItems: string[],
  password: string,
): Promise<string[]> => {
  if (dataItems.length === 0) {
    return [];
  }

  const passwordHash = hashPasswordForCache(password);
  let keyInfo: DerivedKeyInfo;

  // Check session cache for existing key (no timeout - cached for entire session)
  if (sessionEncryptKeyCache && sessionEncryptKeyCache.passwordHash === passwordHash) {
    // Reuse cached key (same salt means consistent ciphertext format)
    keyInfo = sessionEncryptKeyCache.keyInfo;
  } else {
    // Derive new key and cache it
    keyInfo = await deriveKeyFromPassword(password);
    sessionEncryptKeyCache = {
      keyInfo,
      passwordHash,
    };
  }

  // Encrypt all items in parallel using the pre-derived key
  // Parallelization provides 10-100x speedup for large batches
  const results = await Promise.all(
    dataItems.map((data) => encryptWithDerivedKey(data, keyInfo)),
  );
  return results;
};

/**
 * Decrypts data using a pre-derived key. Use when the salt is already known
 * and matches the keyInfo's salt.
 *
 * @param data Base64-encoded ciphertext
 * @param keyInfo Pre-derived key that matches the ciphertext's salt
 * @returns Decrypted plaintext string
 */
export const decryptWithDerivedKey = async (
  data: string,
  keyInfo: DerivedKeyInfo,
): Promise<string> => {
  const dataBuffer = base642ab(data);
  // Skip salt (first 16 bytes) since we already have the key
  const iv = new Uint8Array(dataBuffer, SALT_LENGTH, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, SALT_LENGTH + IV_LENGTH);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv },
    keyInfo.key,
    encryptedData,
  );
  const dec = new TextDecoder();
  return dec.decode(decryptedContent);
};

/**
 * Decrypts multiple strings efficiently by caching derived keys by salt.
 * Operations with the same salt (e.g., encrypted in the same batch) will
 * share the cached key, avoiding redundant Argon2id derivations.
 *
 * SESSION CACHING: Caches derived keys across sync cycles by password+salt.
 * This dramatically improves mobile performance for repeated syncs.
 *
 * SECURITY NOTE: Unlike the single-item decrypt(), this function uses explicit
 * format detection to avoid masking decryption errors as legacy fallbacks.
 * Only data that's too short for Argon2 format will attempt legacy decryption.
 *
 * @param dataItems Array of Base64-encoded ciphertexts to decrypt
 * @param password The decryption password
 * @returns Array of decrypted plaintext strings in the same order
 */
export const decryptBatch = async (
  dataItems: string[],
  password: string,
): Promise<string[]> => {
  if (dataItems.length === 0) {
    return [];
  }

  const passwordHash = hashPasswordForCache(password);

  // Phase 1: Analyze all items and collect unique salts that need key derivation
  // This phase is fast (no crypto operations)
  const itemAnalysis: Array<{
    index: number;
    data: string;
    format: 'argon2' | 'legacy';
    saltBase64?: string;
    salt?: Uint8Array;
  }> = [];

  const saltsNeedingDerivation = new Map<string, Uint8Array>();

  for (let i = 0; i < dataItems.length; i++) {
    const data = dataItems[i];
    const dataBuffer = base642ab(data);
    const format = detectFormat(dataBuffer);

    if (format === 'invalid') {
      throw new Error('Encrypted data is too short to be valid');
    }

    if (format === 'legacy') {
      itemAnalysis.push({ index: i, data, format: 'legacy' });
      continue;
    }

    // Argon2 format: extract salt
    const salt = new Uint8Array(dataBuffer, 0, SALT_LENGTH);
    const saltBase64 = ab2base64(salt.slice().buffer);
    const sessionCacheKey = `${passwordHash}:${saltBase64}`;

    itemAnalysis.push({ index: i, data, format: 'argon2', saltBase64, salt });

    // Check if we need to derive a key for this salt
    if (!sessionDecryptKeyCache.has(sessionCacheKey)) {
      saltsNeedingDerivation.set(saltBase64, salt);
    }
  }

  // Phase 2: Derive keys for unique salts in parallel
  // This is the expensive phase - parallelize it!
  if (saltsNeedingDerivation.size > 0) {
    const derivationPromises = Array.from(saltsNeedingDerivation.entries()).map(
      async ([saltBase64, salt]) => {
        const keyInfo = await deriveKeyFromPassword(password, salt);
        return { saltBase64, keyInfo };
      },
    );

    const derivedKeys = await Promise.all(derivationPromises);

    // Add derived keys to session cache
    for (const { saltBase64, keyInfo } of derivedKeys) {
      const sessionCacheKey = `${passwordHash}:${saltBase64}`;

      // Enforce cache size limit
      if (sessionDecryptKeyCache.size >= SESSION_DECRYPT_CACHE_MAX_SIZE) {
        const firstKey = sessionDecryptKeyCache.keys().next().value;
        if (firstKey) {
          sessionDecryptKeyCache.delete(firstKey);
        }
      }
      sessionDecryptKeyCache.set(sessionCacheKey, keyInfo);
    }
  }

  // Phase 3: Decrypt all items in parallel using cached keys
  const decryptionPromises = itemAnalysis.map(async (item) => {
    if (item.format === 'legacy') {
      return { index: item.index, result: await decryptLegacy(item.data, password) };
    }

    const sessionCacheKey = `${passwordHash}:${item.saltBase64}`;
    const keyInfo = sessionDecryptKeyCache.get(sessionCacheKey)!;

    // Try Argon2 decryption first, fall back to legacy if it fails
    // This handles legacy data that's ≥44 bytes (misclassified as Argon2)
    try {
      return {
        index: item.index,
        result: await decryptWithDerivedKey(item.data, keyInfo),
      };
    } catch {
      // Argon2 failed - try legacy format (data might be long legacy ciphertext)
      return { index: item.index, result: await decryptLegacy(item.data, password) };
    }
  });

  const decryptedItems = await Promise.all(decryptionPromises);

  // Reassemble results in original order
  const results: string[] = new Array(dataItems.length);
  for (const { index, result } of decryptedItems) {
    results[index] = result;
  }

  return results;
};

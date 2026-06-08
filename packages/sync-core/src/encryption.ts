/**
 * Encryption facade — Argon2id KDF + AES-GCM, WebCrypto with @noble fallback.
 *
 * Layout:
 *   encryption/web-crypto.ts    — crypto.subtle + @noble glue, base64, constants
 *   encryption/argon2.ts        — Argon2id params, deriveKeyFromPassword, DerivedKey
 *   encryption/legacy.ts        — backward-compat PBKDF2 decryption + warning handler
 *   encryption/session-cache.ts — session-level key caches
 *   encryption.ts (this file)   — public API: encrypt/decrypt/encryptBatch/decryptBatch
 *
 * ## Wire format (public contract — do not change without a version-byte migration)
 *
 *   Argon2id ciphertext  : [SALT (16)][IV (12)][AES-GCM ciphertext + auth tag]
 *   Legacy PBKDF2        : [IV (12)][AES-GCM ciphertext + auth tag]
 *
 * Ciphertext is base64-encoded for transport. `detectFormat()` discriminates
 * by length: < 28 bytes is invalid, < 44 bytes is unambiguously legacy,
 * >= 44 bytes is treated as Argon2id with a legacy fallback on auth failure.
 *
 * ## Salt and IV semantics
 *
 *   - **IV** is freshly random per call (12 bytes from CSPRNG). AES-GCM
 *     confidentiality and integrity depend on IV uniqueness under a given key,
 *     which this guarantees.
 *   - **Salt** is derived once per (process session, password) and reused
 *     across every `encrypt()` / `encryptWithDerivedKey()` / `encryptBatch()`
 *     call in that session. This is intentional: it lets us amortize the
 *     ~500ms-2s Argon2id derivation across many calls via the session cache.
 *     A session-stable salt is safe because the derived key never changes for
 *     the same (salt, password) pair, and AES-GCM security under a fixed key
 *     reduces to IV uniqueness. Two encryptions of the same plaintext within
 *     a session therefore share the salt prefix and differ only in IV +
 *     ciphertext — do not assert otherwise in tests.
 *
 * ## Legacy-decrypt diagnostics
 *
 * `setLegacyKdfWarningHandler(h)` registers a host callback fired on every
 * successful legacy decrypt. Callers use it to surface a deprecation UI / log
 * line on code paths that go through `decrypt()` without threading a result
 * type.
 */

import {
  IV_LENGTH,
  SALT_LENGTH,
  TEXT_ENCODER,
  TEXT_DECODER,
  aesDecrypt,
  aesEncrypt,
  decodeBase64,
  detectFormat,
  encodeBase64,
  getRandomBytes,
  hashPasswordForCache,
} from './encryption/web-crypto';
import { type DerivedKey, deriveKeyFromPassword } from './encryption/argon2';
import {
  getDecryptCache,
  getOrDeriveEncryptKey,
  setDecryptCache,
} from './encryption/session-cache';
import { decryptLegacy } from './encryption/legacy';

// Re-export the test-and-host-facing pieces from submodules.
export {
  setArgon2ParamsForTesting,
  getArgon2Params,
  deriveKeyFromPassword,
} from './encryption/argon2';
export type { DerivedKey } from './encryption/argon2';
export {
  clearSessionKeyCache,
  getSessionKeyCacheStats,
} from './encryption/session-cache';
export { isCryptoSubtleAvailable } from './encryption/web-crypto';
export { setLegacyKdfWarningHandler } from './encryption/legacy';

// ============================================================================
// MAIN ENCRYPTION/DECRYPTION FUNCTIONS
// ============================================================================

/**
 * Encrypts data using a pre-derived key. Much faster than encrypt() when
 * encrypting multiple items since Argon2id key derivation is skipped.
 *
 * @returns Base64-encoded ciphertext with embedded salt and IV
 *          (format: `[SALT (16)][IV (12)][AES-GCM ciphertext + auth tag]`)
 */
const encryptWithDerivedKey = async (data: string, key: DerivedKey): Promise<string> => {
  const dataBuffer = TEXT_ENCODER.encode(data);
  const iv = getRandomBytes(IV_LENGTH);
  const encryptedContent = await aesEncrypt(key.keyBytes, iv, dataBuffer);

  const buffer = new Uint8Array(SALT_LENGTH + IV_LENGTH + encryptedContent.byteLength);
  buffer.set(key.salt, 0);
  buffer.set(iv, SALT_LENGTH);
  buffer.set(encryptedContent, SALT_LENGTH + IV_LENGTH);

  return encodeBase64(buffer);
};

/**
 * Decrypts data using a pre-derived key.
 *
 * @param data Base64-encoded ciphertext (or an already-decoded buffer to skip
 *   re-decoding)
 * @param key Pre-derived key whose salt matches the ciphertext
 */
const decryptWithDerivedKey = async (
  data: string | ArrayBuffer,
  key: DerivedKey,
): Promise<string> => {
  const dataBuffer = typeof data === 'string' ? decodeBase64(data) : data;
  // Skip salt (first 16 bytes) since we already have the key
  const iv = new Uint8Array(dataBuffer, SALT_LENGTH, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, SALT_LENGTH + IV_LENGTH);

  const decryptedContent = await aesDecrypt(key.keyBytes, iv, encryptedData);
  return TEXT_DECODER.decode(decryptedContent);
};

export const encrypt = async (data: string, password: string): Promise<string> => {
  const key = await getOrDeriveEncryptKey(password);
  return encryptWithDerivedKey(data, key);
};

/** Decrypts an Argon2id-format ciphertext given an already-decoded buffer. */
const decryptArgonFromBuffer = async (
  buffer: ArrayBuffer,
  password: string,
): Promise<string> => {
  const salt = new Uint8Array(buffer, 0, SALT_LENGTH);
  const passwordHash = hashPasswordForCache(password);
  const saltBase64 = encodeBase64(salt);
  const cacheKey = `${passwordHash}:${saltBase64}`;

  let key = getDecryptCache(cacheKey);
  if (!key) {
    key = await deriveKeyFromPassword(password, salt);
    setDecryptCache(cacheKey, key);
  }

  return decryptWithDerivedKey(buffer, key);
};

export const decrypt = async (data: string, password: string): Promise<string> => {
  const buffer = decodeBase64(data);
  const format = detectFormat(buffer);

  if (format === 'invalid') {
    throw new Error('Encrypted data is too short to be valid');
  }
  if (format === 'legacy') {
    return decryptLegacy(data, password);
  }

  try {
    return await decryptArgonFromBuffer(buffer, password);
  } catch {
    // Argon2 failed — fall back to legacy in case the data is a long legacy
    // ciphertext that happens to be >= 44 bytes (the length heuristic can't
    // disambiguate). Mobile clients without WebCrypto get a clear error.
    return decryptLegacy(data, password);
  }
};

// ============================================================================
// BATCH ENCRYPTION OPTIMIZATION
// ============================================================================
// Derives the Argon2id key once instead of per-operation.
// Critical for mobile where Argon2id (64MB, 3 iterations) can take 500ms-2000ms
// per derivation. Session caches survive across sync cycles.

/**
 * Encrypts multiple strings efficiently by deriving the key only once.
 * All encrypted strings share the same salt but have unique IVs.
 */
export const encryptBatch = async (
  dataItems: string[],
  password: string,
): Promise<string[]> => {
  if (dataItems.length === 0) {
    return [];
  }
  const key = await getOrDeriveEncryptKey(password);
  return Promise.all(dataItems.map((data) => encryptWithDerivedKey(data, key)));
};

/**
 * Decrypts multiple strings efficiently by caching derived keys by salt.
 * Operations with the same salt (e.g., encrypted in the same batch) share
 * the cached key, avoiding redundant Argon2id derivations.
 *
 * Format handling mirrors single-item `decrypt()`: ciphertexts in the
 * legacy-length range (28..43 bytes) take the PBKDF2 path; >= 44 bytes are
 * attempted as Argon2id first, with a legacy fallback on auth failure (a
 * long legacy ciphertext can be misclassified as Argon2 by the length
 * heuristic); < 28 bytes throws as invalid. The fallback is part of the
 * public wire-format contract; see the module-level JSDoc.
 */
export const decryptBatch = async (
  dataItems: string[],
  password: string,
): Promise<string[]> => {
  if (dataItems.length === 0) {
    return [];
  }

  const passwordHash = hashPasswordForCache(password);

  interface ArgonItem {
    index: number;
    format: 'argon2';
    saltBase64: string;
    buffer: ArrayBuffer;
  }
  interface LegacyItem {
    index: number;
    format: 'legacy';
    data: string;
  }

  // Phase 1: analyze items, decode once, collect every unique salt.
  const itemAnalysis: Array<ArgonItem | LegacyItem> = [];
  const uniqueSalts = new Map<string, Uint8Array>();

  for (let i = 0; i < dataItems.length; i++) {
    const data = dataItems[i];
    const buffer = decodeBase64(data);
    const format = detectFormat(buffer);

    if (format === 'invalid') {
      throw new Error('Encrypted data is too short to be valid');
    }

    if (format === 'legacy') {
      itemAnalysis.push({ index: i, format: 'legacy', data });
      continue;
    }

    const salt = new Uint8Array(buffer, 0, SALT_LENGTH);
    const saltBase64 = encodeBase64(salt);

    itemAnalysis.push({ index: i, format: 'argon2', saltBase64, buffer });

    if (!uniqueSalts.has(saltBase64)) {
      uniqueSalts.set(saltBase64, salt);
    }
  }

  // Phase 2: derive keys for unique salts SERIALLY and keep them in a
  // batch-local map. Argon2id is single-threaded and allocates 64MB per
  // derivation; parallel derivations via Promise.all only interleave microtasks
  // (no real parallelism) and risk OOM on mobile. Holding keys locally also
  // ensures Phase 3 cannot see an entry evicted by the LRU session cache
  // (capped at SESSION_DECRYPT_CACHE_MAX_SIZE) when a batch contains more
  // unique salts than the cache can hold.
  const batchKeys = new Map<string, DerivedKey>();
  for (const [saltBase64, salt] of uniqueSalts) {
    const cacheKey = `${passwordHash}:${saltBase64}`;
    let key = getDecryptCache(cacheKey);
    if (!key) {
      key = await deriveKeyFromPassword(password, salt);
      setDecryptCache(cacheKey, key);
    }
    batchKeys.set(saltBase64, key);
  }

  // Phase 3: decrypt all items in parallel using batch-local keys, reusing
  // the buffer decoded in phase 1 to avoid a second base64 decode.
  const decryptionPromises = itemAnalysis.map(async (item) => {
    if (item.format === 'legacy') {
      return { index: item.index, result: await decryptLegacy(item.data, password) };
    }

    const key = batchKeys.get(item.saltBase64)!;
    try {
      return {
        index: item.index,
        result: await decryptWithDerivedKey(item.buffer, key),
      };
    } catch {
      // Argon2 failed — fall back to legacy in case the data is a long legacy
      // ciphertext that happens to be >= 44 bytes.
      const data = dataItems[item.index];
      return { index: item.index, result: await decryptLegacy(data, password) };
    }
  });

  const decryptedItems = await Promise.all(decryptionPromises);

  const results: string[] = new Array(dataItems.length);
  for (const { index, result } of decryptedItems) {
    results[index] = result;
  }
  return results;
};

/**
 * Fast mock encryption for unit tests.
 *
 * Real Argon2id encryption takes ~500-800ms per operation due to intentional
 * key derivation slowness (64MB memory, 3 iterations). This mock uses simple
 * base64 encoding with a marker prefix, providing instant encryption/decryption
 * for tests that don't need to verify actual cryptographic behavior.
 *
 * Use real encryption only in:
 * - encryption.spec.ts (tests the actual encryption)
 * - Security-focused integration tests (if any)
 *
 * Usage with Jasmine spyOn (recommended):
 * ```typescript
 * import * as encryptionModule from '../../encryption/encryption';
 * import { mockEncrypt, mockDecrypt } from './mock-encryption.helper';
 *
 * beforeEach(() => {
 *   spyOn(encryptionModule, 'encrypt').and.callFake(mockEncrypt);
 *   spyOn(encryptionModule, 'decrypt').and.callFake(mockDecrypt);
 * });
 * ```
 */

export const MOCK_ENCRYPTION_PREFIX = 'MOCK_ENCRYPTED:';
const MOCK_SALT = 'MOCK_SALT:';

/**
 * Encode string to base64, handling UTF-8 characters (emojis, non-Latin1).
 */
const utf8ToBase64 = (str: string): string => {
  const utf8Bytes = new TextEncoder().encode(str);
  const binaryString = Array.from(utf8Bytes)
    .map((byte) => String.fromCharCode(byte))
    .join('');
  return btoa(binaryString);
};

/**
 * Decode base64 to string, handling UTF-8 characters.
 */
const base64ToUtf8 = (base64: string): string => {
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * Fast mock encrypt - base64 encodes with prefix.
 * Validates password is provided but doesn't use it cryptographically.
 * Includes a random component to simulate IV behavior (different ciphertext for same plaintext).
 */
export const mockEncrypt = async (data: string, password: string): Promise<string> => {
  if (!password) {
    throw new Error('Password required for encryption');
  }
  // Include password hash in output to detect wrong-password decryption
  const passwordHash = utf8ToBase64(password).slice(0, 8);
  // Add random component to simulate IV (makes output non-deterministic like real encryption)
  const randomIv = Math.random().toString(36).slice(2, 10);
  const encoded = utf8ToBase64(data);
  return `${MOCK_ENCRYPTION_PREFIX}${MOCK_SALT}${passwordHash}:${randomIv}:${encoded}`;
};

/**
 * Fast mock decrypt - decodes base64 with prefix check.
 * Validates password matches what was used for encryption.
 */
export const mockDecrypt = async (data: string, password: string): Promise<string> => {
  if (!password) {
    throw new Error('Password required for decryption');
  }

  // Handle legacy format (no prefix = real encrypted data, fail fast)
  if (!data.startsWith(MOCK_ENCRYPTION_PREFIX)) {
    throw new Error('Invalid mock-encrypted data (missing prefix)');
  }

  const withoutPrefix = data.slice(MOCK_ENCRYPTION_PREFIX.length);
  if (!withoutPrefix.startsWith(MOCK_SALT)) {
    throw new Error('Invalid mock-encrypted data (missing salt)');
  }

  const withoutSalt = withoutPrefix.slice(MOCK_SALT.length);
  // Format: passwordHash:randomIv:encoded
  const parts = withoutSalt.split(':');
  if (parts.length < 3) {
    throw new Error('Invalid mock-encrypted data format');
  }

  const storedPasswordHash = parts[0];
  // Skip parts[1] (randomIv) - we don't need it for decryption
  const encoded = parts.slice(2).join(':'); // In case encoded data contains colons

  // Verify password matches
  const passwordHash = utf8ToBase64(password).slice(0, 8);
  if (passwordHash !== storedPasswordHash) {
    throw new Error('Decryption failed: wrong password');
  }

  return base64ToUtf8(encoded);
};

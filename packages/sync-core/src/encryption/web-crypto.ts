import { gcm } from '@noble/ciphers/aes.js';
import { WebCryptoNotAvailableError } from '../web-crypto-error';

export const ALGORITHM = 'AES-GCM' as const;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const KEY_LENGTH = 32;

export const TEXT_ENCODER = new TextEncoder();
export const TEXT_DECODER = new TextDecoder();

// Minimum sizes for format detection
// Argon2: [SALT (16)][IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 44 bytes
// Legacy: [IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 28 bytes
const MIN_ARGON2_SIZE = SALT_LENGTH + IV_LENGTH + 16;
const MIN_LEGACY_SIZE = IV_LENGTH + 16;

const getRequiredCrypto = (): Crypto => {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi === undefined) {
    throw new WebCryptoNotAvailableError('Crypto API is not available');
  }
  return cryptoApi;
};

export const getRequiredSubtle = (): SubtleCrypto => {
  const subtle = getRequiredCrypto().subtle;
  if (subtle === undefined) {
    throw new WebCryptoNotAvailableError();
  }
  return subtle;
};

/**
 * Checks if WebCrypto API (crypto.subtle) is available in the current context.
 * Returns false in insecure contexts (http://, some custom schemes like Android Capacitor).
 */
export const isCryptoSubtleAvailable = (): boolean => {
  return (globalThis as { crypto?: Crypto }).crypto?.subtle !== undefined;
};

export const getRandomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  getRequiredCrypto().getRandomValues(new Uint8Array(length));

// ============================================================================
// AES-GCM PRIMITIVES
// ============================================================================
// One branch on isCryptoSubtleAvailable() per call. WebCrypto's importKey is
// ~10μs, dwarfed by the surrounding Argon2id derivation (~500ms+ on mobile).

export const aesEncrypt = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> => {
  if (isCryptoSubtleAvailable()) {
    const subtle = getRequiredSubtle();
    const key = await subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: ALGORITHM },
      false,
      ['encrypt'],
    );
    const out = await subtle.encrypt(
      { name: ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
      key,
      data as Uint8Array<ArrayBuffer>,
    );
    return new Uint8Array(out);
  }
  return gcm(keyBytes, iv).encrypt(data);
};

export const aesDecrypt = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> => {
  if (isCryptoSubtleAvailable()) {
    const subtle = getRequiredSubtle();
    const key = await subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: ALGORITHM },
      false,
      ['decrypt'],
    );
    const out = await subtle.decrypt(
      { name: ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
      key,
      data as Uint8Array<ArrayBuffer>,
    );
    return new Uint8Array(out);
  }
  return gcm(keyBytes, iv).decrypt(data);
};

// ============================================================================
// BASE64 UTILITIES
// ============================================================================
// Chunked String.fromCharCode avoids the O(n) intermediate Array of single-char
// strings that .map(...).join('') produces. ~10x faster for large blobs.

const BASE64_CHUNK = 0x8000;

export const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const encodeBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
};

export const detectFormat = (
  dataBuffer: ArrayBuffer,
): 'argon2' | 'legacy' | 'invalid' => {
  if (dataBuffer.byteLength >= MIN_ARGON2_SIZE) {
    return 'argon2';
  } else if (dataBuffer.byteLength >= MIN_LEGACY_SIZE) {
    return 'legacy';
  }
  return 'invalid';
};

/**
 * Returns an injective string identifier for a password, used as a cache-map
 * key (and as a prefix in decrypt-cache keys like `${id}:${saltBase64}`).
 *
 * Length-prefixed so concatenation stays unambiguous even if the password
 * contains the `:` separator used downstream. Holding the password verbatim
 * is safe: these caches live in-memory in the same process that already holds
 * the plaintext password.
 *
 * Earlier versions used a 32-bit djb2 hash; collisions would silently return
 * a key derived from a different password, producing undecryptable ciphertext.
 */
export const hashPasswordForCache = (password: string): string => {
  return `${password.length}:${password}`;
};

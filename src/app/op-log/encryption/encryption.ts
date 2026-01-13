import { argon2id } from 'hash-wasm';

const ALGORITHM = 'AES-GCM' as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

const base642ab = (base64: string): ArrayBuffer => {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
};

const ab2base64 = (buffer: ArrayBuffer): string => {
  const binary = Array.prototype.map
    .call(new Uint8Array(buffer), (byte: number) => String.fromCharCode(byte))
    .join('');
  return window.btoa(binary);
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

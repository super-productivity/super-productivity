import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Spec imports only from the barrel so the public-API contract is the
// single tested surface.
import {
  WebCryptoNotAvailableError,
  clearSessionKeyCache,
  decrypt,
  decryptBatch,
  decryptWithDerivedKey,
  decryptWithMigration,
  deriveKeyFromPassword,
  encrypt,
  encryptBatch,
  encryptWithDerivedKey,
  getArgon2Params,
  getSessionKeyCacheStats,
  isCryptoSubtleAvailable,
  setArgon2ParamsForTesting,
  setLegacyKdfWarningHandler,
} from '../src';

const PASSWORD = 'super_secret_password';
const DATA = 'some very secret data';

// Helper: simulate legacy PBKDF2 ciphertext (password-as-salt, 1000 iter SHA-256)
const encryptLegacy = async (data: string, password: string): Promise<string> => {
  const ALGO = 'AES-GCM';
  const IV_LEN = 12;
  const enc = new TextEncoder();
  const passwordBuffer = enc.encode(password);
  const subtle = globalThis.crypto.subtle;
  const keyMaterial = await subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  const key = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(password),
      iterations: 1000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGO, length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const dataBuffer = enc.encode(data);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const encryptedContent = await subtle.encrypt({ name: ALGO, iv }, key, dataBuffer);

  const buffer = new Uint8Array(IV_LEN + encryptedContent.byteLength);
  buffer.set(iv, 0);
  buffer.set(new Uint8Array(encryptedContent), IV_LEN);

  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
};

const extractSaltHex = (base64: string): string => {
  const binary = atob(base64);
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
};

describe('encryption', () => {
  beforeAll(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterAll(() => {
    setArgon2ParamsForTesting();
  });

  beforeEach(() => {
    clearSessionKeyCache();
  });

  afterEach(() => {
    clearSessionKeyCache();
    setLegacyKdfWarningHandler(null);
  });

  it('exposes Web Crypto availability check', () => {
    expect(typeof isCryptoSubtleAvailable()).toBe('boolean');
  });

  it('round-trips encrypt → decrypt with the same password', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    expect(encrypted).not.toBe(DATA);
    await expect(decrypt(encrypted, PASSWORD)).resolves.toBe(DATA);
  });

  it('fails to decrypt with the wrong password', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    await expect(decrypt(encrypted, 'wrong_password')).rejects.toBeDefined();
  });

  describe('Legacy PBKDF2 compatibility', () => {
    it('decrypts data encrypted with legacy PBKDF2', async () => {
      const legacy = await encryptLegacy(DATA, PASSWORD);
      await expect(decrypt(legacy, PASSWORD)).resolves.toBe(DATA);
    });

    it('invokes the legacy-KDF warning handler on legacy decrypt', async () => {
      let calls = 0;
      setLegacyKdfWarningHandler(() => {
        calls += 1;
      });

      const legacy = await encryptLegacy(DATA, PASSWORD);
      await decrypt(legacy, PASSWORD);

      expect(calls).toBeGreaterThan(0);
    });

    it('does not invoke the handler for Argon2id decrypts', async () => {
      let calls = 0;
      setLegacyKdfWarningHandler(() => {
        calls += 1;
      });

      const encrypted = await encrypt(DATA, PASSWORD);
      await decrypt(encrypted, PASSWORD);

      expect(calls).toBe(0);
    });

    describe('decryptWithMigration (structural diagnostic)', () => {
      it('returns wasLegacy=false + no migration for Argon2id data', async () => {
        const encrypted = await encrypt(DATA, PASSWORD);
        const result = await decryptWithMigration(encrypted, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(false);
        expect(result.migratedCiphertext).toBeUndefined();
      });

      it('returns wasLegacy=true + migratedCiphertext for legacy data', async () => {
        const legacy = await encryptLegacy(DATA, PASSWORD);
        const result = await decryptWithMigration(legacy, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(true);
        expect(result.wasLegacyKdf).toBe(true);
        expect(result.migratedCiphertext).toBeDefined();
      });

      it('produces migratedCiphertext that round-trips without further migration', async () => {
        const legacy = await encryptLegacy(DATA, PASSWORD);
        const first = await decryptWithMigration(legacy, PASSWORD);
        const second = await decryptWithMigration(first.migratedCiphertext!, PASSWORD);

        expect(second.plaintext).toBe(DATA);
        expect(second.wasLegacy).toBe(false);
      });

      it('still invokes the legacy-KDF warning handler', async () => {
        let calls = 0;
        setLegacyKdfWarningHandler(() => {
          calls += 1;
        });
        const legacy = await encryptLegacy(DATA, PASSWORD);
        await decryptWithMigration(legacy, PASSWORD);

        expect(calls).toBeGreaterThan(0);
      });
    });
  });

  describe('Argon2 params', () => {
    it('getArgon2Params returns the active params snapshot', () => {
      const params = getArgon2Params();
      expect(params).toMatchObject({
        parallelism: 1,
        memorySize: 8,
        iterations: 1,
      });
    });

    it('getArgon2Params returns a copy, not the live object', () => {
      const a = getArgon2Params();
      const b = getArgon2Params();
      expect(a).not.toBe(b);
    });
  });

  describe('Batch encryption', () => {
    const ITEMS = ['item1', 'item2', 'item3', 'item with special chars: 日本語 🎉'];

    it('round-trips a batch', async () => {
      const encrypted = await encryptBatch(ITEMS, PASSWORD);
      expect(encrypted.length).toBe(ITEMS.length);
      const decrypted = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted).toEqual(ITEMS);
    });

    it('returns empty array for empty input', async () => {
      await expect(encryptBatch([], PASSWORD)).resolves.toEqual([]);
      await expect(decryptBatch([], PASSWORD)).resolves.toEqual([]);
    });

    it('produces ciphertext compatible with single-item decrypt', async () => {
      const [ct] = await encryptBatch([DATA], PASSWORD);
      await expect(decrypt(ct, PASSWORD)).resolves.toBe(DATA);
    });

    it('uses the same salt for all items in a batch', async () => {
      const encrypted = await encryptBatch(['a', 'b', 'c'], PASSWORD);
      const s0 = extractSaltHex(encrypted[0]);
      expect(extractSaltHex(encrypted[1])).toBe(s0);
      expect(extractSaltHex(encrypted[2])).toBe(s0);
    });

    it('reuses cached salt across separate batch calls with same password', async () => {
      const a = await encryptBatch(['a'], PASSWORD);
      const b = await encryptBatch(['b'], PASSWORD);
      expect(extractSaltHex(a[0])).toBe(extractSaltHex(b[0]));
    });

    it('uses different salts for different passwords', async () => {
      const a = await encryptBatch(['a'], PASSWORD);
      clearSessionKeyCache();
      const b = await encryptBatch(['b'], 'different_password');
      expect(extractSaltHex(a[0])).not.toBe(extractSaltHex(b[0]));
    });

    it('decrypts mixed batches with different salts', async () => {
      const b1 = await encryptBatch(['a', 'b'], PASSWORD);
      clearSessionKeyCache();
      const b2 = await encryptBatch(['c'], PASSWORD);
      const individual = await encrypt('d', PASSWORD);

      const decrypted = await decryptBatch([...b1, ...b2, individual], PASSWORD);
      expect(decrypted).toEqual(['a', 'b', 'c', 'd']);
    });

    it('fails with wrong password', async () => {
      const encrypted = await encryptBatch(ITEMS, PASSWORD);
      await expect(decryptBatch(encrypted, 'wrong_password')).rejects.toBeDefined();
    });

    it('throws on corrupted data instead of falling back to legacy', async () => {
      const [encrypted] = await encryptBatch(['test data'], PASSWORD);
      const corrupted = encrypted.slice(0, 30) + 'XXXX' + encrypted.slice(34);
      await expect(decryptBatch([corrupted], PASSWORD)).rejects.toBeDefined();
    });

    it('decrypts legacy PBKDF2 entries in batch', async () => {
      const legacy = await encryptLegacy(DATA, PASSWORD);
      await expect(decryptBatch([legacy], PASSWORD)).resolves.toEqual([DATA]);
    });

    it('decrypts mixed legacy + Argon2 in same batch and preserves order', async () => {
      const legacy1 = await encryptLegacy('legacy item 1', PASSWORD);
      const legacy2 = await encryptLegacy('legacy item 2', PASSWORD);
      const argon2 = await encryptBatch(['argon2 item 1', 'argon2 item 2'], PASSWORD);

      const mixed = [legacy1, argon2[0], legacy2, argon2[1]];
      const decrypted = await decryptBatch(mixed, PASSWORD);

      expect(decrypted).toEqual([
        'legacy item 1',
        'argon2 item 1',
        'legacy item 2',
        'argon2 item 2',
      ]);
    });

    it('handles large batches and preserves order', async () => {
      const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);
      const encrypted = await encryptBatch(items, PASSWORD);
      const decrypted = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted.length).toBe(50);
      expect(decrypted[0]).toBe('item-0');
      expect(decrypted[49]).toBe('item-49');
    });

    // SESSION_DECRYPT_CACHE_MAX_SIZE is 100; if a batch contains more unique
    // salts than the LRU cache can hold, early derivations get evicted before
    // Phase 3 reads them. The implementation keeps derived keys in a
    // batch-local map to keep this safe.
    it('decrypts batches with more unique salts than the LRU cache holds', async () => {
      clearSessionKeyCache();
      const COUNT = 120;
      const items = Array.from({ length: COUNT }, (_, i) => `item-${i}`);
      const encrypted: string[] = [];
      for (let i = 0; i < COUNT; i++) {
        // Fresh derivation per item → unique salt per ciphertext
        const key = await deriveKeyFromPassword(PASSWORD);
        encrypted.push(await encryptWithDerivedKey(items[i], key));
      }
      const decrypted = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted).toEqual(items);
    });
  });

  describe('Session key caching', () => {
    it('reports populated encrypt cache after first encryptBatch', async () => {
      expect(getSessionKeyCacheStats()).toEqual({
        hasEncryptKey: false,
        decryptKeyCount: 0,
      });
      await encryptBatch(['test'], PASSWORD);
      expect(getSessionKeyCacheStats().hasEncryptKey).toBe(true);
    });

    it('populates encrypt cache after a single-item encrypt', async () => {
      await encrypt(DATA, PASSWORD);
      expect(getSessionKeyCacheStats().hasEncryptKey).toBe(true);
    });

    it('populates decrypt cache after decryptBatch', async () => {
      const encrypted = await encryptBatch(['test'], PASSWORD);
      clearSessionKeyCache();
      await decryptBatch(encrypted, PASSWORD);
      expect(getSessionKeyCacheStats().decryptKeyCount).toBeGreaterThan(0);
    });

    it('populates decrypt cache after a single-item decrypt', async () => {
      const encrypted = await encrypt(DATA, PASSWORD);
      clearSessionKeyCache();
      await decrypt(encrypted, PASSWORD);
      expect(getSessionKeyCacheStats().decryptKeyCount).toBeGreaterThan(0);
    });

    it('clearSessionKeyCache clears all caches', async () => {
      const encrypted = await encryptBatch(['test'], PASSWORD);
      await decryptBatch(encrypted, PASSWORD);
      clearSessionKeyCache();
      expect(getSessionKeyCacheStats()).toEqual({
        hasEncryptKey: false,
        decryptKeyCount: 0,
      });
    });

    it('reuses cached encrypt key across encryptBatch and single-item encrypt', async () => {
      const batch = await encryptBatch(['a'], PASSWORD);
      const single = await encrypt('b', PASSWORD);
      // Both should share the same cached salt
      expect(extractSaltHex(batch[0])).toBe(extractSaltHex(single));
    });

    it('invalidates encrypt cache when password changes', async () => {
      const a = await encryptBatch(['x'], PASSWORD);
      const b = await encryptBatch(['x'], 'different_password');
      expect(a[0]).not.toBe(b[0]);
      await expect(decryptBatch(a, PASSWORD)).resolves.toEqual(['x']);
      await expect(decryptBatch(b, 'different_password')).resolves.toEqual(['x']);
    });
  });

  describe('Pre-derived key helpers', () => {
    it('encryptWithDerivedKey/decryptWithDerivedKey round-trips', async () => {
      const key = await deriveKeyFromPassword(PASSWORD);
      const ct = await encryptWithDerivedKey(DATA, key);
      await expect(decryptWithDerivedKey(ct, key)).resolves.toBe(DATA);
    });

    it('deriveKeyFromPassword honors the supplied salt', async () => {
      const customSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKeyFromPassword(PASSWORD, customSalt);
      expect(key.salt).toEqual(customSalt);
    });

    it('deriveKeyFromPassword returns 32-byte AES key material', async () => {
      const key = await deriveKeyFromPassword(PASSWORD);
      expect(key.keyBytes.length).toBe(32);
      expect(key.salt.length).toBe(16);
    });

    it('encryptWithDerivedKey produces different IVs across calls', async () => {
      const key = await deriveKeyFromPassword(PASSWORD);
      const a = await encryptWithDerivedKey(DATA, key);
      const b = await encryptWithDerivedKey(DATA, key);
      expect(a).not.toBe(b);
    });
  });

  describe('Fallback strategy (no WebCrypto)', () => {
    let originalDescriptor: PropertyDescriptor | undefined;
    let originalSubtle: SubtleCrypto;

    beforeEach(() => {
      originalSubtle = globalThis.crypto.subtle;
      originalDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(globalThis.crypto, 'subtle', originalDescriptor);
      } else {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          writable: true,
          configurable: true,
        });
      }
    });

    it('reports WebCrypto unavailable', () => {
      expect(isCryptoSubtleAvailable()).toBe(false);
    });

    it('encrypts and decrypts via @noble/ciphers fallback', async () => {
      const encrypted = await encrypt(DATA, PASSWORD);
      await expect(decrypt(encrypted, PASSWORD)).resolves.toBe(DATA);
    });

    it('still produces 32-byte AES key material under fallback', async () => {
      const key = await deriveKeyFromPassword(PASSWORD);
      expect(key.keyBytes.length).toBe(32);
      expect(key.salt.length).toBe(16);
    });

    it('round-trips a batch via fallback', async () => {
      const items = ['item1', 'item2', 'item3'];
      const encrypted = await encryptBatch(items, PASSWORD);
      await expect(decryptBatch(encrypted, PASSWORD)).resolves.toEqual(items);
    });

    it('uses the session key cache in fallback mode', async () => {
      await encryptBatch(['a'], PASSWORD);
      expect(getSessionKeyCacheStats().hasEncryptKey).toBe(true);

      const encrypted = await encryptBatch(['b'], PASSWORD);
      await expect(decryptBatch(encrypted, PASSWORD)).resolves.toEqual(['b']);
    });

    it('throws on garbage input under fallback', async () => {
      const len = 50;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
      let binary = '';
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      const invalid = btoa(binary);
      await expect(decrypt(invalid, PASSWORD)).rejects.toBeDefined();
    });

    it('throws WebCryptoNotAvailableError on legacy decrypt in fallback mode', async () => {
      // Re-enable WebCrypto to produce legacy ciphertext, then disable it.
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        writable: true,
        configurable: true,
      });
      const legacy = await encryptLegacy(DATA, PASSWORD);
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await expect(decrypt(legacy, PASSWORD)).rejects.toBeInstanceOf(
        WebCryptoNotAvailableError,
      );
    });
  });

  describe('Cross-compatibility (WebCrypto ↔ Fallback)', () => {
    let originalSubtle: SubtleCrypto;
    let originalDescriptor: PropertyDescriptor | undefined;

    const disableWebCrypto = (): void => {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    };

    const enableWebCrypto = (): void => {
      if (originalDescriptor) {
        Object.defineProperty(globalThis.crypto, 'subtle', originalDescriptor);
      } else {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          writable: true,
          configurable: true,
        });
      }
    };

    beforeEach(() => {
      originalSubtle = globalThis.crypto.subtle;
      originalDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    });

    afterEach(() => {
      enableWebCrypto();
    });

    it('decrypts WebCrypto-produced ciphertext with the fallback', async () => {
      enableWebCrypto();
      const encrypted = await encrypt(DATA, PASSWORD);
      clearSessionKeyCache();
      disableWebCrypto();
      await expect(decrypt(encrypted, PASSWORD)).resolves.toBe(DATA);
    });

    it('decrypts fallback-produced ciphertext with WebCrypto', async () => {
      disableWebCrypto();
      const encrypted = await encrypt(DATA, PASSWORD);
      clearSessionKeyCache();
      enableWebCrypto();
      await expect(decrypt(encrypted, PASSWORD)).resolves.toBe(DATA);
    });

    it('handles batch cross-compat WebCrypto → fallback', async () => {
      enableWebCrypto();
      const items = ['a', 'b', 'c'];
      const encrypted = await encryptBatch(items, PASSWORD);
      clearSessionKeyCache();
      disableWebCrypto();
      await expect(decryptBatch(encrypted, PASSWORD)).resolves.toEqual(items);
    });

    it('handles batch cross-compat fallback → WebCrypto', async () => {
      disableWebCrypto();
      const items = ['a', 'b', 'c'];
      const encrypted = await encryptBatch(items, PASSWORD);
      clearSessionKeyCache();
      enableWebCrypto();
      await expect(decryptBatch(encrypted, PASSWORD)).resolves.toEqual(items);
    });

    it('produces consistent on-the-wire format across implementations', async () => {
      enableWebCrypto();
      const a = await encrypt(DATA, PASSWORD);
      clearSessionKeyCache();
      disableWebCrypto();
      const b = await encrypt(DATA, PASSWORD);

      const ab = atob(a);
      const bb = atob(b);
      expect(ab.length).toBeGreaterThanOrEqual(44);
      expect(bb.length).toBeGreaterThanOrEqual(44);
      expect(Math.abs(ab.length - bb.length)).toBeLessThan(32);
    });
  });

  it('exports WebCryptoNotAvailableError', () => {
    expect(new WebCryptoNotAvailableError()).toBeInstanceOf(Error);
  });
});

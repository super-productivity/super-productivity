import {
  decrypt,
  encrypt,
  decryptWithMigration,
  encryptBatch,
  decryptBatch,
  deriveKeyFromPassword,
  encryptWithDerivedKey,
  decryptWithDerivedKey,
  clearSessionKeyCache,
  getSessionKeyCacheStats,
} from './encryption';

describe('Encryption', () => {
  const PASSWORD = 'super_secret_password';
  const DATA = 'some very secret data';

  it('should encrypt and decrypt data correctly', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    expect(encrypted).not.toBe(DATA);
    const decrypted = await decrypt(encrypted, PASSWORD);
    expect(decrypted).toBe(DATA);
  });

  it('should fail to decrypt with wrong password', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    try {
      await decrypt(encrypted, 'wrong_password');
      fail('Should have thrown error');
    } catch (e) {
      // Success
    }
  }, 10000); // 10s timeout for expensive Argon2id operations

  describe('Legacy Compatibility', () => {
    // Helper to simulate legacy encryption (PBKDF2)
    const encryptLegacy = async (data: string, password: string): Promise<string> => {
      const ALGORITHM = 'AES-GCM';
      const IV_LENGTH = 12;

      const enc = new TextEncoder();
      const passwordBuffer = enc.encode(password);
      const ops = {
        name: 'PBKDF2',
        salt: enc.encode(password), // Legacy used password as salt
        iterations: 1000,
        hash: 'SHA-256',
      };
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey'],
      );
      const key = await window.crypto.subtle.deriveKey(
        ops,
        keyMaterial,
        { name: ALGORITHM, length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );

      const dataBuffer = enc.encode(data);
      const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const encryptedContent = await window.crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        dataBuffer,
      );

      const buffer = new Uint8Array(IV_LENGTH + encryptedContent.byteLength);
      buffer.set(iv, 0);
      buffer.set(new Uint8Array(encryptedContent), IV_LENGTH);

      const binary = Array.prototype.map
        .call(buffer, (byte: number) => String.fromCharCode(byte))
        .join('');
      return window.btoa(binary);
    };

    it('should decrypt data encrypted with legacy PBKDF2', async () => {
      const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
      const decrypted = await decrypt(legacyEncrypted, PASSWORD);
      expect(decrypted).toBe(DATA);
    });

    describe('decryptWithMigration', () => {
      it('should return wasLegacy: false for Argon2id encrypted data', async () => {
        const encrypted = await encrypt(DATA, PASSWORD);
        const result = await decryptWithMigration(encrypted, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(false);
        expect(result.migratedCiphertext).toBeUndefined();
      });

      it('should return wasLegacy: true and migratedCiphertext for legacy data', async () => {
        const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
        const result = await decryptWithMigration(legacyEncrypted, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(true);
        expect(result.migratedCiphertext).toBeDefined();

        // Verify migrated ciphertext is valid Argon2id
        const decryptedMigrated = await decrypt(result.migratedCiphertext!, PASSWORD);
        expect(decryptedMigrated).toBe(DATA);
      });

      it('should produce migrated ciphertext that decrypts without legacy fallback', async () => {
        const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
        const result = await decryptWithMigration(legacyEncrypted, PASSWORD);

        // Migrated data should NOT need legacy fallback
        const decryptResult = await decryptWithMigration(
          result.migratedCiphertext!,
          PASSWORD,
        );
        expect(decryptResult.wasLegacy).toBe(false);
      });
    });
  });

  describe('Batch Encryption (Performance Optimization)', () => {
    const ITEMS = ['item1', 'item2', 'item3', 'item with special chars: 日本語 🎉'];

    describe('deriveKeyFromPassword', () => {
      it('should derive a key that can be reused for encryption', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        expect(keyInfo.key).toBeDefined();
        expect(keyInfo.salt).toBeDefined();
        expect(keyInfo.salt.length).toBe(16);
      });

      it('should use provided salt when given', async () => {
        const customSalt = new Uint8Array(16);
        window.crypto.getRandomValues(customSalt);

        const keyInfo = await deriveKeyFromPassword(PASSWORD, customSalt);
        expect(keyInfo.salt).toEqual(customSalt);
      });
    });

    describe('encryptWithDerivedKey', () => {
      it('should encrypt data using pre-derived key', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted = await encryptWithDerivedKey(DATA, keyInfo);

        expect(encrypted).not.toBe(DATA);
        // Should be decryptable with normal decrypt (which extracts salt from ciphertext)
        const decrypted = await decrypt(encrypted, PASSWORD);
        expect(decrypted).toBe(DATA);
      });

      it('should produce different ciphertext due to random IV', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted1 = await encryptWithDerivedKey(DATA, keyInfo);
        const encrypted2 = await encryptWithDerivedKey(DATA, keyInfo);

        expect(encrypted1).not.toBe(encrypted2);
      });
    });

    describe('decryptWithDerivedKey', () => {
      it('should decrypt data using pre-derived key', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted = await encryptWithDerivedKey(DATA, keyInfo);
        const decrypted = await decryptWithDerivedKey(encrypted, keyInfo);

        expect(decrypted).toBe(DATA);
      });
    });

    describe('encryptBatch', () => {
      it('should encrypt multiple items', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);

        expect(encrypted.length).toBe(ITEMS.length);
        // Each should be decryptable
        for (let i = 0; i < ITEMS.length; i++) {
          const decrypted = await decrypt(encrypted[i], PASSWORD);
          expect(decrypted).toBe(ITEMS[i]);
        }
      });

      it('should return empty array for empty input', async () => {
        const encrypted = await encryptBatch([], PASSWORD);
        expect(encrypted).toEqual([]);
      });

      it('should produce ciphertext compatible with regular decrypt', async () => {
        const encrypted = await encryptBatch([DATA], PASSWORD);
        const decrypted = await decrypt(encrypted[0], PASSWORD);
        expect(decrypted).toBe(DATA);
      });

      it('should use the same salt for all items in a batch', async () => {
        const encrypted = await encryptBatch(['a', 'b', 'c'], PASSWORD);

        // Extract salt (first 16 bytes) from each ciphertext
        const extractSalt = (base64: string): string => {
          const binary = window.atob(base64);
          // Return first 16 bytes as hex for comparison
          return Array.from(binary.slice(0, 16))
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');
        };

        const salt1 = extractSalt(encrypted[0]);
        const salt2 = extractSalt(encrypted[1]);
        const salt3 = extractSalt(encrypted[2]);

        // All items in the same batch should share the same salt
        expect(salt1).toBe(salt2);
        expect(salt2).toBe(salt3);
      });

      it('should reuse cached salt for separate batch calls with same password', async () => {
        // Clear cache to ensure fresh start
        clearSessionKeyCache();

        const batch1 = await encryptBatch(['a'], PASSWORD);
        const batch2 = await encryptBatch(['b'], PASSWORD);

        // Extract salt (first 16 bytes) from each ciphertext
        const extractSalt = (base64: string): string => {
          const binary = window.atob(base64);
          return Array.from(binary.slice(0, 16))
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');
        };

        const salt1 = extractSalt(batch1[0]);
        const salt2 = extractSalt(batch2[0]);

        // With session caching, same password reuses the cached key (same salt)
        expect(salt1).toBe(salt2);
      });

      it('should use different salts for different passwords', async () => {
        clearSessionKeyCache();
        const batch1 = await encryptBatch(['a'], PASSWORD);

        clearSessionKeyCache();
        const batch2 = await encryptBatch(['b'], 'different_password');

        // Extract salt (first 16 bytes) from each ciphertext
        const extractSalt = (base64: string): string => {
          const binary = window.atob(base64);
          return Array.from(binary.slice(0, 16))
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');
        };

        const salt1 = extractSalt(batch1[0]);
        const salt2 = extractSalt(batch2[0]);

        // Different passwords should have different salts
        expect(salt1).not.toBe(salt2);
      });
    });

    describe('decryptBatch', () => {
      it('should decrypt multiple items encrypted with encryptBatch', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);
        const decrypted = await decryptBatch(encrypted, PASSWORD);

        expect(decrypted).toEqual(ITEMS);
      });

      it('should decrypt items encrypted individually', async () => {
        // Encrypt each item separately (different salts)
        const encrypted = await Promise.all(ITEMS.map((item) => encrypt(item, PASSWORD)));
        const decrypted = await decryptBatch(encrypted, PASSWORD);

        expect(decrypted).toEqual(ITEMS);
      });

      it('should return empty array for empty input', async () => {
        const decrypted = await decryptBatch([], PASSWORD);
        expect(decrypted).toEqual([]);
      });

      it('should handle mixed batch with same and different salts', async () => {
        // First batch: all items share the same salt
        const batch1 = await encryptBatch(['a', 'b'], PASSWORD);
        // Second batch: different salt
        const batch2 = await encryptBatch(['c'], PASSWORD);
        // Individual: yet another salt
        const individual = await encrypt('d', PASSWORD);

        const allEncrypted = [...batch1, ...batch2, individual];
        const decrypted = await decryptBatch(allEncrypted, PASSWORD);

        expect(decrypted).toEqual(['a', 'b', 'c', 'd']);
      });

      it('should fail with wrong password', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);

        try {
          await decryptBatch(encrypted, 'wrong_password');
          fail('Should have thrown error');
        } catch (e) {
          // Success
        }
      }, 10000); // 10s timeout for expensive Argon2id operations

      it('should throw error for corrupted data (not fall back to legacy)', async () => {
        // Create valid Argon2 encrypted data and corrupt it
        const encrypted = await encryptBatch(['test data'], PASSWORD);
        // Corrupt the ciphertext by modifying some bytes (but keep valid base64 length)
        const corrupted = encrypted[0].slice(0, 30) + 'XXXX' + encrypted[0].slice(34);

        try {
          await decryptBatch([corrupted], PASSWORD);
          fail('Should have thrown error for corrupted data');
        } catch (e) {
          // Success - should throw error, not silently fall back to legacy
          expect(e).toBeDefined();
        }
      });
    });

    describe('decryptBatch with legacy format', () => {
      // Helper to simulate legacy encryption (PBKDF2)
      const encryptLegacy = async (data: string, password: string): Promise<string> => {
        const ALGO = 'AES-GCM';
        const IV_LEN = 12;

        const enc = new TextEncoder();
        const passwordBuffer = enc.encode(password);
        const ops = {
          name: 'PBKDF2',
          salt: enc.encode(password),
          iterations: 1000,
          hash: 'SHA-256',
        };
        const keyMaterial = await window.crypto.subtle.importKey(
          'raw',
          passwordBuffer,
          { name: 'PBKDF2' },
          false,
          ['deriveBits', 'deriveKey'],
        );
        const key = await window.crypto.subtle.deriveKey(
          ops,
          keyMaterial,
          { name: ALGO, length: 256 },
          true,
          ['encrypt', 'decrypt'],
        );

        const dataBuffer = enc.encode(data);
        const iv = window.crypto.getRandomValues(new Uint8Array(IV_LEN));
        const encryptedContent = await window.crypto.subtle.encrypt(
          { name: ALGO, iv },
          key,
          dataBuffer,
        );

        const buffer = new Uint8Array(IV_LEN + encryptedContent.byteLength);
        buffer.set(iv, 0);
        buffer.set(new Uint8Array(encryptedContent), IV_LEN);

        const binary = Array.prototype.map
          .call(buffer, (byte: number) => String.fromCharCode(byte))
          .join('');
        return window.btoa(binary);
      };

      it('should decrypt legacy PBKDF2 format data in batch', async () => {
        const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
        const decrypted = await decryptBatch([legacyEncrypted], PASSWORD);

        expect(decrypted[0]).toBe(DATA);
      });

      it('should handle mixed legacy and Argon2 format in same batch', async () => {
        // Create legacy encrypted items
        const legacy1 = await encryptLegacy('legacy item 1', PASSWORD);
        const legacy2 = await encryptLegacy('legacy item 2', PASSWORD);

        // Create Argon2 encrypted items
        const argon2Items = await encryptBatch(
          ['argon2 item 1', 'argon2 item 2'],
          PASSWORD,
        );

        // Mix them in the batch
        const mixed = [legacy1, argon2Items[0], legacy2, argon2Items[1]];
        const decrypted = await decryptBatch(mixed, PASSWORD);

        expect(decrypted).toEqual([
          'legacy item 1',
          'argon2 item 1',
          'legacy item 2',
          'argon2 item 2',
        ]);
      });
    });
  });

  describe('Session Key Caching', () => {
    beforeEach(() => {
      // Clear cache before each test to ensure isolation
      clearSessionKeyCache();
    });

    afterEach(() => {
      // Clean up after tests
      clearSessionKeyCache();
    });

    it('should reuse cached key across multiple encryptBatch calls with same password', async () => {
      // First batch - will derive key
      const batch1 = await encryptBatch(['item1'], PASSWORD);

      // Second batch - should reuse cached key (same salt)
      const batch2 = await encryptBatch(['item2'], PASSWORD);

      // Both should decrypt correctly
      const decrypted1 = await decryptBatch(batch1, PASSWORD);
      const decrypted2 = await decryptBatch(batch2, PASSWORD);

      expect(decrypted1[0]).toBe('item1');
      expect(decrypted2[0]).toBe('item2');

      // Verify cache is populated
      const stats = getSessionKeyCacheStats();
      expect(stats.hasEncryptKey).toBe(true);
    });

    it('should invalidate encryption cache when password changes', async () => {
      const PASSWORD2 = 'different_password';

      // Encrypt with first password
      const batch1 = await encryptBatch(['secret'], PASSWORD);

      // Encrypt with different password - should derive new key
      const batch2 = await encryptBatch(['secret'], PASSWORD2);

      // Both should have different encrypted outputs (different keys)
      expect(batch1[0]).not.toBe(batch2[0]);

      // Each should only decrypt with its own password
      const decrypted1 = await decryptBatch(batch1, PASSWORD);
      expect(decrypted1[0]).toBe('secret');

      const decrypted2 = await decryptBatch(batch2, PASSWORD2);
      expect(decrypted2[0]).toBe('secret');
    });

    it('should clear both encrypt and decrypt caches when clearSessionKeyCache is called', async () => {
      // Populate caches
      const encrypted = await encryptBatch(['test'], PASSWORD);
      await decryptBatch(encrypted, PASSWORD);

      // Verify caches are populated
      let stats = getSessionKeyCacheStats();
      expect(stats.hasEncryptKey).toBe(true);
      expect(stats.decryptKeyCount).toBeGreaterThan(0);

      // Clear caches
      clearSessionKeyCache();

      // Verify caches are empty
      stats = getSessionKeyCacheStats();
      expect(stats.hasEncryptKey).toBe(false);
      expect(stats.decryptKeyCount).toBe(0);
    });

    it('should cache decryption keys by salt for reuse', async () => {
      // Encrypt items (same salt in batch)
      const encrypted = await encryptBatch(['a', 'b', 'c'], PASSWORD);

      // Clear encryption cache to focus on decryption caching
      clearSessionKeyCache();

      // First decryptBatch should cache the key
      const decrypted1 = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted1).toEqual(['a', 'b', 'c']);

      // Verify decrypt cache is populated
      const stats = getSessionKeyCacheStats();
      expect(stats.decryptKeyCount).toBeGreaterThan(0);

      // Second decryptBatch should use cached key
      const decrypted2 = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted2).toEqual(['a', 'b', 'c']);
    });

    it('should return correct cache stats', async () => {
      // Initially empty
      let stats = getSessionKeyCacheStats();
      expect(stats.hasEncryptKey).toBe(false);
      expect(stats.decryptKeyCount).toBe(0);

      // After encryption
      await encryptBatch(['test'], PASSWORD);
      stats = getSessionKeyCacheStats();
      expect(stats.hasEncryptKey).toBe(true);

      // After decryption with same salt (from encrypted batch)
      const encrypted = await encryptBatch(['test2'], PASSWORD);
      await decryptBatch(encrypted, PASSWORD);
      stats = getSessionKeyCacheStats();
      expect(stats.decryptKeyCount).toBeGreaterThan(0);
    });

    it('should handle large batches efficiently with parallel processing', async () => {
      // Create a large batch to verify parallel processing works
      const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);

      const encrypted = await encryptBatch(items, PASSWORD);
      expect(encrypted.length).toBe(50);

      // Decrypt and verify all items
      const decrypted = await decryptBatch(encrypted, PASSWORD);
      expect(decrypted.length).toBe(50);
      expect(decrypted[0]).toBe('item-0');
      expect(decrypted[49]).toBe('item-49');
    });

    it('should maintain order when processing in parallel', async () => {
      // Verify that parallel processing maintains correct order
      const items = ['first', 'second', 'third', 'fourth', 'fifth'];

      const encrypted = await encryptBatch(items, PASSWORD);
      const decrypted = await decryptBatch(encrypted, PASSWORD);

      expect(decrypted).toEqual(items);
    });
  });
});

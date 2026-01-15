import { decrypt, encrypt, decryptWithMigration } from './encryption';

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
});

/**
 * Browser smoke spec for @sp/sync-core encryption primitives.
 *
 * Depth coverage lives in packages/sync-core/tests/encryption.spec.ts (vitest,
 * Node WebCrypto). This spec is the regression net for behavior that only
 * shows up under real Chrome/WebCrypto — e.g. subtle differences in the
 * SubtleCrypto implementation, BigInt/Uint8Array typing, or bundler/dist
 * resolution.
 */

import {
  clearSessionKeyCache,
  decrypt,
  decryptBatch,
  encrypt,
  encryptBatch,
  isCryptoSubtleAvailable,
  setArgon2ParamsForTesting,
} from '@sp/sync-core';

describe('Encryption (browser smoke)', () => {
  const PASSWORD = 'super_secret_password';
  const DATA = 'some very secret data';

  beforeAll(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  afterAll(() => {
    setArgon2ParamsForTesting();
  });

  beforeEach(() => clearSessionKeyCache());
  afterEach(() => clearSessionKeyCache());

  it('reports WebCrypto availability matching actual subtle presence', () => {
    // Karma's Chrome Headless flags can (rarely) drop crypto.subtle; assert
    // consistency with reality rather than a specific value, so this stays
    // useful even if the Karma launcher flags change.
    expect(isCryptoSubtleAvailable()).toBe(
      typeof globalThis.crypto?.subtle !== 'undefined',
    );
  });

  it('round-trips encrypt → decrypt via real WebCrypto', async () => {
    const ct = await encrypt(DATA, PASSWORD);
    expect(ct).not.toBe(DATA);
    expect(await decrypt(ct, PASSWORD)).toBe(DATA);
  });

  it('round-trips encryptBatch → decryptBatch via real WebCrypto', async () => {
    const items = ['a', 'b', 'item with special chars: 日本語 🎉'];
    const ct = await encryptBatch(items, PASSWORD);
    expect(await decryptBatch(ct, PASSWORD)).toEqual(items);
  });

  it('round-trips through the @noble fallback when crypto.subtle is missing', async () => {
    // Real-Chrome mock of an insecure context. The Node spec does this too,
    // but the type acrobatics around defineProperty on window.crypto vs
    // globalThis.crypto are different enough to be worth verifying here.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window.crypto, 'subtle');
    Object.defineProperty(window.crypto, 'subtle', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    try {
      expect(isCryptoSubtleAvailable()).toBe(false);
      const ct = await encrypt(DATA, PASSWORD);
      expect(await decrypt(ct, PASSWORD)).toBe(DATA);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window.crypto, 'subtle', originalDescriptor);
      }
    }
  });

  it('decrypts WebCrypto-encrypted ciphertext via the @noble fallback', async () => {
    // Cross-implementation interop: real Chrome WebCrypto producer, fallback consumer.
    const ct = await encrypt(DATA, PASSWORD);
    clearSessionKeyCache();

    const originalDescriptor = Object.getOwnPropertyDescriptor(window.crypto, 'subtle');
    Object.defineProperty(window.crypto, 'subtle', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    try {
      expect(await decrypt(ct, PASSWORD)).toBe(DATA);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window.crypto, 'subtle', originalDescriptor);
      }
    }
  });
});

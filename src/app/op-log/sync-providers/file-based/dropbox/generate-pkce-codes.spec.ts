import { generatePKCECodes } from './generate-pkce-codes';

describe('generatePKCECodes', () => {
  let originalCrypto: Crypto;

  beforeEach(() => {
    originalCrypto = window.crypto;
  });

  afterEach(() => {
    // Restore original crypto
    Object.defineProperty(window, 'crypto', {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
  });

  it('should throw error when crypto.getRandomValues is unavailable', async () => {
    // Mock crypto without getRandomValues
    Object.defineProperty(window, 'crypto', {
      value: {} as Crypto,
      writable: true,
      configurable: true,
    });

    await expectAsync(generatePKCECodes(128)).toBeRejectedWithError(
      /WebCrypto API.*getRandomValues/i,
    );
  });

  it('should successfully generate PKCE codes when crypto.subtle is unavailable (fallback)', async () => {
    // Mock crypto with getRandomValues but without subtle (simulates Android Capacitor insecure context)
    Object.defineProperty(window, 'crypto', {
      value: {
        getRandomValues: (array: Uint32Array) => {
          // Fill with dummy values
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 0xffffffff);
          }
          return array;
        },
        subtle: undefined,
      } as unknown as Crypto,
      writable: true,
      configurable: true,
    });

    const result = await generatePKCECodes(128);

    expect(result).toBeDefined();
    expect(result.codeVerifier).toBeDefined();
    expect(result.codeChallenge).toBeDefined();
    expect(typeof result.codeVerifier).toBe('string');
    expect(typeof result.codeChallenge).toBe('string');
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.codeChallenge.length).toBeGreaterThan(0);
    // Code challenge should be different from verifier (it's hashed)
    expect(result.codeChallenge).not.toBe(result.codeVerifier);
  });

  it('should successfully generate PKCE codes when WebCrypto is available', async () => {
    // Use real WebCrypto API (already available in test environment)
    const result = await generatePKCECodes(128);

    expect(result).toBeDefined();
    expect(result.codeVerifier).toBeDefined();
    expect(result.codeChallenge).toBeDefined();
    expect(typeof result.codeVerifier).toBe('string');
    expect(typeof result.codeChallenge).toBe('string');
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.codeChallenge.length).toBeGreaterThan(0);
    // Code challenge should be different from verifier (it's hashed)
    expect(result.codeChallenge).not.toBe(result.codeVerifier);
  });
});

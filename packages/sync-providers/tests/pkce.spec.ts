import { describe, expect, it, vi } from 'vitest';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generatePKCECodes,
  type PkceCrypto,
} from '../src';

const createDeterministicCrypto = (): PkceCrypto => ({
  getRandomValues: <T extends Uint8Array>(array: T): T => {
    for (let i = 0; i < array.length; i++) {
      array[i] = i + 1;
    }
    return array;
  },
});

describe('PKCE utilities', () => {
  it('generates URL-safe code verifiers', () => {
    const verifier = generateCodeVerifier({ crypto: createDeterministicCrypto() });

    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBe(43);
  });

  it('generates the RFC 7636 S256 challenge for a known verifier', async () => {
    await expect(
      generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('uses the hash fallback when subtle crypto is unavailable', async () => {
    const sha256Fallback = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);

    const challenge = await generateCodeChallenge('verifier', {
      crypto: createDeterministicCrypto(),
      sha256Fallback,
    });

    expect(sha256Fallback).toHaveBeenCalledOnce();
    expect(challenge).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('uses the hash fallback when global crypto is unavailable', async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const sha256Fallback = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);

    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });

    try {
      const challenge = await generateCodeChallenge('verifier', { sha256Fallback });

      expect(sha256Fallback).toHaveBeenCalledOnce();
      expect(challenge).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    } finally {
      if (cryptoDescriptor) {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'crypto');
      }
    }
  });

  it('generates a verifier and matching challenge pair', async () => {
    const result = await generatePKCECodes({
      crypto: createDeterministicCrypto(),
    });

    await expect(generateCodeChallenge(result.codeVerifier)).resolves.toBe(
      result.codeChallenge,
    );
  });
});

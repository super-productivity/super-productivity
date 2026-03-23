import { generateCodeVerifier, generateCodeChallenge } from './pkce.util';

describe('PKCE utilities', () => {
  describe('generateCodeVerifier', () => {
    it('should return a string of 43-128 characters', () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });

    it('should only contain URL-safe characters', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('should generate unique values', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toEqual(v2);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should return a base64url-encoded SHA-256 hash', async () => {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      // base64url: A-Z, a-z, 0-9, -, _ (no = padding)
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should produce a consistent hash for the same input', async () => {
      const verifier = 'test-verifier-string-for-pkce';
      const c1 = await generateCodeChallenge(verifier);
      const c2 = await generateCodeChallenge(verifier);
      expect(c1).toEqual(c2);
    });
  });
});

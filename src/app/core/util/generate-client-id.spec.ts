import { generateClientId, isValidClientIdFormat } from './generate-client-id';

describe('generate-client-id', () => {
  describe('generateClientId()', () => {
    it('produces an id matching the new {platform}_{6-char} format', () => {
      expect(/^[BEAI]_[a-zA-Z0-9]{6}$/.test(generateClientId())).toBeTrue();
    });

    it('produces a distinct id on each call', () => {
      // 50 random 6-char base62 ids — a collision is astronomically unlikely.
      const ids = new Set(Array.from({ length: 50 }, () => generateClientId()));
      expect(ids.size).toBe(50);
    });

    it('always passes its own format guard', () => {
      for (let i = 0; i < 20; i++) {
        expect(isValidClientIdFormat(generateClientId())).toBeTrue();
      }
    });
  });

  describe('isValidClientIdFormat()', () => {
    it('accepts the new compact format', () => {
      expect(isValidClientIdFormat('B_a7Kx9Z')).toBeTrue();
      expect(isValidClientIdFormat('E_000000')).toBeTrue();
      expect(isValidClientIdFormat('I_ZzZzZz')).toBeTrue();
    });

    it('accepts legacy ids of length >= 10', () => {
      expect(isValidClientIdFormat('LongClientId123')).toBeTrue();
      expect(isValidClientIdFormat('0123456789')).toBeTrue();
    });

    it('rejects short, non-conforming strings', () => {
      expect(isValidClientIdFormat('BAD')).toBeFalse();
      expect(isValidClientIdFormat('')).toBeFalse();
      expect(isValidClientIdFormat('B_a7Kx9')).toBeFalse(); // 5-char suffix
      expect(isValidClientIdFormat('X_a7Kx9Z')).toBeFalse(); // unknown platform
    });

    it('rejects non-string values', () => {
      expect(isValidClientIdFormat(undefined)).toBeFalse();
      expect(isValidClientIdFormat(null)).toBeFalse();
      expect(isValidClientIdFormat(42)).toBeFalse();
      expect(isValidClientIdFormat({})).toBeFalse();
    });
  });
});

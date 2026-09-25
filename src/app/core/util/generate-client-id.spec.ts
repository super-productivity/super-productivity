import { SUPER_SYNC_CLIENT_ID_REGEX } from '@sp/shared-schema';
import { MIN_CLIENT_ID_LENGTH } from '../../op-log/core/operation-log.const';
import {
  generateClientId,
  getClientIdPlatformCode,
  getPlatformCode,
  isValidClientIdFormat,
} from './generate-client-id';

describe('generate-client-id', () => {
  describe('getPlatformCode()', () => {
    const NONE = { isElectron: false, isAndroid: false, isIos: false };

    it('maps each platform to its own character', () => {
      expect(getPlatformCode({ ...NONE, isElectron: true })).toBe('E');
      expect(getPlatformCode({ ...NONE, isAndroid: true })).toBe('A');
      expect(getPlatformCode({ ...NONE, isIos: true })).toBe('I');
      expect(getPlatformCode(NONE)).toBe('B');
    });

    it('resolves overlapping platforms as Electron > Android > iOS', () => {
      // The predicates are independent, so the precedence is a real guard. The
      // near case is macOS Electron, which already matches IS_IOS's `Mac`
      // user-agent half — see the note on getPlatformCode. #9353.
      expect(getPlatformCode({ isElectron: true, isAndroid: true, isIos: true })).toBe(
        'E',
      );
      expect(getPlatformCode({ ...NONE, isAndroid: true, isIos: true })).toBe('A');
    });
  });

  describe('getClientIdPlatformCode()', () => {
    it('decodes every current compact prefix', () => {
      expect(getClientIdPlatformCode('E_FXMz')).toBe('E');
      expect(getClientIdPlatformCode('A_FXMz')).toBe('A');
      expect(getClientIdPlatformCode('I_FXMz')).toBe('I');
      expect(getClientIdPlatformCode('B_FXMz')).toBe('B');
    });

    it('decodes the legacy PFAPI prefixes that map unambiguously', () => {
      // Legacy ids were `{getEnvironmentId()}_{Date.now()}`:
      // Electron produced `E_{os}` and Android WebView the fixed `AND`.
      expect(getClientIdPlatformCode('E_W_1699999999999')).toBe('E');
      expect(getClientIdPlatformCode('AND_1699999999999')).toBe('A');
    });

    it('reports null for prefixes it cannot decode without guessing', () => {
      // Legacy browser ids encoded browser+OS (e.g. `BCL` = Chrome/Linux) —
      // decoding those would need the historical code table.
      expect(getClientIdPlatformCode('BCL_1699999999999')).toBeNull();
      expect(getClientIdPlatformCode('Z_weird1')).toBeNull();
      expect(getClientIdPlatformCode('')).toBeNull();
    });
  });

  describe('generateClientId()', () => {
    it('uses the browser code in the Karma browser env', () => {
      // IS_ELECTRON, IS_ANDROID_WEB_VIEW, IS_IOS_NATIVE and IS_IOS are all false
      // here — same smoke-test shape as get-app-version-str.spec.ts. Per-branch
      // assertions live on getPlatformCode(), since the constants behind them
      // are frozen at module load and cannot be stubbed.
      expect(generateClientId().charAt(0)).toBe('B');
    });

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

    // #9336: these shipped and are still on disk. Rejecting one silently
    // rotates that device's vector-clock key.
    it('accepts every compact shape this app has ever minted', () => {
      expect(isValidClientIdFormat('B_H8AR')).toBeTrue(); // 4-char era, from #6197
      expect(isValidClientIdFormat('B_2Oke')).toBeTrue(); // 4-char era, from #6142
      expect(isValidClientIdFormat('BCL_1736251234567')).toBeTrue(); // legacy PFAPI
      expect(isValidClientIdFormat('AND_1736251234567')).toBeTrue(); // legacy PFAPI
    });

    // Forward compatibility: a future entropy bump or platform code must not
    // require editing this predicate again — that edit is what broke #9336.
    it('accepts shapes this build cannot mint', () => {
      expect(isValidClientIdFormat('B_a7Kx9')).toBeTrue(); // 5-char suffix
      expect(isValidClientIdFormat('X_a7Kx9Z')).toBeTrue(); // unknown platform
      expect(isValidClientIdFormat('E_a7Kx9Z1234')).toBeTrue(); // longer entropy
    });

    it('rejects only ids the system genuinely cannot use', () => {
      expect(isValidClientIdFormat('')).toBeFalse();
      expect(isValidClientIdFormat('BAD')).toBeFalse(); // < MIN_CLIENT_ID_LENGTH
      expect(isValidClientIdFormat('B_a7')).toBeFalse(); // incrementVectorClock throws
      expect(isValidClientIdFormat('B_a7Kx/9')).toBeFalse(); // fails wire charset
    });

    // Anti-drift guard. Deliberately one-directional: the predicate is allowed
    // to be LOOSER than the wire contract (the `>= 10` branch keeps legacy ids
    // whatever they contain), but never tighter — narrowing it is what shipped
    // #9336. Any id SuperSync would carry must be accepted here.
    it('never rejects an id SuperSync would accept', () => {
      const shapes = [
        'B_H8AR',
        'B_2Oke',
        'B_a7Kx9Z',
        'BCL_1736251234567',
        'X_a7Kx9Z',
        'E_a7Kx9Z1234',
        'zz_future_scheme',
      ];
      for (const id of shapes) {
        expect(SUPER_SYNC_CLIENT_ID_REGEX.test(id) && id.length >= MIN_CLIENT_ID_LENGTH)
          .withContext(`fixture unusable on the wire: ${id}`)
          .toBeTrue();
        expect(isValidClientIdFormat(id)).withContext(id).toBeTrue();
      }
    });

    it('rejects non-string values', () => {
      expect(isValidClientIdFormat(undefined)).toBeFalse();
      expect(isValidClientIdFormat(null)).toBeFalse();
      expect(isValidClientIdFormat(42)).toBeFalse();
      expect(isValidClientIdFormat({})).toBeFalse();
    });
  });
});

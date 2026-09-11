import { describe, it, expect } from 'vitest';
import {
  MIN_CHECKPOINT_SAFE_APP_VERSION,
  isAccountCheckpointSafe,
  isCheckpointSafeAppVersion,
  parseAppVersion,
  summarizeCheckpointGate,
} from '../src/sync/checkpoint-gate';

describe('checkpoint gate (#9962)', () => {
  it('pins the cut to the first release with concurrent-safe REPAIR', () => {
    // 78a459294104 landed the narrower REPAIR semantics; v18.21.2 first shipped it.
    expect(MIN_CHECKPOINT_SAFE_APP_VERSION).toBe('18.21.2');
  });

  describe('parseAppVersion', () => {
    it('accepts a bare semver and an optional prerelease tag', () => {
      expect(parseAppVersion('18.22.0')).toBe('18.22.0');
      expect(parseAppVersion('18.23.0-beta.1')).toBe('18.23.0-beta.1');
    });

    it('drops anything that is not a version instead of storing garbage', () => {
      expect(parseAppVersion(undefined)).toBeUndefined();
      expect(parseAppVersion(['18.22.0'])).toBeUndefined();
      expect(parseAppVersion('')).toBeUndefined();
      expect(parseAppVersion('18.22')).toBeUndefined();
      expect(parseAppVersion('v18.22.0')).toBeUndefined();
      expect(parseAppVersion('18.22.0AI')).toBeUndefined();
      expect(parseAppVersion('18.22.0-' + 'x'.repeat(40))).toBeUndefined();
    });
  });

  describe('isCheckpointSafeAppVersion', () => {
    it('is safe at and above the cut', () => {
      expect(isCheckpointSafeAppVersion('18.21.2')).toBe(true);
      expect(isCheckpointSafeAppVersion('18.21.3')).toBe(true);
      expect(isCheckpointSafeAppVersion('18.22.0')).toBe(true);
      expect(isCheckpointSafeAppVersion('19.0.0')).toBe(true);
      expect(isCheckpointSafeAppVersion('18.22.0-beta.1')).toBe(true);
    });

    it('is old below the cut, with numeric (not lexical) comparison', () => {
      expect(isCheckpointSafeAppVersion('18.21.1')).toBe(false);
      expect(isCheckpointSafeAppVersion('18.14.0')).toBe(false);
      expect(isCheckpointSafeAppVersion('18.9.9')).toBe(false);
      expect(isCheckpointSafeAppVersion('9.99.99')).toBe(false);
    });

    it('treats a prerelease of the cut itself as old (may predate the fix)', () => {
      expect(isCheckpointSafeAppVersion('18.21.2-beta.1')).toBe(false);
    });

    it('treats a missing or unparseable version as old', () => {
      expect(isCheckpointSafeAppVersion(null)).toBe(false);
      expect(isCheckpointSafeAppVersion(undefined)).toBe(false);
      expect(isCheckpointSafeAppVersion('')).toBe(false);
      expect(isCheckpointSafeAppVersion('latest')).toBe(false);
    });
  });

  describe('isAccountCheckpointSafe', () => {
    it('requires every device to be safe', () => {
      expect(isAccountCheckpointSafe([{ appVersion: '18.22.0' }])).toBe(true);
      expect(
        isAccountCheckpointSafe([{ appVersion: '18.22.0' }, { appVersion: '18.21.2' }]),
      ).toBe(true);
      expect(
        isAccountCheckpointSafe([{ appVersion: '18.22.0' }, { appVersion: '18.20.0' }]),
      ).toBe(false);
      expect(
        isAccountCheckpointSafe([{ appVersion: '18.22.0' }, { appVersion: null }]),
      ).toBe(false);
    });

    it('is not safe with no devices: nobody to checkpoint, and silence is not consent', () => {
      expect(isAccountCheckpointSafe([])).toBe(false);
    });
  });

  describe('summarizeCheckpointGate', () => {
    it('rolls devices up per account', () => {
      expect(
        summarizeCheckpointGate([
          { userId: 1, appVersion: '18.22.0' },
          { userId: 1, appVersion: '18.21.2' },
          { userId: 2, appVersion: '18.22.0' },
          { userId: 2, appVersion: null },
          { userId: 3, appVersion: '18.20.1' },
          { userId: 4, appVersion: null },
        ]),
      ).toEqual({ safeAccounts: 1, totalAccounts: 4, unversionedDevices: 2 });
    });

    it('reports zeros for an empty window', () => {
      expect(summarizeCheckpointGate([])).toEqual({
        safeAccounts: 0,
        totalAccounts: 0,
        unversionedDevices: 0,
      });
    });
  });
});

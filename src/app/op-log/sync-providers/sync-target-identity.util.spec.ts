import { isSyncTargetChanged } from './sync-target-identity.util';

describe('isSyncTargetChanged', () => {
  const webdavCfg = {
    baseUrl: 'https://a.example/dav',
    userName: 'me',
    password: 'pw',
    syncFolderPath: '/sp',
    encryptKey: 'key-1',
    isEncryptionEnabled: true,
  };

  describe('content-only edits (must NOT invalidate)', () => {
    it('ignores key order', () => {
      // Subsumes the identical-config case; a persist/load round-trip is not
      // guaranteed to preserve key order.
      expect(
        isSyncTargetChanged(
          { baseUrl: 'https://a.example/dav', userName: 'me' },
          { userName: 'me', baseUrl: 'https://a.example/dav' },
        ),
      ).toBe(false);
    });

    it('treats an absent field and an explicit undefined as equal', () => {
      expect(
        isSyncTargetChanged(
          { baseUrl: 'u' },
          { baseUrl: 'u', syncFolderPath: undefined },
        ),
      ).toBe(false);
    });

    it("treats PROVIDER_FIELD_DEFAULTS' '' sentinel as equal to absent", () => {
      // The first save after a new default field lands merges `{field: ''}` onto
      // a config that lacks it; that is not a target move.
      expect(isSyncTargetChanged({ baseUrl: 'u' }, { baseUrl: 'u', password: '' })).toBe(
        false,
      );
    });

    it('ignores an encryption key rotation', () => {
      expect(isSyncTargetChanged(webdavCfg, { ...webdavCfg, encryptKey: 'key-2' })).toBe(
        false,
      );
    });

    it('ignores the GHSA-9544 isEncryptionEnabled backfill', () => {
      // WrappedProviderService._backfillEncryptionIntent writes exactly this
      // (undefined -> true) mid-sync. Firing a target change for it would wipe
      // the seq cursor and abort the in-flight sync it was spawned from.
      const preFix = { ...webdavCfg, isEncryptionEnabled: undefined };
      expect(isSyncTargetChanged(preFix, { ...preFix, isEncryptionEnabled: true })).toBe(
        false,
      );
    });
  });

  describe('target moves (MUST invalidate)', () => {
    it('detects a folder change', () => {
      expect(
        isSyncTargetChanged(webdavCfg, { ...webdavCfg, syncFolderPath: '/other' }),
      ).toBe(true);
    });

    it('still detects clearing a configured folder', () => {
      // The '' <-> absent collapse must not mask a real move: '/foo' -> root.
      expect(
        isSyncTargetChanged({ baseUrl: 'u', syncFolderPath: '/foo' }, { baseUrl: 'u' }),
      ).toBe(true);
    });

    it('detects an OAuth account switch (refresh token replaced)', () => {
      // Dropbox has no account field at all — the tokens ARE the identity, which
      // is why they must stay outside CONTENT_ONLY_CFG_FIELDS.
      const dropbox = { accessToken: 'a1', refreshToken: 'r1' };
      expect(isSyncTargetChanged(dropbox, { ...dropbox, refreshToken: 'r2' })).toBe(true);
    });

    it('treats first-time setup (no previous config) as a change', () => {
      expect(isSyncTargetChanged(null, webdavCfg)).toBe(true);
    });
  });

  it('fails safe: an unrecognised field counts as identity-affecting', () => {
    // Only encryptKey/isEncryptionEnabled are provably content-only. Anything a
    // future provider adds must invalidate rather than silently reuse a cursor —
    // a false negative is silent cross-target corruption, which is worse than
    // the (also bad) spurious full re-read a false positive costs.
    expect(
      isSyncTargetChanged({ baseUrl: 'u' }, { baseUrl: 'u', someNewTargetField: 'x' }),
    ).toBe(true);
  });
});

import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import type { DropboxPrivateCfg } from '@sp/sync-providers/dropbox';
import type { WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import {
  credentialConfigEqual,
  getSuperSyncCredentialBridgeCommand,
} from './android-sync-bridge.effects';

/**
 * Tests for AndroidSyncBridgeEffects credential mirroring logic.
 *
 * Since the actual effect is gated by IS_ANDROID_WEB_VIEW (false in tests),
 * we test the core logic directly: distinctUntilChanged comparator behavior
 * and the credential set/clear decision logic.
 */
describe('AndroidSyncBridgeEffects - credential mirroring logic', () => {
  const superSyncCfg = (
    accessToken: string,
    baseUrl?: string,
  ): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.SuperSync,
    privateCfg: { accessToken, baseUrl } as SuperSyncPrivateCfg,
  });

  const dropboxCfg = (): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.Dropbox,
    privateCfg: { accessToken: 'dropbox-token' } as DropboxPrivateCfg,
  });

  describe('distinctUntilChanged comparator', () => {
    it('should detect provider change from null to SuperSync', () => {
      expect(credentialConfigEqual(null, superSyncCfg('token1'))).toBe(false);
    });

    it('should detect provider change from SuperSync to Dropbox', () => {
      expect(credentialConfigEqual(superSyncCfg('token1'), dropboxCfg())).toBe(false);
    });

    it('should detect provider change from Dropbox to SuperSync', () => {
      expect(credentialConfigEqual(dropboxCfg(), superSyncCfg('token1'))).toBe(false);
    });

    it('should detect access token change within SuperSync', () => {
      expect(credentialConfigEqual(superSyncCfg('token1'), superSyncCfg('token2'))).toBe(
        false,
      );
    });

    it('should detect baseUrl change within SuperSync', () => {
      expect(
        credentialConfigEqual(
          superSyncCfg('token1', 'https://a.com'),
          superSyncCfg('token1', 'https://b.com'),
        ),
      ).toBe(false);
    });

    it('should treat same SuperSync credentials as equal', () => {
      expect(
        credentialConfigEqual(
          superSyncCfg('token1', 'https://a.com'),
          superSyncCfg('token1', 'https://a.com'),
        ),
      ).toBe(true);
    });

    it('should treat all non-SuperSync emissions as equal to prevent repeated clears', () => {
      expect(credentialConfigEqual(dropboxCfg(), dropboxCfg())).toBe(true);
    });

    it('should treat two nulls as equal', () => {
      expect(credentialConfigEqual(null, null)).toBe(true);
    });
  });

  describe('credential set/clear decision', () => {
    it('should set credentials for SuperSync with valid token', () => {
      expect(
        getSuperSyncCredentialBridgeCommand(
          superSyncCfg('my-token', 'https://sync.example.com'),
        ),
      ).toEqual({
        type: 'set',
        baseUrl: 'https://sync.example.com',
        accessToken: 'my-token',
      });
    });

    it('should clear when SuperSync has empty access token', () => {
      expect(getSuperSyncCredentialBridgeCommand(superSyncCfg(''))).toEqual({
        type: 'clear',
        reason: 'no-token',
      });
    });

    it('should clear when provider is Dropbox', () => {
      expect(getSuperSyncCredentialBridgeCommand(dropboxCfg())).toEqual({
        type: 'clear',
        reason: 'not-supersync',
      });
    });

    it('should clear when provider is WebDAV', () => {
      const webdavCfg: CurrentProviderPrivateCfg = {
        providerId: SyncProviderId.WebDAV,
        privateCfg: {} as WebdavPrivateCfg,
      };
      expect(getSuperSyncCredentialBridgeCommand(webdavCfg)).toEqual({
        type: 'clear',
        reason: 'not-supersync',
      });
    });

    it('should clear when privateCfg is null', () => {
      const cfg: CurrentProviderPrivateCfg = {
        providerId: SyncProviderId.SuperSync,
        privateCfg: null,
      };
      expect(getSuperSyncCredentialBridgeCommand(cfg)).toEqual({
        type: 'clear',
        reason: 'not-supersync',
      });
    });
  });

  describe('integration: observable filtering', () => {
    it('should only emit on meaningful changes through distinctUntilChanged + filter', () => {
      const source$ = new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);
      const emissions: (CurrentProviderPrivateCfg | null)[] = [];

      const sub = source$
        .pipe(
          distinctUntilChanged(credentialConfigEqual),
          filter((val): val is CurrentProviderPrivateCfg => val !== null),
        )
        .subscribe((val) => {
          emissions.push(val);
        });

      // Initial null — filtered out
      expect(emissions.length).toBe(0);

      // Set SuperSync
      source$.next(superSyncCfg('token1'));
      expect(emissions.length).toBe(1);

      // Same SuperSync credentials — deduplicated
      source$.next(superSyncCfg('token1'));
      expect(emissions.length).toBe(1);

      // Token refresh — emits
      source$.next(superSyncCfg('token2'));
      expect(emissions.length).toBe(2);

      // Switch to Dropbox — emits once
      source$.next(dropboxCfg());
      expect(emissions.length).toBe(3);

      // Dropbox config changes — deduplicated (all non-SuperSync treated equal)
      source$.next(dropboxCfg());
      expect(emissions.length).toBe(3);

      // Switch back to SuperSync — emits
      source$.next(superSyncCfg('token3'));
      expect(emissions.length).toBe(4);

      // Clear to null — filtered out
      source$.next(null);
      expect(emissions.length).toBe(4);

      sub.unsubscribe();
    });
  });
});

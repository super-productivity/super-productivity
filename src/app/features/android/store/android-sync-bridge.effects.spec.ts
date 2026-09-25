import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import type { DropboxPrivateCfg } from '@sp/sync-providers/dropbox';
import type { WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import {
  bridgeCommandEqual,
  getSuperSyncCredentialBridgeCommand,
  SuperSyncCredentialBridgeCommand,
} from './android-sync-bridge.effects';

/**
 * Tests for AndroidSyncBridgeEffects credential mirroring logic.
 *
 * Since the actual effect is gated by IS_ANDROID_WEB_VIEW (false in tests),
 * we test the core logic directly: the credential set/clear decision logic
 * and the command-level dedup used by distinctUntilChanged.
 */
describe('AndroidSyncBridgeEffects - credential mirroring logic', () => {
  const superSyncCfg = (
    accessToken: string,
    baseUrl?: string,
    encryptKey?: string,
  ): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.SuperSync,
    privateCfg: { accessToken, baseUrl, encryptKey } as SuperSyncPrivateCfg,
  });

  const dropboxCfg = (): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.Dropbox,
    privateCfg: { accessToken: 'dropbox-token' } as DropboxPrivateCfg,
  });

  const webdavCfg = (): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.WebDAV,
    privateCfg: {} as WebdavPrivateCfg,
  });

  // Comparator input as the effect produces it: cfg mapped to a command
  const cmd = (
    cfg: CurrentProviderPrivateCfg | null,
  ): SuperSyncCredentialBridgeCommand | null =>
    cfg ? getSuperSyncCredentialBridgeCommand(cfg) : null;

  describe('distinctUntilChanged comparator (bridgeCommandEqual)', () => {
    it('should detect provider change from null to SuperSync', () => {
      expect(bridgeCommandEqual(null, cmd(superSyncCfg('token1')))).toBe(false);
    });

    it('should detect provider change from SuperSync to Dropbox', () => {
      expect(bridgeCommandEqual(cmd(superSyncCfg('token1')), cmd(dropboxCfg()))).toBe(
        false,
      );
    });

    it('should detect access token change within SuperSync', () => {
      expect(
        bridgeCommandEqual(cmd(superSyncCfg('token1')), cmd(superSyncCfg('token2'))),
      ).toBe(false);
    });

    it('should detect baseUrl change within SuperSync', () => {
      expect(
        bridgeCommandEqual(
          cmd(superSyncCfg('token1', 'https://a.com')),
          cmd(superSyncCfg('token1', 'https://b.com')),
        ),
      ).toBe(false);
    });

    it('should treat same SuperSync credentials as equal', () => {
      expect(
        bridgeCommandEqual(
          cmd(superSyncCfg('token1', 'https://a.com')),
          cmd(superSyncCfg('token1', 'https://a.com')),
        ),
      ).toBe(true);
    });

    it('should detect encryption key change within SuperSync', () => {
      expect(
        bridgeCommandEqual(
          cmd(superSyncCfg('token1', 'https://a.com', 'old-pass')),
          cmd(superSyncCfg('token1', 'https://a.com', 'new-pass')),
        ),
      ).toBe(false);
    });

    it('should treat same encryption key as equal', () => {
      expect(
        bridgeCommandEqual(
          cmd(superSyncCfg('token1', 'https://a.com', 'pass')),
          cmd(superSyncCfg('token1', 'https://a.com', 'pass')),
        ),
      ).toBe(true);
    });

    it('should treat all non-SuperSync emissions as equal to prevent repeated clears', () => {
      expect(bridgeCommandEqual(cmd(dropboxCfg()), cmd(dropboxCfg()))).toBe(true);
      // Even across different non-SuperSync providers — same clear command
      expect(bridgeCommandEqual(cmd(dropboxCfg()), cmd(webdavCfg()))).toBe(true);
    });

    it('should distinguish the two clear reasons', () => {
      expect(bridgeCommandEqual(cmd(superSyncCfg('')), cmd(dropboxCfg()))).toBe(false);
    });

    it('should treat two nulls as equal', () => {
      expect(bridgeCommandEqual(null, null)).toBe(true);
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
        encryptionPassword: '',
      });
    });

    it('should include the encryption password when configured', () => {
      expect(
        getSuperSyncCredentialBridgeCommand(
          superSyncCfg('my-token', 'https://sync.example.com', 'my-e2ee-pass'),
        ),
      ).toEqual({
        type: 'set',
        baseUrl: 'https://sync.example.com',
        accessToken: 'my-token',
        encryptionPassword: 'my-e2ee-pass',
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
      expect(getSuperSyncCredentialBridgeCommand(webdavCfg())).toEqual({
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
    it('should only emit on meaningful changes through map + distinctUntilChanged + filter', () => {
      const source$ = new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);
      const emissions: SuperSyncCredentialBridgeCommand[] = [];

      const sub = source$
        .pipe(
          map(cmd),
          distinctUntilChanged(bridgeCommandEqual),
          filter((val): val is SuperSyncCredentialBridgeCommand => val !== null),
        )
        .subscribe((val) => {
          emissions.push(val);
        });

      // Initial null — filtered out
      expect(emissions.length).toBe(0);

      // Set SuperSync
      source$.next(superSyncCfg('token1'));
      expect(emissions.length).toBe(1);
      expect(emissions[0].type).toBe('set');

      // Same SuperSync credentials — deduplicated
      source$.next(superSyncCfg('token1'));
      expect(emissions.length).toBe(1);

      // Token refresh — emits
      source$.next(superSyncCfg('token2'));
      expect(emissions.length).toBe(2);

      // Switch to Dropbox — emits one clear
      source$.next(dropboxCfg());
      expect(emissions.length).toBe(3);
      expect(emissions[2]).toEqual({ type: 'clear', reason: 'not-supersync' });

      // Switching among non-SuperSync providers — deduplicated (same clear command)
      source$.next(dropboxCfg());
      source$.next(webdavCfg());
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

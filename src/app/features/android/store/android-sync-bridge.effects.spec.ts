import { BehaviorSubject } from 'rxjs';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';
import { SuperSyncPrivateCfg } from '../../../op-log/sync-providers/super-sync/super-sync.model';

/**
 * Tests for AndroidSyncBridgeEffects credential mirroring logic.
 *
 * Since the actual effect is gated by IS_ANDROID_WEB_VIEW (false in tests),
 * we test the core logic directly: distinctUntilChanged comparator behavior
 * and the credential set/clear decision logic.
 */
describe('AndroidSyncBridgeEffects - credential mirroring logic', () => {
  /**
   * Re-implements the distinctUntilChanged comparator from the effect
   * so we can verify its behavior in isolation.
   */
  const isEqual = (
    a: CurrentProviderPrivateCfg | null,
    b: CurrentProviderPrivateCfg | null,
  ): boolean => {
    if (a?.providerId !== b?.providerId) return false;
    if (a?.providerId !== SyncProviderId.SuperSync) return true;
    const aCfg = a?.privateCfg as SuperSyncPrivateCfg | undefined;
    const bCfg = b?.privateCfg as SuperSyncPrivateCfg | undefined;
    return aCfg?.accessToken === bCfg?.accessToken && aCfg?.baseUrl === bCfg?.baseUrl;
  };

  /**
   * Re-implements the tap logic that decides whether to set or clear credentials.
   */
  const getAction = (
    cfg: CurrentProviderPrivateCfg,
  ): 'set' | 'clear-no-token' | 'clear-not-supersync' => {
    if (cfg.providerId === SyncProviderId.SuperSync && cfg.privateCfg) {
      const privateCfg = cfg.privateCfg as SuperSyncPrivateCfg;
      if (privateCfg.accessToken) {
        return 'set';
      } else {
        return 'clear-no-token';
      }
    } else {
      return 'clear-not-supersync';
    }
  };

  const superSyncCfg = (
    accessToken: string,
    baseUrl?: string,
  ): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.SuperSync,
    privateCfg: { accessToken, baseUrl } as SuperSyncPrivateCfg,
  });

  const dropboxCfg = (): CurrentProviderPrivateCfg => ({
    providerId: SyncProviderId.Dropbox,
    privateCfg: { accessToken: 'dropbox-token' } as any,
  });

  describe('distinctUntilChanged comparator', () => {
    it('should detect provider change from null to SuperSync', () => {
      expect(isEqual(null, superSyncCfg('token1'))).toBe(false);
    });

    it('should detect provider change from SuperSync to Dropbox', () => {
      expect(isEqual(superSyncCfg('token1'), dropboxCfg())).toBe(false);
    });

    it('should detect provider change from Dropbox to SuperSync', () => {
      expect(isEqual(dropboxCfg(), superSyncCfg('token1'))).toBe(false);
    });

    it('should detect access token change within SuperSync', () => {
      expect(isEqual(superSyncCfg('token1'), superSyncCfg('token2'))).toBe(false);
    });

    it('should detect baseUrl change within SuperSync', () => {
      expect(
        isEqual(
          superSyncCfg('token1', 'https://a.com'),
          superSyncCfg('token1', 'https://b.com'),
        ),
      ).toBe(false);
    });

    it('should treat same SuperSync credentials as equal', () => {
      expect(
        isEqual(
          superSyncCfg('token1', 'https://a.com'),
          superSyncCfg('token1', 'https://a.com'),
        ),
      ).toBe(true);
    });

    it('should treat all non-SuperSync emissions as equal to prevent repeated clears', () => {
      expect(isEqual(dropboxCfg(), dropboxCfg())).toBe(true);
    });

    it('should treat two nulls as equal', () => {
      expect(isEqual(null, null)).toBe(true);
    });
  });

  describe('credential set/clear decision', () => {
    it('should set credentials for SuperSync with valid token', () => {
      expect(getAction(superSyncCfg('my-token', 'https://sync.example.com'))).toBe('set');
    });

    it('should clear when SuperSync has empty access token', () => {
      expect(getAction(superSyncCfg(''))).toBe('clear-no-token');
    });

    it('should clear when provider is Dropbox', () => {
      expect(getAction(dropboxCfg())).toBe('clear-not-supersync');
    });

    it('should clear when provider is WebDAV', () => {
      const webdavCfg: CurrentProviderPrivateCfg = {
        providerId: SyncProviderId.WebDAV,
        privateCfg: {} as any,
      };
      expect(getAction(webdavCfg)).toBe('clear-not-supersync');
    });

    it('should clear when privateCfg is null', () => {
      const cfg: CurrentProviderPrivateCfg = {
        providerId: SyncProviderId.SuperSync,
        privateCfg: null,
      };
      expect(getAction(cfg)).toBe('clear-not-supersync');
    });
  });

  describe('integration: observable filtering', () => {
    it('should only emit on meaningful changes through distinctUntilChanged + filter', () => {
      const source$ = new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);
      const emissions: (CurrentProviderPrivateCfg | null)[] = [];
      let lastEmitted: CurrentProviderPrivateCfg | null = undefined as any;

      // Simulate the pipeline: skipWhileApplyingRemoteOps -> distinctUntilChanged -> filter
      const sub = source$.subscribe((val) => {
        // distinctUntilChanged
        if (lastEmitted !== undefined && isEqual(lastEmitted, val)) return;
        lastEmitted = val;
        // filter (cfg !== null)
        if (val === null) return;
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

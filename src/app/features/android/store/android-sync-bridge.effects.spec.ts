import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';
import type { SuperSyncPrivateCfg } from '@sp/sync-providers/super-sync';
import type { DropboxPrivateCfg } from '@sp/sync-providers/dropbox';
import type { WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import { ReminderConfig } from '../../config/global-config.model';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../config/global-config.service';
import {
  AndroidSyncBridgeEffects,
  bridgeCommandEqual,
  getBackgroundReminderSettings,
  getCapturePublicKeyForNative,
  getFileSyncCredentialBridgeCommand,
  getSuperSyncCredentialBridgeCommand,
  isBackgroundFileSyncProvider,
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

  describe('file sync command (WebDAV/Nextcloud)', () => {
    const readRequest = {
      url: 'https://dav.example.com/sp/sync-data.json',
      authorization: 'Basic abc',
    };

    it('only treats WebDAV and Nextcloud as background-readable file providers', () => {
      expect(isBackgroundFileSyncProvider(SyncProviderId.WebDAV)).toBe(true);
      expect(isBackgroundFileSyncProvider(SyncProviderId.Nextcloud)).toBe(true);
      expect(isBackgroundFileSyncProvider(SyncProviderId.Dropbox)).toBe(false);
      expect(isBackgroundFileSyncProvider(SyncProviderId.OneDrive)).toBe(false);
      expect(isBackgroundFileSyncProvider(SyncProviderId.LocalFile)).toBe(false);
      expect(isBackgroundFileSyncProvider(SyncProviderId.SuperSync)).toBe(false);
    });

    it('carries the read request and the encryption password', () => {
      expect(
        getFileSyncCredentialBridgeCommand(
          { encryptKey: 'pw', isEncryptionEnabled: true },
          readRequest,
        ),
      ).toEqual({
        type: 'set-file',
        fileUrl: readRequest.url,
        authorization: readRequest.authorization,
        isEncryptionExpected: true,
        encryptionPassword: 'pw',
      });
    });

    it('expects encryption from the key alone on configs without the flag', () => {
      expect(
        getFileSyncCredentialBridgeCommand({ encryptKey: 'pw' }, readRequest)
          .isEncryptionExpected,
      ).toBe(true);
      expect(
        getFileSyncCredentialBridgeCommand({}, readRequest).isEncryptionExpected,
      ).toBe(false);
    });

    it('keeps expecting encryption when the flag is set but the key was dropped', () => {
      const command = getFileSyncCredentialBridgeCommand(
        { isEncryptionEnabled: true },
        readRequest,
      );
      expect(command.isEncryptionExpected).toBe(true);
      expect(command.encryptionPassword).toBe('');
    });

    it('re-emits only when the file target or credentials change', () => {
      const a = getFileSyncCredentialBridgeCommand({}, readRequest);
      expect(
        bridgeCommandEqual(a, getFileSyncCredentialBridgeCommand({}, readRequest)),
      ).toBe(true);
      expect(
        bridgeCommandEqual(
          a,
          getFileSyncCredentialBridgeCommand({}, { ...readRequest, authorization: 'x' }),
        ),
      ).toBe(false);
      expect(bridgeCommandEqual(a, cmd(webdavCfg()))).toBe(false);
    });
  });

  describe('command from the active provider (_toBridgeCommand)', () => {
    const readRequest = {
      url: 'https://dav.example.com/sp/sync-data.json',
      authorization: 'Basic abc',
    };

    const toCommand = (
      provider: unknown,
      cfg: CurrentProviderPrivateCfg | null,
    ): ReturnType<AndroidSyncBridgeEffects['_toBridgeCommand']> => {
      TestBed.configureTestingModule({
        providers: [
          AndroidSyncBridgeEffects,
          {
            provide: SyncProviderManager,
            useValue: { getProviderById: () => Promise.resolve(provider) },
          },
          { provide: GlobalConfigService, useValue: {} },
        ],
      });
      return TestBed.inject(AndroidSyncBridgeEffects)['_toBridgeCommand'](cfg);
    };

    it('asks the WebDAV provider for the sync-data.json read request', async () => {
      const getFileReadRequest = jasmine
        .createSpy('getFileReadRequest')
        .and.resolveTo(readRequest);
      const command = await toCommand({ getFileReadRequest }, webdavCfg());
      expect(getFileReadRequest).toHaveBeenCalledWith('sync-data.json');
      expect(command).toEqual(getFileSyncCredentialBridgeCommand({}, readRequest));
    });

    it('clears when the provider cannot build a read request yet', async () => {
      const getFileReadRequest = (): Promise<never> =>
        Promise.reject(new Error('WebDAV base URL is not configured'));
      expect(await toCommand({ getFileReadRequest }, webdavCfg())).toEqual(
        cmd(webdavCfg()),
      );
    });

    it('clears for a provider without a read request', async () => {
      expect(await toCommand(undefined, webdavCfg())).toEqual(cmd(webdavCfg()));
    });

    it('keeps the SuperSync path for SuperSync', async () => {
      expect(await toCommand(undefined, superSyncCfg('tok', 'https://s'))).toEqual(
        cmd(superSyncCfg('tok', 'https://s')),
      );
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

describe('AndroidSyncBridgeEffects - reminder settings mirroring logic', () => {
  const reminderCfg = (overrides: Partial<ReminderConfig>): ReminderConfig => ({
    isCountdownBannerEnabled: true,
    countdownDuration: 60000,
    ...overrides,
  });

  it('defaults to enabled, non-alarm-style when the config is missing', () => {
    expect(getBackgroundReminderSettings(undefined)).toEqual({
      isDisabled: false,
      useAlarmStyle: false,
    });
  });

  it('mirrors disabled reminders', () => {
    expect(
      getBackgroundReminderSettings(reminderCfg({ disableReminders: true })).isDisabled,
    ).toBe(true);
  });

  it('mirrors alarm-style reminders', () => {
    expect(
      getBackgroundReminderSettings(reminderCfg({ useAlarmStyleReminders: true }))
        .useAlarmStyle,
    ).toBe(true);
  });
});

describe('getCapturePublicKeyForNative', () => {
  const key = { v: 1, privateKeyPkcs8: 'priv', publicKeySpki: 'pub' };

  it('mirrors the public key while capture is on and SuperSync is logged in', () => {
    expect(getCapturePublicKeyForNative(key, true)).toBe('pub');
  });

  it('clears it when capture is off', () => {
    expect(getCapturePublicKeyForNative(null, true)).toBe('');
    expect(getCapturePublicKeyForNative(undefined, true)).toBe('');
  });

  it('clears it without SuperSync credentials, so shares stay local', () => {
    expect(getCapturePublicKeyForNative(key, false)).toBe('');
  });

  it('never mirrors a key from a newer client: its format may differ', () => {
    expect(getCapturePublicKeyForNative({ ...key, v: 2 }, true)).toBe('');
  });
});

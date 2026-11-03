import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { SyncConfig } from '../../../features/config/global-config.model';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import {
  getConnectPlatform,
  normalizeSuperSyncBaseUrl,
  SuperSyncConnectService,
} from './super-sync-connect.service';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Electron/30';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/30';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) Electron/30';

describe('getConnectPlatform', () => {
  it('maps the client platform to the server list', () => {
    expect(getConnectPlatform('A', LINUX_UA)).toBe('android');
    expect(getConnectPlatform('I', MAC_UA)).toBe('ios');
    expect(getConnectPlatform('B', WIN_UA)).toBe('web');
  });

  it('tells the desktop systems apart and falls back to linux', () => {
    expect(getConnectPlatform('E', MAC_UA)).toBe('mac');
    expect(getConnectPlatform('E', WIN_UA)).toBe('windows');
    expect(getConnectPlatform('E', LINUX_UA)).toBe('linux');
    expect(getConnectPlatform('E', 'unknown')).toBe('linux');
  });
});

describe('normalizeSuperSyncBaseUrl', () => {
  it('strips trailing slashes and keeps http and https', () => {
    expect(normalizeSuperSyncBaseUrl(' https://sync.example.com// ')).toBe(
      'https://sync.example.com',
    );
    expect(normalizeSuperSyncBaseUrl('http://192.168.1.5:1901/')).toBe(
      'http://192.168.1.5:1901',
    );
  });

  it('uses the default server for an empty address', () => {
    expect(normalizeSuperSyncBaseUrl('  ')).toBe(
      DEFAULT_GLOBAL_CONFIG.sync.superSync!.baseUrl!.replace(/\/+$/, ''),
    );
  });

  it('refuses other schemes and non-addresses', () => {
    expect(normalizeSuperSyncBaseUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSuperSyncBaseUrl('ftp://example.com')).toBeNull();
    expect(normalizeSuperSyncBaseUrl('sync.example.com')).toBeNull();
  });
});

describe('SuperSyncConnectService', () => {
  let service: SuperSyncConnectService;
  let syncConfig: jasmine.SpyObj<SyncConfigService>;
  let syncWrapper: jasmine.SpyObj<SyncWrapperService>;
  let providerManager: jasmine.SpyObj<SyncProviderManager>;

  const formValue = {
    ...DEFAULT_GLOBAL_CONFIG.sync,
    isEnabled: false,
    syncInterval: 123_000,
  } as SyncConfig;

  beforeEach(() => {
    syncConfig = jasmine.createSpyObj('SyncConfigService', ['updateSettingsFromForm'], {
      syncSettingsForm$: of(formValue),
    });
    syncConfig.updateSettingsFromForm.and.resolveTo();
    syncWrapper = jasmine.createSpyObj('SyncWrapperService', [
      'markPromptEncryptionAfterSetupSync',
      'sync',
    ]);
    syncWrapper.sync.and.resolveTo();
    providerManager = jasmine.createSpyObj('SyncProviderManager', ['getProviderById']);
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncConfigService, useValue: syncConfig },
        { provide: SyncWrapperService, useValue: syncWrapper },
        { provide: SyncProviderManager, useValue: providerManager },
      ],
    });
    service = TestBed.inject(SuperSyncConnectService);
  });

  describe('applyToken', () => {
    it('turns on SuperSync with the token and server, keeping other settings', async () => {
      await service.applyToken('jwt', 'https://sync.example.com');
      const [settings, isInitialSetup] =
        syncConfig.updateSettingsFromForm.calls.mostRecent().args;
      expect(isInitialSetup).toBe(true);
      expect(settings).toEqual(
        jasmine.objectContaining({
          isEnabled: true,
          syncProvider: SyncProviderId.SuperSync,
          syncInterval: 123_000,
        }),
      );
      expect(settings.superSync).toEqual(
        jasmine.objectContaining({
          accessToken: 'jwt',
          baseUrl: 'https://sync.example.com',
        }),
      );
    });

    it('asks for the encryption password after the first sync and starts it', async () => {
      spyOnProperty(navigator, 'onLine').and.returnValue(true);
      await service.applyToken('jwt', 'https://sync.example.com');
      expect(syncWrapper.markPromptEncryptionAfterSetupSync).toHaveBeenCalled();
      expect(syncWrapper.sync).toHaveBeenCalledWith(true);
      expect(syncConfig.updateSettingsFromForm).toHaveBeenCalledBefore(syncWrapper.sync);
    });

    it('still arms the password prompt offline, without starting a sync', async () => {
      spyOnProperty(navigator, 'onLine').and.returnValue(false);
      await service.applyToken('jwt', 'https://sync.example.com');
      expect(syncWrapper.markPromptEncryptionAfterSetupSync).toHaveBeenCalled();
      expect(syncWrapper.sync).not.toHaveBeenCalled();
    });
  });

  describe('savedBaseUrl', () => {
    const withSavedCfg = (cfg: unknown): void => {
      providerManager.getProviderById.and.resolveTo({
        privateCfg: { load: () => Promise.resolve(cfg) },
      } as never);
    };

    it('returns the server saved for SuperSync', async () => {
      withSavedCfg({ baseUrl: 'https://own.example.com/' });
      expect(await service.savedBaseUrl()).toBe('https://own.example.com');
    });

    it('falls back to the default server', async () => {
      withSavedCfg(null);
      expect(await service.savedBaseUrl()).toBe(normalizeSuperSyncBaseUrl('') as string);
      withSavedCfg({ baseUrl: 'not a url' });
      expect(await service.savedBaseUrl()).toBe(normalizeSuperSyncBaseUrl('') as string);
    });
  });
});

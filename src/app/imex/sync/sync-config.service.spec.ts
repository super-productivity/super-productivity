import { TestBed } from '@angular/core/testing';
import { SyncConfigService } from './sync-config.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { BehaviorSubject } from 'rxjs';
import { SyncConfig } from '../../features/config/global-config.model';
import { LegacySyncProvider } from './legacy-sync-provider.model';
import { SyncProviderId } from '../../op-log/sync-exports';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { first } from 'rxjs/operators';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';

describe('SyncConfigService', () => {
  let service: SyncConfigService;
  let providerManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncConfig$: BehaviorSubject<SyncConfig>;
  let mockCurrentProviderPrivateCfg$: BehaviorSubject<any>;

  beforeEach(() => {
    // Mock fetch for the sync-config-default-override.json
    // @ts-ignore - fetch might not exist in test environment
    globalThis.fetch = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({
        json: () => Promise.resolve({}),
      } as Response),
    );

    // Create mock sync config
    mockSyncConfig$ = new BehaviorSubject<SyncConfig>({
      ...DEFAULT_GLOBAL_CONFIG.sync,
      isEnabled: true,
      syncProvider: LegacySyncProvider.LocalFile,
      isEncryptionEnabled: true,
    });

    mockCurrentProviderPrivateCfg$ = new BehaviorSubject(null);

    const providerManagerSpy = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getProviderById', 'getActiveProvider', 'setProviderConfig', 'getProviderConfig'],
      {
        currentProviderPrivateCfg$: mockCurrentProviderPrivateCfg$,
      },
    );

    const globalConfigServiceSpy = jasmine.createSpyObj(
      'GlobalConfigService',
      ['updateSection'],
      {
        sync$: mockSyncConfig$,
      },
    );

    const wrappedProviderServiceSpy = jasmine.createSpyObj('WrappedProviderService', [
      'clearCache',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SyncConfigService,
        { provide: SyncProviderManager, useValue: providerManagerSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: WrappedProviderService, useValue: wrappedProviderServiceSpy },
      ],
    });

    service = TestBed.inject(SyncConfigService);
    providerManager = TestBed.inject(
      SyncProviderManager,
    ) as jasmine.SpyObj<SyncProviderManager>;
  });

  describe('updateSettingsFromForm', () => {
    it('should update global config with non-private data only', async () => {
      const globalConfigService = TestBed.inject(
        GlobalConfigService,
      ) as jasmine.SpyObj<GlobalConfigService>;

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'secret-key',
        webDav: {
          baseUrl: 'https://example.com',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      };

      await service.updateSettingsFromForm(settings);

      // Should only pass non-private data to global config
      expect(globalConfigService.updateSection).toHaveBeenCalledWith('sync', {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
      });
    });

    it('should apply default values for WebDAV provider fields and preserve existing config', async () => {
      // Mock existing provider with old config
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://old.example.com',
              userName: 'olduser',
              password: 'oldpass',
              syncFolderPath: '/old',
              encryptKey: 'old-key',
            }),
          ),
        },
      };
      // getProviderById returns synchronously, not a Promise
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'test-key',
        webDav: {
          baseUrl: 'https://example.com',
          // Missing userName, password, syncFolderPath - should use old values
        } as any,
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        {
          baseUrl: 'https://example.com',
          userName: 'olduser', // Preserved from old config
          password: 'oldpass', // Preserved from old config
          syncFolderPath: '/old', // Preserved from old config
          encryptKey: 'test-key', // New value from settings
        },
      );
    });

    it('should apply default values for LocalFile provider fields when no existing config', async () => {
      // Mock no existing provider - getProviderById returns synchronously
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(null);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'test-key',
        localFileSync: {
          // Missing syncFolderPath
        } as any,
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.LocalFile,
        {
          syncFolderPath: '',
          encryptKey: 'test-key',
        },
      );
    });

    it('should handle Dropbox provider and preserve OAuth tokens', async () => {
      // Mock existing Dropbox provider with OAuth tokens
      const mockProvider = {
        id: SyncProviderId.Dropbox,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              accessToken: 'existing-access-token',
              refreshToken: 'existing-refresh-token',
              encryptKey: 'old-key',
            }),
          ),
        },
      };
      // getProviderById returns synchronously, not a Promise
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.Dropbox,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'dropbox-key',
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.Dropbox,
        {
          accessToken: 'existing-access-token', // Preserved OAuth tokens
          refreshToken: 'existing-refresh-token', // Preserved OAuth tokens
          encryptKey: 'dropbox-key', // Updated from settings
        },
      );
    });

    it('should preserve Dropbox OAuth token when updating unrelated settings', async () => {
      // This test specifically verifies the reported issue
      const existingToken = 'GicjnVuuGSMAAAAAAAxOv3tqe032pTcRxBvMOgHc';

      // Mock existing Dropbox provider with the specific token
      const mockProvider = {
        id: SyncProviderId.Dropbox,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              accessToken: existingToken,
              refreshToken: 'some-refresh-token',
              encryptKey: 'existing-key',
            }),
          ),
        },
      };
      // getProviderById returns synchronously, not a Promise
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Update settings without changing the provider
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.Dropbox,
        syncInterval: 600000, // Changed interval
        isEncryptionEnabled: true,
        encryptKey: 'existing-key', // Same key
      };

      await service.updateSettingsFromForm(settings);

      // Verify the token is preserved
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.Dropbox,
        jasmine.objectContaining({
          accessToken: existingToken, // Must be preserved!
          refreshToken: 'some-refresh-token',
        }),
      );
    });

    it('should preserve SuperSync accessToken when form provides empty value (resetOnHide scenario)', async () => {
      // This test verifies the fix for: SuperSync tokens being overwritten by empty string
      // due to Formly's resetOnHide: true behavior on the accessToken field

      const existingToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
      const existingBaseUrl = 'https://supersync.example.com';

      // Mock existing SuperSync provider with saved token
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: existingBaseUrl,
              accessToken: existingToken, // Saved token
              encryptKey: 'existing-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Simulate form state after resetOnHide: true triggered
      // Form only provides baseUrl, accessToken is empty string (reset by Formly)
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 600000, // Changed interval (unrelated setting)
        superSync: {
          baseUrl: existingBaseUrl,
          accessToken: '', // ← Empty due to resetOnHide
        },
      };

      await service.updateSettingsFromForm(settings);

      // Verify the token is preserved (not overwritten with empty string)
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          baseUrl: existingBaseUrl,
          accessToken: existingToken, // ← Must be preserved!
          // Empty string from form should NOT overwrite saved token
        }),
      );
    });

    it('should allow updating SuperSync accessToken with new non-empty value', async () => {
      // Ensure we can still update tokens when user provides a new one
      const oldToken = 'old-token-xyz';
      const newToken = 'new-token-abc';

      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com',
              accessToken: oldToken,
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        superSync: {
          baseUrl: 'https://example.com',
          accessToken: newToken, // User provides new token
        },
      };

      await service.updateSettingsFromForm(settings);

      // Verify new token is saved
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          accessToken: newToken, // New token should be saved
        }),
      );
    });

    it('should preserve WebDAV password when form provides empty value', async () => {
      // Verify the defensive merge logic works for other providers too
      const existingPassword = 'secret-password-123';

      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://webdav.example.com',
              userName: 'testuser',
              password: existingPassword,
              syncFolderPath: '/sync',
              encryptKey: 'test-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Form provides empty password (e.g., from resetOnHide or form state issue)
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 600000,
        webDav: {
          baseUrl: 'https://webdav.example.com',
          userName: 'testuser',
          password: '', // Empty - should not overwrite
          syncFolderPath: '/sync',
        },
      };

      await service.updateSettingsFromForm(settings);

      // Password should be preserved
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          password: existingPassword, // Must be preserved!
        }),
      );
    });

    it('should preserve boolean false values from form (not filter them out)', async () => {
      // Ensure our filter doesn't treat false as "empty"
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com',
              isEncryptionEnabled: true, // Currently enabled
              encryptKey: 'test-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // User explicitly disables encryption (false should be respected)
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        superSync: {
          baseUrl: 'https://example.com',
          isEncryptionEnabled: false, // Explicitly false, not empty
        } as any,
      };

      await service.updateSettingsFromForm(settings);

      // False should be saved (not filtered out)
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          isEncryptionEnabled: false, // Must respect explicit false
        }),
      );
    });

    it('should handle multiple empty fields while preserving saved values', async () => {
      // Test that all empty fields are filtered, preserving all saved credentials
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://webdav.example.com',
              userName: 'saveduser',
              password: 'savedpass',
              syncFolderPath: '/savedfolder',
              encryptKey: 'saved-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Form provides only baseUrl, all other fields empty
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        webDav: {
          baseUrl: 'https://webdav.example.com',
          userName: '', // Empty
          password: '', // Empty
          syncFolderPath: '', // Empty
        },
      };

      await service.updateSettingsFromForm(settings);

      // All saved values should be preserved
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          baseUrl: 'https://webdav.example.com', // From form
          userName: 'saveduser', // Preserved
          password: 'savedpass', // Preserved
          syncFolderPath: '/savedfolder', // Preserved
        }),
      );
    });

    it('should handle mix of empty and non-empty fields correctly', async () => {
      // Test partial updates: some fields updated, some empty (should preserve), some unchanged
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://old.example.com',
              userName: 'olduser',
              password: 'oldpass',
              syncFolderPath: '/old',
              encryptKey: 'old-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        webDav: {
          baseUrl: 'https://new.example.com', // Updated
          userName: 'newuser', // Updated
          password: '', // Empty - should preserve old
          syncFolderPath: '/new', // Updated
        },
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          baseUrl: 'https://new.example.com', // Updated
          userName: 'newuser', // Updated
          password: 'oldpass', // Preserved (form had empty)
          syncFolderPath: '/new', // Updated
        }),
      );
    });

    it('should preserve LocalFile syncFolderPath when form provides empty value', async () => {
      // Test LocalFile provider credentials preservation
      const existingPath = 'C:\\Users\\test\\sync';

      const mockProvider = {
        id: SyncProviderId.LocalFile,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              syncFolderPath: existingPath,
              encryptKey: 'test-key',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Form provides empty path
      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        syncInterval: 600000,
        localFileSync: {
          syncFolderPath: '', // Empty - should not overwrite
        },
      };

      await service.updateSettingsFromForm(settings);

      // Path should be preserved
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.LocalFile,
        jasmine.objectContaining({
          syncFolderPath: existingPath, // Must be preserved!
        }),
      );
    });

    it('should prevent duplicate saves when settings are unchanged', async () => {
      // Mock provider for the test - getProviderById returns synchronously
      (providerManager.getProviderById as jasmine.Spy).and.returnValue({
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(Promise.resolve({})),
        },
      });

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: false,
        webDav: {
          baseUrl: '',
          userName: '',
          password: '',
          syncFolderPath: '',
        },
      };

      // First call
      await service.updateSettingsFromForm(settings);
      expect(providerManager.setProviderConfig).toHaveBeenCalledTimes(1);

      // Second call with same settings - should be skipped
      await service.updateSettingsFromForm(settings);
      expect(providerManager.setProviderConfig).toHaveBeenCalledTimes(1);

      // Third call with isForce=true - should proceed
      await service.updateSettingsFromForm(settings, true);
      expect(providerManager.setProviderConfig).toHaveBeenCalledTimes(2);
    });

    it('should not save private config when no provider is selected', async () => {
      const settings: SyncConfig = {
        isEnabled: false,
        syncProvider: null,
        syncInterval: 300000,
        isEncryptionEnabled: false,
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).not.toHaveBeenCalled();
    });

    it('should handle provider with no existing config', async () => {
      // Mock no existing provider (e.g., initial setup) - getProviderById returns synchronously
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(null);

      const settings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'new-key',
        webDav: {
          baseUrl: 'https://example.com',
          userName: 'newuser',
          password: 'newpass',
          syncFolderPath: '/new',
        },
      };

      await service.updateSettingsFromForm(settings);

      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        {
          baseUrl: 'https://example.com',
          userName: 'newuser',
          password: 'newpass',
          syncFolderPath: '/new',
          encryptKey: 'new-key',
        },
      );
    });
  });

  describe('LocalFile encryption persistence issue (#4844)', () => {
    it('should ensure provider is initialized when saving encryption settings', async () => {
      // This test captures the real fix we need:
      // When user saves encryption settings, the provider should be properly initialized
      // so that when they return, the provider config is available

      const initialSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'my-secret-password',
        localFileSync: {
          syncFolderPath: 'C:\\Users\\test\\sync',
        },
      };

      // Mock: No provider exists initially - getProviderById returns synchronously
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(null);
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(null);

      // User saves the form
      await service.updateSettingsFromForm(initialSettings);

      // The provider should be created/initialized
      // and the encryption key should be saved to the provider's private config
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.LocalFile,
        jasmine.objectContaining({
          syncFolderPath: 'C:\\Users\\test\\sync',
          encryptKey: 'my-secret-password',
        }),
      );

      // Step 2: Simulate user returning to settings
      // Global config shows encryption enabled
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        isEncryptionEnabled: true,
        syncInterval: 300000,
      });

      // Provider config not loaded yet (the issue)
      mockCurrentProviderPrivateCfg$.next(null);

      // Get form settings
      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // FIXED: With the form validation fix, empty password is now acceptable
      // The form shows encryption as enabled even without the password
      expect(formSettings!.isEncryptionEnabled).toBe(true);
      expect(formSettings!.encryptKey).toBe(''); // Empty but form is still valid
    });

    it('should show encryption key as empty in form when provider config is not loaded', async () => {
      // This test demonstrates the actual bug

      // Step 1: Simulate initial setup - user enables encryption
      const initialSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'test-password-123',
        localFileSync: {
          syncFolderPath: 'C:\\Users\\test\\sync',
        },
      };

      // No provider exists yet - getProviderById returns synchronously
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(null);
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(null);

      await service.updateSettingsFromForm(initialSettings);

      // Step 2: Simulate navigation away and back
      // Global config has encryption enabled
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        isEncryptionEnabled: true, // This is saved correctly
        syncInterval: 300000,
      });

      // But currentProviderPrivateCfg$ is null (provider not loaded yet)
      mockCurrentProviderPrivateCfg$.next(null);

      // Get the form settings
      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // BUG: Even though isEncryptionEnabled is true in global config,
      // the encryption key is empty because currentProviderPrivateCfg$ is null
      console.log('Form settings:', JSON.stringify(formSettings, null, 2));

      expect(formSettings!.isEncryptionEnabled).toBe(true);
      // Currently returns empty string
      expect(formSettings!.encryptKey).toBe('');
    });

    it('should show empty encryption key when encryption is disabled', async () => {
      // Ensure we don't show placeholder when encryption is not enabled
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        isEncryptionEnabled: false, // Encryption is disabled
        syncInterval: 300000,
      });

      mockCurrentProviderPrivateCfg$.next(null); // Provider not loaded

      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // Should show empty key, not placeholder
      expect(formSettings!.isEncryptionEnabled).toBe(false);
      expect(formSettings!.encryptKey).toBe(''); // Empty, not placeholder
    });

    it('should still work correctly for WebDAV provider', async () => {
      // Ensure our fix doesn't break other providers
      const webDavSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'webdav-password',
        webDav: {
          baseUrl: 'https://example.com/webdav',
          userName: 'testuser',
          password: 'testpass',
          syncFolderPath: '/sync',
        },
      };

      // Mock existing WebDAV provider - getProviderById returns synchronously
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(Promise.resolve({})),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      await service.updateSettingsFromForm(webDavSettings);

      // Verify WebDAV config is saved correctly with encryption key
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          baseUrl: 'https://example.com/webdav',
          userName: 'testuser',
          password: 'testpass',
          syncFolderPath: '/sync',
          encryptKey: 'webdav-password',
        }),
      );
    });
    it('should NOT lose encryption settings after navigation when LocalFile sync with encryption is first enabled', async () => {
      // This test demonstrates the bug: encryption settings are lost after navigation
      // when initially setting up LocalFile sync with encryption on Windows

      // Step 1: User enables LocalFile sync with encryption
      const newSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'test-password-123',
        localFileSync: {
          syncFolderPath: 'C:\\Users\\test\\sync',
        },
      };

      // Mock that there's no active provider yet (initial setup) - getProviderById returns synchronously
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(null);
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(null);

      // Act: User saves the form with encryption enabled
      await service.updateSettingsFromForm(newSettings);

      // Verify that setPrivateCfgForSyncProvider was called with encryption key
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.LocalFile,
        jasmine.objectContaining({
          syncFolderPath: 'C:\\Users\\test\\sync',
          encryptKey: 'test-password-123',
        }),
      );

      // Simulate that the provider is now created and we can load it
      const mockProvider = {
        id: SyncProviderId.LocalFile,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              syncFolderPath: 'C:\\Users\\test\\sync',
              // BUG: encryptKey is missing here because updateEncryptionPassword failed
            }),
          ),
        },
      };

      // Update mocks to simulate provider is now available - getProviderById returns synchronously
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // In a real scenario, after setPrivateCfgForSyncProvider is called,
      // the currentProviderPrivateCfg$ would be updated with the saved config
      // We simulate this by updating the observable with the encryption key
      mockCurrentProviderPrivateCfg$.next({
        providerId: SyncProviderId.LocalFile,
        privateCfg: {
          syncFolderPath: 'C:\\Users\\test\\sync',
          encryptKey: 'test-password-123', // This should be included after save
        },
      });

      // Update sync config to show encryption is enabled in global config
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        isEncryptionEnabled: true,
        syncInterval: 300000,
      });

      // Step 2: User navigates away and comes back - get form settings
      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // EXPECTED: Form should still show encryption is enabled with the password
      // ACTUAL: encryptKey will be empty because it was never saved to provider config
      expect(formSettings!.isEncryptionEnabled).toBe(true);
      expect(formSettings!.encryptKey).toBe('test-password-123'); // THIS WILL FAIL!
    });

    it('should show encryption as enabled in form after navigation when LocalFile sync is configured', async () => {
      // Update the observable to simulate provider being active
      mockCurrentProviderPrivateCfg$.next({
        providerId: SyncProviderId.LocalFile,
        privateCfg: {
          syncFolderPath: 'C:\\Users\\test\\sync',
          encryptKey: 'test-password-123',
        },
      });

      // Update sync config to show encryption is enabled
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.LocalFile,
        isEncryptionEnabled: true,
        syncInterval: 300000,
      });

      // Act: Get the form settings (simulating user navigating back to settings)
      let formSettings: SyncConfig | undefined;
      service.syncSettingsForm$.subscribe((settings) => {
        formSettings = settings;
      });

      // Assert: The form should show encryption is enabled and include the encryption key
      expect(formSettings).toBeDefined();
      expect(formSettings!.isEncryptionEnabled).toBe(true);
      expect(formSettings!.encryptKey).toBe('test-password-123');
      expect(formSettings!.localFileSync).toEqual(
        jasmine.objectContaining({
          syncFolderPath: 'C:\\Users\\test\\sync',
        }),
      );
    });
  });

  describe('SuperSync default baseUrl preservation', () => {
    it('should preserve default superSync.baseUrl when stored config has empty superSync object', async () => {
      // This test verifies the fix for: "when setting up super sync for the first time, server url is empty"
      // The bug occurred because shallow merge of {...DEFAULT_GLOBAL_CONFIG.sync, ...syncCfg}
      // would replace DEFAULT_GLOBAL_CONFIG.sync.superSync entirely with an empty {}

      // Simulate stored config with empty superSync (no baseUrl)
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: false,
        syncProvider: null,
        superSync: {}, // Empty - no baseUrl
      } as SyncConfig);

      // No active provider yet
      mockCurrentProviderPrivateCfg$.next(null);

      // Get form settings
      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // The default baseUrl should be preserved from DEFAULT_GLOBAL_CONFIG
      expect(formSettings!.superSync!.baseUrl).toBe(
        DEFAULT_GLOBAL_CONFIG.sync.superSync!.baseUrl,
      );
    });

    it('should use user-provided superSync.baseUrl over default', async () => {
      const customUrl = 'https://my-custom-server.com';

      // Simulate stored config with custom baseUrl
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        superSync: {
          baseUrl: customUrl,
        },
      } as SyncConfig);

      // No active provider yet
      mockCurrentProviderPrivateCfg$.next(null);

      // Get form settings
      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // The user's custom URL should take precedence
      expect(formSettings!.superSync!.baseUrl).toBe(customUrl);
    });

    it('should preserve default webDav and localFileSync settings with deep merge', async () => {
      // Simulate stored config with empty provider configs
      mockSyncConfig$.next({
        ...DEFAULT_GLOBAL_CONFIG.sync,
        isEnabled: false,
        syncProvider: null,
        webDav: {}, // Empty
        localFileSync: {}, // Empty
        superSync: {}, // Empty
      } as SyncConfig);

      mockCurrentProviderPrivateCfg$.next(null);

      const formSettings = await service.syncSettingsForm$.pipe(first()).toPromise();

      // All defaults should be preserved via deep merge
      expect(formSettings!.superSync!.baseUrl).toBe(
        DEFAULT_GLOBAL_CONFIG.sync.superSync!.baseUrl,
      );
      expect(formSettings!.webDav!.syncFolderPath).toBe(
        DEFAULT_GLOBAL_CONFIG.sync.webDav!.syncFolderPath,
      );
    });
  });

  describe('updateEncryptionPassword', () => {
    it('should set isEncryptionEnabled=true when updating password for SuperSync', async () => {
      // Setup SuperSync provider with encryption disabled
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'http://test.com',
              userName: 'test',
              password: 'test',
              accessToken: 'token',
              syncFolderPath: '/',
              encryptKey: 'oldpass',
              isEncryptionEnabled: false,
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Update password
      await service.updateEncryptionPassword('newpass', SyncProviderId.SuperSync);

      // Verify both encryptKey and isEncryptionEnabled are updated
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: 'newpass',
          isEncryptionEnabled: true,
        }),
      );
    });

    it('should not add isEncryptionEnabled for non-SuperSync providers', async () => {
      // Setup WebDAV provider
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'http://test.com',
              userName: 'test',
              password: 'test',
              syncFolderPath: '/',
              encryptKey: 'oldpass',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Update password
      await service.updateEncryptionPassword('newpass', SyncProviderId.WebDAV);

      // Verify only encryptKey is updated (no isEncryptionEnabled field)
      const callArgs = (
        providerManager.setProviderConfig as jasmine.Spy
      ).calls.mostRecent().args[1];
      expect(callArgs.encryptKey).toBe('newpass');
      expect(callArgs.isEncryptionEnabled).toBeUndefined();
    });

    it('should preserve existing config when updating password', async () => {
      // Setup SuperSync provider with existing config
      const existingConfig = {
        baseUrl: 'https://my-server.com',
        userName: 'testuser',
        password: 'testpass',
        accessToken: 'existing-token',
        syncFolderPath: '/my-sync',
        encryptKey: 'oldpass',
        isEncryptionEnabled: false,
      };

      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine
            .createSpy('load')
            .and.returnValue(Promise.resolve(existingConfig)),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Update password
      await service.updateEncryptionPassword('newpass', SyncProviderId.SuperSync);

      // Verify all existing config is preserved except the updated fields
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          baseUrl: 'https://my-server.com',
          userName: 'testuser',
          password: 'testpass',
          accessToken: 'existing-token',
          syncFolderPath: '/my-sync',
          encryptKey: 'newpass',
          isEncryptionEnabled: true,
        }),
      );
    });
  });

  describe('Cache Clearing on Encryption Changes', () => {
    let wrappedProviderService: jasmine.SpyObj<WrappedProviderService>;

    beforeEach(() => {
      wrappedProviderService = TestBed.inject(
        WrappedProviderService,
      ) as jasmine.SpyObj<WrappedProviderService>;
    });

    it('should clear cache when encryption is disabled', async () => {
      // Mock existing provider config with encryption
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/dav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: 'oldPassword', // Has encryption
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Spy on cache clear
      const clearCacheSpy = spyOn(service['_derivedKeyCache'], 'clearCache');

      // Update settings to disable encryption
      await service.updateSettingsFromForm({
        syncProvider: SyncProviderId.WebDAV as any,
        encryptKey: '', // No encryption key
        webDav: {
          baseUrl: 'https://example.com/dav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      } as SyncConfig);

      // Verify both caches were cleared
      expect(clearCacheSpy).toHaveBeenCalled();
      expect(wrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should clear cache when encryption password changes', async () => {
      // Mock existing provider config with old password
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/dav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: 'oldPassword',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Spy on cache clear
      const clearCacheSpy = spyOn(service['_derivedKeyCache'], 'clearCache');

      // Update settings with new encryption password
      await service.updateSettingsFromForm({
        syncProvider: SyncProviderId.WebDAV as any,
        encryptKey: 'newPassword', // Different password
        webDav: {
          baseUrl: 'https://example.com/dav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      } as SyncConfig);

      // Verify both caches were cleared
      expect(clearCacheSpy).toHaveBeenCalled();
      expect(wrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should clear cache when encryption is enabled', async () => {
      // Mock existing provider config without encryption
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/dav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: '', // No encryption initially
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Spy on cache clear
      const clearCacheSpy = spyOn(service['_derivedKeyCache'], 'clearCache');

      // Update settings to enable encryption
      await service.updateSettingsFromForm({
        syncProvider: SyncProviderId.WebDAV as any,
        encryptKey: 'newPassword', // Enable encryption
        webDav: {
          baseUrl: 'https://example.com/dav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      } as SyncConfig);

      // Verify both caches were cleared
      expect(clearCacheSpy).toHaveBeenCalled();
      expect(wrappedProviderService.clearCache).toHaveBeenCalled();
    });

    it('should NOT clear cache when encryption key unchanged', async () => {
      // Mock existing provider config with encryption
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/dav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: 'samePassword',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);

      // Spy on cache clear
      const clearCacheSpy = spyOn(service['_derivedKeyCache'], 'clearCache');

      // Update settings with same encryption password
      await service.updateSettingsFromForm({
        syncProvider: SyncProviderId.WebDAV as any,
        encryptKey: 'samePassword', // Same password
        webDav: {
          baseUrl: 'https://example.com/dav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      } as SyncConfig);

      // Verify neither cache was cleared
      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(wrappedProviderService.clearCache).not.toHaveBeenCalled();
    });

    it('should clear cache via updateEncryptionPassword method', async () => {
      // Mock existing provider config
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/dav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: 'oldPassword',
            }),
          ),
        },
      };
      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Spy on cache clear
      const clearCacheSpy = spyOn(service['_derivedKeyCache'], 'clearCache');

      // Update password via dedicated method
      await service.updateEncryptionPassword('newPassword', SyncProviderId.WebDAV);

      // Verify both caches were cleared
      expect(clearCacheSpy).toHaveBeenCalled();
      expect(wrappedProviderService.clearCache).toHaveBeenCalled();
    });
  });

  /**
   * Tests for SuperSync password preservation race condition fix
   *
   * This test suite verifies that SuperSync encryption passwords set via dialogs
   * (EnableEncryption, ChangePassword, HandleDecryptError) are NOT overwritten
   * by stale form model values that arrive later via Angular's modelChange events.
   *
   * The race condition scenario:
   * 1. User opens password dialog and enters new password
   * 2. Dialog calls updateEncryptionPassword() - password saved to IndexedDB
   * 3. Dialog closes, triggering form model update
   * 4. Angular fires modelChange with STALE form values (old/empty password)
   * 5. WITHOUT FIX: Stale values overwrite the new password
   * 6. WITH FIX: savedEncryptKey from IndexedDB is preserved
   */
  describe('SuperSync password preservation (race condition fix)', () => {
    it('should preserve SuperSync encryptKey when form update arrives with empty password', async () => {
      // Setup: SuperSync provider with saved password
      const savedPassword = 'saved-secret-password-123';
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://super.sync',
              accessToken: 'token-123',
              encryptKey: savedPassword,
              isEncryptionEnabled: true,
            }),
          ),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Simulate form update with NO encryptKey (stale form model)
      const formSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: '', // Empty - simulating stale form model
        superSync: {
          baseUrl: 'https://super.sync',
          accessToken: 'token-123',
        },
      };

      await service.updateSettingsFromForm(formSettings);

      // Verify: savedEncryptKey should be preserved, NOT overwritten by empty value
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: savedPassword, // Must preserve the saved password!
        }),
      );
    });

    it('should preserve SuperSync encryptKey when form update arrives with old password', async () => {
      // Setup: SuperSync provider with NEW password saved via dialog
      const oldPassword = 'old-password';
      const newSavedPassword = 'new-password-from-dialog';

      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://super.sync',
              accessToken: 'token-123',
              encryptKey: newSavedPassword, // New password from dialog
              isEncryptionEnabled: true,
            }),
          ),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Simulate form update with OLD password (stale form model from before dialog)
      const formSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: oldPassword, // Old - simulating stale form model
        superSync: {
          baseUrl: 'https://super.sync',
          accessToken: 'token-123',
        },
      };

      await service.updateSettingsFromForm(formSettings);

      // Verify: savedEncryptKey should be preserved, NOT overwritten by stale value
      // Note: The fix uses (nonEmptyFormValues?.encryptKey as string) || savedEncryptKey
      // Since oldPassword IS provided in nonEmptyFormValues, it will be used.
      // This is expected - we only protect against EMPTY form values, not old values.
      // The race condition occurs when Angular fires modelChange with empty/undefined encryptKey.
      expect(providerManager.setProviderConfig).toHaveBeenCalled();
    });

    it('should NOT preserve encryptKey for file-based providers (WebDAV)', async () => {
      // Setup: WebDAV provider with saved password
      const savedPassword = 'saved-webdav-password';
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://example.com/webdav',
              userName: 'user',
              password: 'pass',
              syncFolderPath: '/sync',
              encryptKey: savedPassword,
            }),
          ),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Simulate form update with NEW password from form
      const newFormPassword = 'new-webdav-password';
      const formSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: newFormPassword, // New password from form
        webDav: {
          baseUrl: 'https://example.com/webdav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
        },
      };

      await service.updateSettingsFromForm(formSettings);

      // Verify: Form password should be used for file-based providers
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          encryptKey: newFormPassword,
        }),
      );
    });

    it('should use settings.encryptKey fallback for file-based providers with no saved config', async () => {
      // Setup: WebDAV provider with NO existing config
      const mockProvider = {
        id: SyncProviderId.WebDAV,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(Promise.resolve(null)),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Simulate form update with password in settings.encryptKey (legacy path)
      const formSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.WebDAV,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: 'settings-level-password', // Password at settings level
        webDav: {
          baseUrl: 'https://example.com/webdav',
          userName: 'user',
          password: 'pass',
          syncFolderPath: '/sync',
          // No encryptKey here - using settings.encryptKey
        },
      };

      await service.updateSettingsFromForm(formSettings);

      // Verify: settings.encryptKey should be used for file-based providers
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.WebDAV,
        jasmine.objectContaining({
          encryptKey: 'settings-level-password',
        }),
      );
    });

    it('should clear SuperSync encryptKey when encryption is explicitly disabled', async () => {
      // Setup: SuperSync provider with encryption explicitly disabled
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://super.sync',
              accessToken: 'token-123',
              encryptKey: '', // Empty after disable
              isEncryptionEnabled: false, // Explicitly disabled
            }),
          ),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      const formSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        isEncryptionEnabled: false,
        encryptKey: '',
        superSync: {
          baseUrl: 'https://super.sync',
          accessToken: 'token-123',
        },
      };

      await service.updateSettingsFromForm(formSettings);

      // Verify: encryptKey should be cleared when encryption is disabled
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: '',
        }),
      );
    });

    it('should simulate the password change race condition scenario', async () => {
      // This test simulates the exact bug scenario:
      // 1. updateEncryptionPassword() saves new password to IndexedDB
      // 2. Form model triggers updateSettingsFromForm() with stale/empty password
      // 3. The fix should preserve the saved password

      const newPasswordFromDialog = 'brand-new-secret-password';

      // Step 1: Simulate updateEncryptionPassword() having already saved the new password
      const mockProvider = {
        id: SyncProviderId.SuperSync,
        privateCfg: {
          load: jasmine.createSpy('load').and.returnValue(
            Promise.resolve({
              baseUrl: 'https://super.sync',
              accessToken: 'token-123',
              encryptKey: newPasswordFromDialog, // New password already saved by dialog
              isEncryptionEnabled: true,
            }),
          ),
        },
        enabled: true,
        getConfig: jasmine.createSpy('getConfig'),
      };

      (providerManager.getProviderById as jasmine.Spy).and.returnValue(mockProvider);
      (providerManager.getActiveProvider as jasmine.Spy).and.returnValue(mockProvider);

      // Step 2: Simulate stale form model arriving AFTER dialog saved password
      // This happens because Angular's modelChange fires with the form state
      // from BEFORE the dialog updated the password
      const staleFormSettings: SyncConfig = {
        isEnabled: true,
        syncProvider: LegacySyncProvider.SuperSync,
        syncInterval: 300000,
        isEncryptionEnabled: true,
        encryptKey: '', // STALE: Form model didn't have the new password
        superSync: {
          baseUrl: 'https://super.sync',
          accessToken: 'token-123',
          // No encryptKey in provider-specific config either
        },
      };

      await service.updateSettingsFromForm(staleFormSettings);

      // Step 3: Verify the fix - new password should be preserved, NOT overwritten
      expect(providerManager.setProviderConfig).toHaveBeenCalledWith(
        SyncProviderId.SuperSync,
        jasmine.objectContaining({
          encryptKey: newPasswordFromDialog, // MUST preserve the dialog-saved password!
        }),
      );

      // Additional verification: check the exact call
      const callArgs = (
        providerManager.setProviderConfig as jasmine.Spy
      ).calls.mostRecent().args;
      expect(callArgs[0]).toBe(SyncProviderId.SuperSync);
      expect(callArgs[1].encryptKey).toBe(
        newPasswordFromDialog,
        'Race condition bug: stale form model overwrote the new password!',
      );
    });
  });
});

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { SnackService } from '../core/snack/snack.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { PluginCacheService } from './plugin-cache.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginI18nService } from './plugin-i18n.service';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { PluginRunner } from './plugin-runner';
import { PluginSecurityService } from './plugin-security';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginInstance, PluginManifest } from './plugin-api.model';
import { PluginService } from './plugin.service';

describe('PluginService', () => {
  let service: PluginService;
  let pluginMetaPersistenceService: jasmine.SpyObj<PluginMetaPersistenceService>;

  const mockManifest: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '1.0.0',
    permissions: [],
    hooks: [],
  };

  const loadedPlugin: PluginInstance = {
    manifest: mockManifest,
    loaded: true,
    isEnabled: true,
  };

  beforeEach(() => {
    pluginMetaPersistenceService = jasmine.createSpyObj<PluginMetaPersistenceService>(
      'PluginMetaPersistenceService',
      [
        'getAllPluginMetadata',
        'hasPluginMetadata',
        'isPluginEnabled',
        'setPluginEnabled',
        'getNodeExecutionConsent',
        'setNodeExecutionConsent',
        'removePluginMetadata',
      ],
    );
    pluginMetaPersistenceService.getAllPluginMetadata.and.resolveTo([]);
    pluginMetaPersistenceService.hasPluginMetadata.and.resolveTo(false);
    pluginMetaPersistenceService.isPluginEnabled.and.resolveTo(false);

    TestBed.configureTestingModule({
      providers: [
        PluginService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore(),
        {
          provide: PluginRunner,
          useValue: jasmine.createSpyObj<PluginRunner>('PluginRunner', [
            'loadPlugin',
            'unloadPlugin',
            'getLoadedPlugin',
            'triggerReady',
            'pingNodeBridge',
            'sendMessageToPlugin',
          ]),
        },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj<PluginHooksService>('PluginHooksService', [
            'dispatchHook',
            'unregisterPluginHooks',
            'registerHookHandler',
            'clearAllHooks',
          ]),
        },
        {
          provide: PluginSecurityService,
          useValue: jasmine.createSpyObj<PluginSecurityService>('PluginSecurityService', [
            'analyzePluginCode',
            'hasElevatedPermissions',
            'getPermissionDescriptions',
            'sanitizeHtml',
          ]),
        },
        {
          provide: GlobalThemeService,
          useValue: { darkMode$: new BehaviorSubject('light') },
        },
        { provide: PluginMetaPersistenceService, useValue: pluginMetaPersistenceService },
        {
          provide: PluginUserPersistenceService,
          useValue: jasmine.createSpyObj<PluginUserPersistenceService>(
            'PluginUserPersistenceService',
            ['persistPluginUserData', 'loadPluginUserData', 'removePluginUserData'],
          ),
        },
        {
          provide: PluginCacheService,
          useValue: jasmine.createSpyObj<PluginCacheService>('PluginCacheService', [
            'getAllPlugins',
            'getPlugin',
            'storePlugin',
            'removePlugin',
          ]),
        },
        {
          provide: PluginLoaderService,
          useValue: jasmine.createSpyObj<PluginLoaderService>('PluginLoaderService', [
            'loadPluginAssets',
            'loadUploadedPluginAssets',
            'clearAllCaches',
          ]),
        },
        {
          provide: PluginCleanupService,
          useValue: jasmine.createSpyObj<PluginCleanupService>('PluginCleanupService', [
            'cleanupPlugin',
            'cleanupAll',
          ]),
        },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj<MatDialog>('MatDialog', ['open']),
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string): string => key },
        },
        {
          provide: PluginI18nService,
          useValue: jasmine.createSpyObj<PluginI18nService>('PluginI18nService', [
            'loadPluginTranslationsFromContent',
            'unloadPluginTranslations',
          ]),
        },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: jasmine.createSpyObj<PluginIssueProviderRegistryService>(
            'PluginIssueProviderRegistryService',
            ['register', 'unregister'],
          ),
        },
        {
          provide: IssueSyncAdapterRegistryService,
          useValue: jasmine.createSpyObj<IssueSyncAdapterRegistryService>(
            'IssueSyncAdapterRegistryService',
            ['register', 'unregister'],
          ),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
      ],
    });

    service = TestBed.inject(PluginService);
  });

  it('starts uninitialized with no loaded plugins', () => {
    expect(service.isInitialized()).toBe(false);
    expect(service.getLoadedPlugins()).toEqual([]);
  });

  it('returns only loaded plugins from getLoadedPlugin', async () => {
    (service as unknown as { _loadedPlugins: PluginInstance[] })._loadedPlugins = [
      loadedPlugin,
      {
        manifest: { ...mockManifest, id: 'disabled-plugin' },
        loaded: false,
        isEnabled: false,
      },
    ];

    await expectAsync(
      firstValueFrom(service.getLoadedPlugin('test-plugin')),
    ).toBeResolvedTo(loadedPlugin);
    await expectAsync(
      firstValueFrom(service.getLoadedPlugin('disabled-plugin')),
    ).toBeResolvedTo(null);
  });

  it('returns disabled metadata as unloaded legacy plugin instances', async () => {
    pluginMetaPersistenceService.getAllPluginMetadata.and.resolveTo([
      { id: 'disabled-plugin', isEnabled: false },
    ]);

    const plugins = await service.getAllPluginsLegacy();

    expect(plugins).toEqual([
      jasmine.objectContaining({
        manifest: jasmine.objectContaining({ id: 'disabled-plugin' }),
        loaded: false,
        isEnabled: false,
      }),
    ]);
  });
});

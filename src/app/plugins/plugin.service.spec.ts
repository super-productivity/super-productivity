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
import { PluginState } from './plugin-state.model';
import { T } from '../t.const';

describe('PluginService', () => {
  let service: PluginService;
  let pluginMetaPersistenceService: jasmine.SpyObj<PluginMetaPersistenceService>;
  let pluginLoader: jasmine.SpyObj<PluginLoaderService>;
  let snackService: jasmine.SpyObj<SnackService>;

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
    pluginLoader = jasmine.createSpyObj<PluginLoaderService>('PluginLoaderService', [
      'loadPluginAssets',
      'loadUploadedPluginAssets',
      'clearAllCaches',
    ]);
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
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
        { provide: PluginLoaderService, useValue: pluginLoader },
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
        { provide: SnackService, useValue: snackService },
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

  it('rejects nodeExecution activation before loading plugin assets', async () => {
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };
    const state: PluginState = {
      manifest,
      status: 'not-loaded',
      path: 'assets/bundled-plugins/node-plugin',
      type: 'built-in',
      isEnabled: true,
    };

    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(manifest.id, state);

    const result = await service.activatePlugin(manifest.id);

    expect(result).toBeNull();
    expect(pluginLoader.loadPluginAssets).not.toHaveBeenCalled();
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'error',
        error: T.PLUGINS.NODE_EXECUTION_DISABLED_FOR_SECURITY,
      }),
    );
  });

  it('does not persist nodeExecution plugins as enabled via enableAndActivatePlugin', async () => {
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };
    const state: PluginState = {
      manifest,
      status: 'not-loaded',
      path: 'assets/bundled-plugins/node-plugin',
      type: 'built-in',
      isEnabled: false,
    };
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(manifest.id, state);

    const result = await service.enableAndActivatePlugin(manifest.id);

    expect(result).toBeNull();
    expect(pluginMetaPersistenceService.setPluginEnabled).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.PLUGINS.NODE_EXECUTION_DISABLED_FOR_SECURITY,
      type: 'ERROR',
    });
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'error',
        isEnabled: false,
        error: T.PLUGINS.NODE_EXECUTION_DISABLED_FOR_SECURITY,
      }),
    );
  });

  it('does not expose disabled nodeExecution issue providers in setup lists', () => {
    const normalIssueProvider: PluginManifest = {
      ...mockManifest,
      id: 'normal-issue-provider',
      name: 'Normal Issue Provider',
      type: 'issueProvider',
      issueProvider: {
        pollIntervalMs: 60000,
        issueProviderKey: 'plugin:normal-issue-provider',
        icon: 'extension',
      },
    };
    const nodeIssueProvider: PluginManifest = {
      ...normalIssueProvider,
      id: 'node-issue-provider',
      name: 'Node Issue Provider',
      permissions: ['nodeExecution'],
      issueProvider: {
        pollIntervalMs: 60000,
        issueProviderKey: 'plugin:node-issue-provider',
        icon: 'extension',
      },
    };
    const setState = (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState.bind(service);

    setState(normalIssueProvider.id, {
      manifest: normalIssueProvider,
      status: 'not-loaded',
      path: 'assets/bundled-plugins/normal-issue-provider',
      type: 'built-in',
      isEnabled: false,
    });
    setState(nodeIssueProvider.id, {
      manifest: nodeIssueProvider,
      status: 'error',
      path: 'assets/bundled-plugins/node-issue-provider',
      type: 'built-in',
      isEnabled: false,
      error: T.PLUGINS.NODE_EXECUTION_DISABLED_FOR_SECURITY,
    });

    const disabledIssueProviders = service.getDisabledIssueProviderPlugins();

    expect(disabledIssueProviders.map((p) => p.pluginId)).toEqual([
      normalIssueProvider.id,
    ]);
  });
});

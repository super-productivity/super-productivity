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
import { PluginBridgeService } from './plugin-bridge.service';
import { T } from '../t.const';

describe('PluginService', () => {
  let service: PluginService;
  let pluginMetaPersistenceService: jasmine.SpyObj<PluginMetaPersistenceService>;
  let pluginLoader: jasmine.SpyObj<PluginLoaderService>;
  let pluginBridge: jasmine.SpyObj<PluginBridgeService>;
  let pluginRunner: jasmine.SpyObj<PluginRunner>;

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
        'removePluginMetadata',
      ],
    );
    pluginMetaPersistenceService.getAllPluginMetadata.and.resolveTo([]);
    pluginMetaPersistenceService.hasPluginMetadata.and.resolveTo(false);
    pluginMetaPersistenceService.isPluginEnabled.and.resolveTo(false);
    pluginLoader = jasmine.createSpyObj<PluginLoaderService>('PluginLoaderService', [
      'loadPluginAssets',
      'loadUploadedPluginAssets',
      'clearAllCaches',
    ]);
    pluginBridge = jasmine.createSpyObj<PluginBridgeService>('PluginBridgeService', [
      'hasNodeExecutionGrantToken',
      'requestNodeExecutionGrant',
      'setNodeExecutionGrantToken',
      'revokeNodeExecutionGrantToken',
      'revokeNodeExecutionGrant',
    ]);
    pluginBridge.hasNodeExecutionGrantToken.and.returnValue(false);
    pluginBridge.requestNodeExecutionGrant.and.resolveTo(null);
    pluginRunner = jasmine.createSpyObj<PluginRunner>('PluginRunner', [
      'loadPlugin',
      'unloadPlugin',
      'getLoadedPlugin',
      'triggerReady',
      'pingNodeBridge',
      'sendMessageToPlugin',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore(),
        {
          provide: PluginRunner,
          useValue: pluginRunner,
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
          useValue: {
            darkMode$: new BehaviorSubject('light'),
            darkMode: () => 'light',
          },
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
          useValue: pluginLoader,
        },
        {
          provide: PluginBridgeService,
          useValue: pluginBridge,
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
            ['register', 'unregister', 'getRegisteredKey'],
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

  it('does not persist nodeExecution plugins as enabled when permission is denied', async () => {
    const runtime = service as unknown as { _isElectronRuntime: () => boolean };
    spyOn(runtime, '_isElectronRuntime').and.returnValue(true);
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
    expect(pluginBridge.requestNodeExecutionGrant).toHaveBeenCalledOnceWith(manifest.id);
    expect(pluginMetaPersistenceService.setPluginEnabled).not.toHaveBeenCalled();
    expect(pluginLoader.loadPluginAssets).not.toHaveBeenCalled();
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'not-loaded',
        isEnabled: false,
      }),
    );
  });

  it('stores main-issued nodeExecution grants for Electron plugins', async () => {
    pluginBridge.requestNodeExecutionGrant.and.resolveTo({ token: 'token-1' });
    const runtime = service as unknown as { _isElectronRuntime: () => boolean };
    spyOn(runtime, '_isElectronRuntime').and.returnValue(true);
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };

    await expectAsync(service.checkNodeExecutionPermission(manifest)).toBeResolvedTo(
      true,
    );

    expect(pluginBridge.requestNodeExecutionGrant).toHaveBeenCalledOnceWith(manifest.id);
    expect(pluginBridge.setNodeExecutionGrantToken).toHaveBeenCalledOnceWith(
      manifest.id,
      'token-1',
    );
  });

  it('treats runner loaded:false activation results as failures', async () => {
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'broken-plugin',
      name: 'Broken Plugin',
    };
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(manifest.id, {
      manifest,
      status: 'not-loaded',
      path: 'assets/bundled-plugins/broken-plugin',
      type: 'built-in',
      isEnabled: true,
    });
    pluginLoader.loadPluginAssets.and.resolveTo({
      manifest,
      code: 'throw new Error("broken")',
    });
    pluginRunner.loadPlugin.and.resolveTo({
      manifest,
      loaded: false,
      isEnabled: true,
      error: 'broken',
    });
    pluginBridge.revokeNodeExecutionGrantToken.and.returnValue('grant-token');

    const result = await service.activatePlugin(manifest.id);

    expect(result).toBeNull();
    expect(pluginRunner.unloadPlugin).toHaveBeenCalledOnceWith(manifest.id);
    expect(pluginRunner.triggerReady).not.toHaveBeenCalled();
    expect(pluginBridge.revokeNodeExecutionGrantToken).toHaveBeenCalledWith(manifest.id);
    expect(service.getLoadedPlugins()).toEqual([]);
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'error',
        instance: undefined,
        error: 'broken',
      }),
    );
  });

  it('does not serve iframe HTML for plugins that are not loaded and enabled', () => {
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'blocked-iframe',
      name: 'Blocked Iframe',
      iFrame: true,
    };
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
        _pluginIndexHtml: Map<string, string>;
      }
    )._setPluginState(manifest.id, {
      manifest,
      status: 'error',
      path: 'uploaded://blocked-iframe',
      type: 'uploaded',
      isEnabled: false,
      error: T.PLUGINS.NODE_EXECUTION_PERMISSION_DENIED,
    });
    (
      service as unknown as {
        _pluginIndexHtml: Map<string, string>;
      }
    )._pluginIndexHtml.set(manifest.id, '<html>blocked</html>');

    expect(service.getPluginIndexHtml(manifest.id)).toBeNull();
  });

  it('bumps iframe generation when unloading a plugin runtime', () => {
    const instance: PluginInstance = {
      manifest: mockManifest,
      loaded: true,
      isEnabled: true,
    };
    (
      service as unknown as {
        _loadedPlugins: PluginInstance[];
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._loadedPlugins = [instance];
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(mockManifest.id, {
      manifest: mockManifest,
      status: 'loaded',
      path: 'uploaded://test-plugin',
      type: 'uploaded',
      isEnabled: true,
      instance,
    });

    const generationBeforeUnload = service.getPluginIframeGeneration(mockManifest.id);

    service.unloadPlugin(mockManifest.id);

    expect(service.getPluginIframeGeneration(mockManifest.id)).toBe(
      generationBeforeUnload + 1,
    );
  });

  it('clears stale instances when ready handling fails', () => {
    const instance: PluginInstance = {
      manifest: mockManifest,
      loaded: true,
      isEnabled: true,
    };
    (
      service as unknown as {
        _loadedPlugins: PluginInstance[];
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._loadedPlugins = [instance];
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(mockManifest.id, {
      manifest: mockManifest,
      status: 'loaded',
      path: 'uploaded://test-plugin',
      type: 'uploaded',
      isEnabled: true,
      instance,
    });

    (
      service as unknown as {
        _handleReadyFailure: (instance: PluginInstance, error: unknown) => void;
      }
    )._handleReadyFailure(instance, new Error('ready failed'));

    expect(pluginRunner.unloadPlugin).toHaveBeenCalledOnceWith(mockManifest.id);
    expect(service.getAllPluginStates().get(mockManifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'error',
        instance: undefined,
        error: 'ready failed',
      }),
    );
    expect(service.getLoadedPlugins()).toEqual([]);
  });
});

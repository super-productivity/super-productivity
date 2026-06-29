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
import { PluginSecretService } from './secret/plugin-secret.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginI18nService } from './plugin-i18n.service';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { PluginRunner } from './plugin-runner';
import { PluginSecurityService } from './plugin-security';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginInstance, PluginManifest } from './plugin-api.model';
import { NodeExecutionConsentDeniedError, PluginService } from './plugin.service';
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
      'clearOAuthTokens',
      'clearNodeExecutionConsent',
    ]);
    pluginBridge.hasNodeExecutionGrantToken.and.returnValue(false);
    pluginBridge.requestNodeExecutionGrant.and.resolveTo(null);
    pluginBridge.clearOAuthTokens.and.resolveTo(undefined);
    pluginBridge.clearNodeExecutionConsent.and.resolveTo(undefined);
    pluginRunner = jasmine.createSpyObj<PluginRunner>('PluginRunner', [
      'loadPlugin',
      'unloadPlugin',
      'triggerUnload',
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
    expect(pluginBridge.requestNodeExecutionGrant).toHaveBeenCalledOnceWith(manifest.id, {
      name: manifest.name,
      version: manifest.version,
    });
    expect(pluginMetaPersistenceService.setPluginEnabled).not.toHaveBeenCalled();
    expect(pluginLoader.loadPluginAssets).not.toHaveBeenCalled();
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'not-loaded',
        isEnabled: false,
      }),
    );
  });

  it('does not re-prompt for nodeExecution after a denial within the same session', async () => {
    const runtime = service as unknown as { _isElectronRuntime: () => boolean };
    spyOn(runtime, '_isElectronRuntime').and.returnValue(true);
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };
    const ensureGrant = (
      service as unknown as {
        _ensureNodeExecutionGrant: (m: PluginManifest) => Promise<boolean>;
      }
    )._ensureNodeExecutionGrant.bind(service);

    // First interactive attempt prompts and is denied (requestNodeExecutionGrant -> null).
    await expectAsync(service.checkNodeExecutionPermission(manifest)).toBeResolvedTo(
      false,
    );
    // A later non-interactive grant attempt this session (e.g. startup re-entry via
    // _fireOnReady) must NOT re-open the native prompt.
    await expectAsync(ensureGrant(manifest)).toBeResolvedTo(false);
    expect(pluginBridge.requestNodeExecutionGrant).toHaveBeenCalledTimes(1);
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

    expect(pluginBridge.requestNodeExecutionGrant).toHaveBeenCalledOnceWith(manifest.id, {
      name: manifest.name,
      version: manifest.version,
    });
    expect(pluginBridge.setNodeExecutionGrantToken).toHaveBeenCalledOnceWith(
      manifest.id,
      'token-1',
    );
  });

  it('clearNodeExecutionConsent drops the session denial and asks the bridge to clear consent', async () => {
    const pluginId = 'node-plugin';
    const deniedSet = (
      service as unknown as { _nodeExecutionDeniedThisSession: Set<string> }
    )._nodeExecutionDeniedThisSession;
    deniedSet.add(pluginId);

    const result = await service.clearNodeExecutionConsent(pluginId);

    expect(result).toBe(true);
    expect(deniedSet.has(pluginId)).toBe(false);
    expect(pluginBridge.clearNodeExecutionConsent).toHaveBeenCalledOnceWith(pluginId);
  });

  it('clearNodeExecutionConsent returns false when the persisted clear fails (caller can fail closed)', async () => {
    // A persistence failure must NOT throw (lifecycle bookkeeping ignores it), but must be
    // reported via the return value so loadPluginFromZip can abort before loading new code
    // under an id whose stale consent could not be revoked.
    pluginBridge.clearNodeExecutionConsent.and.rejectWith(new Error('disk full'));

    const result = await service.clearNodeExecutionConsent('node-plugin');

    expect(result).toBe(false);
  });

  it('removeUploadedPlugin clears persisted nodeExecution consent (Phase 2)', async () => {
    const pluginId = 'uploaded-node-plugin';

    await service.removeUploadedPlugin(pluginId);

    expect(pluginBridge.clearNodeExecutionConsent).toHaveBeenCalledWith(pluginId);
  });

  it('clearUploadedPluginsFromMemory clears persisted nodeExecution consent for uploaded plugins only (Phase 2)', async () => {
    const setState = (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState.bind(service);
    setState('uploaded-1', {
      manifest: { ...mockManifest, id: 'uploaded-1', permissions: ['nodeExecution'] },
      status: 'not-loaded',
      path: 'uploaded://uploaded-1',
      type: 'uploaded',
      isEnabled: true,
    });
    setState('builtin-1', {
      manifest: { ...mockManifest, id: 'builtin-1', permissions: ['nodeExecution'] },
      status: 'not-loaded',
      path: 'assets/bundled-plugins/builtin-1',
      type: 'built-in',
      isEnabled: true,
    });

    await service.clearUploadedPluginsFromMemory();

    // Without this, a same-id re-upload after a cache clear (no `existingState`) would be
    // silently re-granted node execution with no prompt — the bug this guards against.
    expect(pluginBridge.clearNodeExecutionConsent).toHaveBeenCalledWith('uploaded-1');
    // Built-in plugins never persist consent, so they are not cleared here.
    expect(pluginBridge.clearNodeExecutionConsent).not.toHaveBeenCalledWith('builtin-1');
  });

  it('clearUploadedPluginsFromMemory purges local-only credentials for uploaded plugins', async () => {
    // Same id-reuse gap as the consent clear above: the cache wipe leaves secrets/OAuth
    // tokens in their dedicated stores, so a same-id re-upload could read the previous
    // plugin's credentials unless they are purged here too.
    const secretService = TestBed.inject(PluginSecretService);
    const removeSecretsSpy = spyOn(
      secretService,
      'removeSecretsForPlugin',
    ).and.resolveTo();
    const setState = (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState.bind(service);
    setState('uploaded-1', {
      manifest: { ...mockManifest, id: 'uploaded-1' },
      status: 'not-loaded',
      path: 'uploaded://uploaded-1',
      type: 'uploaded',
      isEnabled: true,
    });
    setState('builtin-1', {
      manifest: { ...mockManifest, id: 'builtin-1' },
      status: 'not-loaded',
      path: 'assets/bundled-plugins/builtin-1',
      type: 'built-in',
      isEnabled: true,
    });

    await service.clearUploadedPluginsFromMemory();

    expect(removeSecretsSpy).toHaveBeenCalledWith('uploaded-1');
    expect(pluginBridge.clearOAuthTokens).toHaveBeenCalledWith('uploaded-1');
    // Built-in plugins are not wiped by a cache clear, so their credentials are left alone.
    expect(removeSecretsSpy).not.toHaveBeenCalledWith('builtin-1');
    expect(pluginBridge.clearOAuthTokens).not.toHaveBeenCalledWith('builtin-1');
  });

  it('disablePlugin persists isEnabled=false and revokes nodeExecution consent (Phase 2)', async () => {
    const pluginId = 'uploaded-node-plugin';
    (
      service as unknown as {
        _setPluginState: (pluginId: string, state: PluginState) => void;
      }
    )._setPluginState(pluginId, {
      manifest: { ...mockManifest, id: pluginId, permissions: ['nodeExecution'] },
      status: 'not-loaded',
      path: 'uploaded://uploaded-node-plugin',
      type: 'uploaded',
      isEnabled: true,
    });

    await service.disablePlugin(pluginId);

    expect(pluginMetaPersistenceService.setPluginEnabled).toHaveBeenCalledWith(
      pluginId,
      false,
    );
    // Disable must revoke consent so re-enabling re-prompts — the invariant that previously
    // lived only in the UI handler where a future disable path could forget it.
    expect(pluginBridge.clearNodeExecutionConsent).toHaveBeenCalledWith(pluginId);
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

  describe('removeUploadedPlugin credential cleanup', () => {
    it('purges both secrets and OAuth tokens on uninstall', async () => {
      const secretService = TestBed.inject(PluginSecretService);
      const removeSecretsSpy = spyOn(
        secretService,
        'removeSecretsForPlugin',
      ).and.resolveTo();

      await service.removeUploadedPlugin('ghost-plugin');

      expect(removeSecretsSpy).toHaveBeenCalledWith('ghost-plugin');
      expect(pluginBridge.clearOAuthTokens).toHaveBeenCalledWith('ghost-plugin');
    });

    it('purges credentials even when a later cleanup step fails', async () => {
      const secretService = TestBed.inject(PluginSecretService);
      const removeSecretsSpy = spyOn(
        secretService,
        'removeSecretsForPlugin',
      ).and.resolveTo();
      const cache = TestBed.inject(
        PluginCacheService,
      ) as jasmine.SpyObj<PluginCacheService>;
      cache.removePlugin.and.rejectWith(new Error('cache failure'));

      // The credential purges run before the failing step, so they still fire.
      await expectAsync(service.removeUploadedPlugin('ghost-plugin')).toBeRejected();

      expect(removeSecretsSpy).toHaveBeenCalledWith('ghost-plugin');
      expect(pluginBridge.clearOAuthTokens).toHaveBeenCalledWith('ghost-plugin');
    });
  });

  // chokepoint #1: the actual #8385 path (startup re-activation / reload both flow through
  // `activatePlugin`'s catch). Driven by making `_loadPluginLazy` reject with the denial
  // sentinel, since the real `_fireOnReady` grant block is gated on the un-mockable
  // `IS_ELECTRON` constant in the web test env.
  it('disables (not errors) via activatePlugin when nodeExecution consent is denied (#8385)', async () => {
    const runtime = service as unknown as { _isElectronRuntime: () => boolean };
    spyOn(runtime, '_isElectronRuntime').and.returnValue(true);
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };
    const svc = service as unknown as {
      _setPluginState: (pluginId: string, state: PluginState) => void;
      _loadPluginLazy: (state: PluginState) => Promise<PluginInstance>;
    };
    svc._setPluginState(manifest.id, {
      manifest,
      status: 'not-loaded',
      path: 'uploaded://node-plugin',
      type: 'uploaded',
      isEnabled: true,
    });
    spyOn(svc, '_loadPluginLazy').and.rejectWith(
      new NodeExecutionConsentDeniedError(T.PLUGINS.NODE_EXECUTION_PERMISSION_DENIED),
    );

    const result = await service.activatePlugin(manifest.id); // non-manual = startup

    expect(result).toBeNull();
    // Clean disabled state, NOT an error tile → `canEnablePlugin` (= !plugin.error) stays
    // true, so the toggle is clickable and re-enabling re-prompts (no restart needed).
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'not-loaded',
        instance: undefined,
        isEnabled: false,
        error: undefined,
      }),
    );
    // Device-local decision: a denial must NOT write the synced `pluginMetadata` entity,
    // else it would disable the plugin on every other device too.
    expect(pluginMetaPersistenceService.setPluginEnabled).not.toHaveBeenCalled();
    // The main-process grant is still revoked on the way out (the security-load-bearing step).
    expect(pluginBridge.revokeNodeExecutionGrantToken).toHaveBeenCalledWith(manifest.id);
    // A denial is a deliberate choice, not a failure → no ERROR snack.
    const snack = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    expect(snack.open).not.toHaveBeenCalled();
  });

  // chokepoint #2: the same normalisation when the denial surfaces via `_handleReadyFailure`
  // (the live ZIP re-upload-of-an-enabled-id path).
  it('disables (does not error) a plugin when nodeExecution consent is denied at onReady', () => {
    const manifest: PluginManifest = {
      ...mockManifest,
      id: 'node-plugin',
      name: 'Node Plugin',
      permissions: ['nodeExecution'],
    };
    const instance: PluginInstance = { manifest, loaded: true, isEnabled: true };
    const svc = service as unknown as {
      _loadedPlugins: PluginInstance[];
      _setPluginState: (pluginId: string, state: PluginState) => void;
      _handleReadyFailure: (instance: PluginInstance, error: unknown) => void;
    };
    svc._loadedPlugins = [instance];
    svc._setPluginState(manifest.id, {
      manifest,
      status: 'loaded',
      path: 'uploaded://node-plugin',
      type: 'uploaded',
      isEnabled: true,
      instance,
    });

    svc._handleReadyFailure(
      instance,
      new NodeExecutionConsentDeniedError(T.PLUGINS.NODE_EXECUTION_PERMISSION_DENIED),
    );

    // Clean disabled state, NOT an error tile (so `canEnablePlugin` stays true).
    expect(service.getAllPluginStates().get(manifest.id)).toEqual(
      jasmine.objectContaining({
        status: 'not-loaded',
        instance: undefined,
        isEnabled: false,
        error: undefined,
      }),
    );
    // Device-local: never writes the synced pluginMetadata.
    expect(pluginMetaPersistenceService.setPluginEnabled).not.toHaveBeenCalled();
    // A denial is a deliberate choice, not a failure → no ERROR snack.
    const snack = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    expect(snack.open).not.toHaveBeenCalled();
    expect(pluginRunner.unloadPlugin).toHaveBeenCalledOnceWith(manifest.id);
    expect(service.getLoadedPlugins()).toEqual([]);
  });
});

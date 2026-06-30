/* eslint-disable max-len */
import { inject, Injectable, signal, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PluginRunner } from './plugin-runner';
import { PluginHooksService } from './plugin-hooks';
import { PluginSecurityService } from './plugin-security';
import { Hooks, PluginBaseCfg, PluginInstance, PluginManifest } from './plugin-api.model';
import { PluginState } from './plugin-state.model';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { IS_ANDROID_WEB_VIEW } from '../util/is-android-web-view';
import { IS_ELECTRON } from '../app.constants';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginCacheService } from './plugin-cache.service';
import {
  MAX_PLUGIN_CODE_SIZE,
  MAX_PLUGIN_MANIFEST_SIZE,
  MAX_PLUGIN_ZIP_SIZE,
} from './plugin.const';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginSecretService } from './secret/plugin-secret.service';
import { PluginLoaderService } from './plugin-loader.service';
import { validatePluginManifest } from './util/validate-manifest.util';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../t.const';
import { PluginLog } from '../core/log';
import { PluginI18nService } from './plugin-i18n.service';
import { Store } from '@ngrx/store';
import { issueProvidersFeature } from '../features/issue/store/issue-provider.reducer';
import { selectIsDominaModeConfig } from '../features/config/store/global-config.reducer';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { SnackService } from '../core/snack/snack.service';
import { pingWithRetry } from './util/ping-with-retry.util';
import { PluginBridgeService } from './plugin-bridge.service';

// Each plugin's `id` (from its manifest.json, distinct from the asset path
// here) becomes the entityId prefix for all data it persists via
// `persistDataSynced` — keyed entries land under `<pluginId>:<key>` in IDB,
// the op-log, and on the sync wire. Once a plugin ships, renaming its id
// orphans every user's stored data: there is no automatic re-keying. Treat
// pluginIds as permanent for any plugin that has ever been published.
const BUNDLED_PLUGIN_PATHS = [
  'assets/bundled-plugins/yesterday-tasks-plugin',
  'assets/bundled-plugins/sync-md',
  'assets/bundled-plugins/api-test-plugin',
  'assets/bundled-plugins/procrastination-buster',
  'assets/bundled-plugins/automations',
  'assets/bundled-plugins/github-issue-provider',
  'assets/bundled-plugins/clickup-issue-provider',
  'assets/bundled-plugins/gitea-issue-provider',
  'assets/bundled-plugins/linear-issue-provider',
  'assets/bundled-plugins/trello-issue-provider',
  'assets/bundled-plugins/azure-devops-issue-provider',
  'assets/bundled-plugins/brain-dump',
  'assets/bundled-plugins/voice-reminder',
  'assets/bundled-plugins/google-calendar-provider',
  'assets/bundled-plugins/caldav-calendar-provider',
  'assets/bundled-plugins/doc-mode',
] as const;

// Reserved ids: an uploaded plugin may not reuse a bundled plugin's manifest id (it would
// let unverified code impersonate a built-in — and, with nodeExecution now openable to
// uploaded plugins, claim a bundled dir's "verified built-in" consent dialog in the main
// process, which decides bundled-vs-uploaded by on-disk dir). This set MUST contain the
// manifest id of every entry in BUNDLED_PLUGIN_PATHS; the invariant is guarded by
// electron/bundled-plugin-ids.test.cjs (a filesystem-reading node test, since a browser
// Karma spec cannot read the manifests) so the two lists cannot silently drift again.
const BUNDLED_PLUGIN_IDS = new Set<string>([
  'ai-productivity-prompts',
  'api-test-plugin',
  'automations',
  'azure-devops-issue-provider',
  'brain-dump',
  'caldav-calendar-provider',
  'clickup-issue-provider',
  'doc-mode',
  'gitea-issue-provider',
  'github-issue-provider',
  'google-calendar-provider',
  'linear-issue-provider',
  'procrastination-buster',
  'sync-md',
  'trello-issue-provider',
  'voice-reminder',
  'yesterday-tasks',
]);

/**
 * Thrown by `_fireOnReady` when the user explicitly DENIES a nodeExecution consent
 * prompt, so the failure handlers can treat it as a deliberate choice (clean disable)
 * rather than a load failure (#8512). See `_handleNodeExecutionConsentDenied`.
 */
export class NodeExecutionConsentDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeExecutionConsentDeniedError';
  }
}

@Injectable({
  providedIn: 'root',
})
export class PluginService implements OnDestroy {
  private readonly _http = inject(HttpClient);
  private readonly _pluginRunner = inject(PluginRunner);
  private readonly _pluginHooks = inject(PluginHooksService);
  private readonly _pluginSecurity = inject(PluginSecurityService);
  private readonly _globalThemeService = inject(GlobalThemeService);
  private readonly _pluginMetaPersistenceService = inject(PluginMetaPersistenceService);
  private readonly _pluginUserPersistenceService = inject(PluginUserPersistenceService);
  private readonly _pluginCacheService = inject(PluginCacheService);
  private readonly _pluginSecretService = inject(PluginSecretService);
  private readonly _cleanupService = inject(PluginCleanupService);
  private readonly _pluginLoader = inject(PluginLoaderService);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _translateService = inject(TranslateService);
  private readonly _pluginI18nService = inject(PluginI18nService);
  private readonly _store = inject(Store);
  private readonly _pluginIssueProviderRegistry = inject(
    PluginIssueProviderRegistryService,
  );
  private readonly _syncAdapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _snackService = inject(SnackService);

  private _isInitialized = false;
  private _loadedPlugins: PluginInstance[] = [];
  private _pluginPaths: Map<string, string> = new Map(); // Store plugin ID -> path mapping
  private _pluginIndexHtml: Map<string, string> = new Map(); // Store plugin ID -> index.html content
  private _pluginIcons: Map<string, string> = new Map(); // Store plugin ID -> SVG icon content
  private _pluginIframeGenerations: Map<string, number> = new Map();
  private _pluginIconsSignal = signal<Map<string, string>>(new Map());
  // Plugin ids the user denied nodeExecution for this app session. In-memory only —
  // never persisted or synced (consent is session-scoped). Makes a denial sticky so a
  // later non-interactive grant attempt (e.g. startup re-activation via _fireOnReady,
  // which doesn't pass through checkNodeExecutionPermission) doesn't re-open the native
  // prompt. Added on deny in _ensureNodeExecutionGrant; cleared only on an explicit
  // user-initiated enable in checkNodeExecutionPermission (so re-enable always re-asks).
  private readonly _nodeExecutionDeniedThisSession = new Set<string>();

  // Lazy loading state management
  private _pluginStates = signal<Map<string, PluginState>>(new Map());
  public readonly pluginStates = this._pluginStates.asReadonly();

  // Track active side panel plugin
  private _activeSidePanelPlugin$ = new BehaviorSubject<PluginInstance | null>(null);
  public readonly activeSidePanelPlugin$ = this._activeSidePanelPlugin$.asObservable();

  async initializePlugins(): Promise<void> {
    if (this._isInitialized) {
      PluginLog.err(this._translateService.instant(T.PLUGINS.ALREADY_INITIALIZED));
      return;
    }

    PluginLog.log('Initializing plugin system...');

    try {
      // Only load manifests, not the actual plugin code
      await this._discoverBuiltInPlugins();
      await this._discoverUploadedPlugins();

      // Load all enabled plugins on startup
      await this._loadEnabledPlugins();

      this._isInitialized = true;
      PluginLog.log('Plugin system initialized successfully');
    } catch (error) {
      PluginLog.err('Failed to initialize plugin system:', error);
      throw error;
    }
  }

  private async _discoverBuiltInPlugins(): Promise<void> {
    const pluginPaths = [
      ...BUNDLED_PLUGIN_PATHS,
      'assets/bundled-plugins/ai-productivity-prompts', // discover-only
    ];

    // Only load manifests for discovery
    for (const path of pluginPaths) {
      try {
        const manifestUrl = `${path}/manifest.json`;
        const manifest = await this._http.get<PluginManifest>(manifestUrl).toPromise();

        if (manifest) {
          let isEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
            manifest.id,
          );

          // Auto-enable bundled plugins that replace built-in issue providers,
          // but only if the user has never interacted with the plugin before.
          // If metadata exists (even with isEnabled: false), the user explicitly disabled it.
          if (!isEnabled && manifest.issueProvider?.issueProviderKey) {
            const hasMetadata =
              await this._pluginMetaPersistenceService.hasPluginMetadata(manifest.id);
            if (!hasMetadata) {
              const shouldAutoEnable = await this._shouldAutoEnableMigrationPlugin(
                manifest.issueProvider.issueProviderKey,
              );
              if (shouldAutoEnable) {
                isEnabled = true;
                await this._pluginMetaPersistenceService.setPluginEnabled(
                  manifest.id,
                  true,
                );
                PluginLog.log(
                  `Auto-enabled bundled plugin '${manifest.id}' (replaces built-in ${manifest.issueProvider.issueProviderKey} provider)`,
                );
              }
            }
          }

          // Auto-enable voice-reminder plugin if domina mode was enabled,
          // and migrate config so users keep their settings.
          if (!isEnabled && manifest.id === 'voice-reminder') {
            const hasMetadata =
              await this._pluginMetaPersistenceService.hasPluginMetadata(manifest.id);
            if (!hasMetadata) {
              const migrated = await this._migrateVoiceReminderFromDominaMode();
              if (migrated) {
                isEnabled = true;
                await this._pluginMetaPersistenceService.setPluginEnabled(
                  manifest.id,
                  true,
                );
                PluginLog.log(
                  `Auto-enabled voice-reminder plugin (migrated from domina mode config)`,
                );
              }
            }
          }

          // Create plugin state without loading code
          const state: PluginState = {
            manifest,
            status: 'not-loaded',
            path,
            type: 'built-in',
            isEnabled,
          };

          this._setPluginState(manifest.id, state);
          this._pluginPaths.set(manifest.id, path);

          // Load icon if available
          try {
            const iconUrl = `${path}/${manifest.icon || 'icon.svg'}`;
            const icon = await this._http
              .get(iconUrl, { responseType: 'text' })
              .toPromise();
            if (icon) {
              state.icon = icon;
              this._pluginIcons.set(manifest.id, icon);
              this._updatePluginIcons();
            }
          } catch (e) {
            // Icon is optional - silently ignore 404s and other errors
            PluginLog.debug(
              `Icon not found for plugin ${manifest.id}: ${path}/${manifest.icon || 'icon.svg'}`,
            );
          }
        }
      } catch (error) {
        if (
          error instanceof HttpErrorResponse &&
          (error.status === 0 || error.status === 404)
        ) {
          PluginLog.warn(
            `Optional built-in plugin manifest missing at ${path} (status ${error.status}). Skipping.`,
          );
        } else {
          PluginLog.err(`Failed to discover plugin at ${path}:`, error);
        }
      }
    }
  }

  private async _loadBuiltInPlugins(): Promise<void> {
    const pluginPaths = [...BUNDLED_PLUGIN_PATHS];

    // KISS: No preloading - just load plugins directly
    await this._loadPluginsFromPaths(pluginPaths, 'built-in');
  }

  private async _discoverUploadedPlugins(): Promise<void> {
    try {
      const cachedPlugins = await this._pluginCacheService.getAllPlugins();

      for (const cachedPlugin of cachedPlugins) {
        try {
          const isEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
            cachedPlugin.id,
          );

          // Parse the manifest from JSON string
          const manifest: PluginManifest = JSON.parse(cachedPlugin.manifest);
          if (manifest.id !== cachedPlugin.id) {
            PluginLog.err(
              `Ignoring cached plugin ${cachedPlugin.id}: manifest id ${manifest.id} does not match cache id`,
            );
            continue;
          }
          this._assertUploadedPluginAllowed(manifest);

          // Create plugin state without loading code
          const state: PluginState = {
            manifest,
            status: 'not-loaded',
            path: `uploaded://${cachedPlugin.id}`,
            type: 'uploaded',
            isEnabled,
            icon: cachedPlugin.icon,
          };

          this._setPluginState(cachedPlugin.id, state);
          this._pluginPaths.set(cachedPlugin.id, state.path);

          if (cachedPlugin.icon) {
            this._pluginIcons.set(cachedPlugin.id, cachedPlugin.icon);
            this._registerPluginIcon(cachedPlugin.id, cachedPlugin.icon);
            this._updatePluginIcons();
          }
        } catch (error) {
          PluginLog.err(`Failed to discover cached plugin ${cachedPlugin.id}:`, error);
        }
      }
    } catch (error) {
      PluginLog.err('Failed to discover cached plugins:', error);
    }
  }

  private async _loadEnabledPlugins(): Promise<void> {
    // Load all enabled plugins on startup
    const pluginsToLoad = Array.from(this._pluginStates().values()).filter(
      (state) => state.isEnabled,
    );

    PluginLog.log(`Loading ${pluginsToLoad.length} enabled plugins...`);

    // Log which plugins are being loaded
    for (const state of pluginsToLoad) {
      PluginLog.log(
        `Loading plugin: ${state.manifest.id} (enabled: ${state.isEnabled}, hooks: ${state.manifest.hooks?.length || 0}, sidePanel: ${state.manifest.sidePanel})`,
      );
    }

    for (const state of pluginsToLoad) {
      await this.activatePlugin(state.manifest.id);
    }
  }

  /**
   * Check if a migration plugin should be auto-enabled because existing
   * issue providers with the matching key exist in the store.
   */
  private async _shouldAutoEnableMigrationPlugin(
    issueProviderKey: string,
  ): Promise<boolean> {
    try {
      const allProviders = await this._store
        .select(issueProvidersFeature.selectAll)
        .pipe(take(1))
        .toPromise();
      return allProviders?.some((p) => p.issueProviderKey === issueProviderKey) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Migrate domina mode (voice reminder) config to the voice-reminder plugin.
   * Returns true if migration was performed (domina mode was enabled).
   */
  private async _migrateVoiceReminderFromDominaMode(): Promise<boolean> {
    try {
      const cfg = await firstValueFrom(
        this._store.select(selectIsDominaModeConfig).pipe(take(1)),
      );
      if (!cfg?.isEnabled) {
        return false;
      }
      const pluginData = JSON.stringify({
        isEnabled: cfg.isEnabled,
        text: cfg.text,
        interval: cfg.interval,
        volume: cfg.volume,
        voice: cfg.voice || '',
      });
      this._pluginUserPersistenceService.persistPluginUserData(
        'voice-reminder',
        pluginData,
      );
      return true;
    } catch (e) {
      PluginLog.err('Failed to migrate voice reminder config from domina mode:', e);
      return false;
    }
  }

  /**
   * Returns discovered issue provider plugins that are NOT yet enabled.
   * Used by the issue-provider setup overview to show available plugins.
   */
  getDisabledIssueProviderPlugins(): Array<{
    pluginId: string;
    name: string;
    icon: string;
    issueProviderKey: string;
    useAgendaView: boolean;
  }> {
    const result: Array<{
      pluginId: string;
      name: string;
      icon: string;
      issueProviderKey: string;
      useAgendaView: boolean;
    }> = [];
    for (const [, state] of this._pluginStates()) {
      if (!state.isEnabled && state.manifest.type === 'issueProvider') {
        result.push({
          pluginId: state.manifest.id,
          name: state.manifest.name,
          icon: state.manifest.issueProvider?.icon || 'extension',
          issueProviderKey:
            state.manifest.issueProvider?.issueProviderKey ??
            `plugin:${state.manifest.id}`,
          useAgendaView: state.manifest.issueProvider?.useAgendaView ?? false,
        });
      }
    }
    return result;
  }

  /**
   * Enable and activate a plugin. Returns the activated instance.
   */
  async enableAndActivatePlugin(pluginId: string): Promise<PluginInstance | null> {
    const state = this._getPluginState(pluginId);
    if (!state) {
      PluginLog.err(`Plugin ${pluginId} not found`);
      return null;
    }

    const hasConsent = await this.checkNodeExecutionPermission(state.manifest);
    if (!hasConsent) {
      return null;
    }

    await this._pluginMetaPersistenceService.setPluginEnabled(pluginId, true);
    return this.activatePlugin(pluginId, true);
  }

  private _updatePluginIcons(): void {
    this._pluginIconsSignal.set(new Map(this._pluginIcons));
  }

  private _registerPluginIcon(pluginId: string, iconContent: string): void {
    const iconName = `plugin-${pluginId}-icon`;
    this._globalThemeService.registerSvgIconFromContent(iconName, iconContent);
  }

  private _setPluginState(pluginId: string, state: PluginState): void {
    this._pluginStates.update((states) => {
      const newStates = new Map(states);
      newStates.set(pluginId, state);
      return newStates;
    });
  }

  private _deletePluginState(pluginId: string): void {
    this._pluginStates.update((states) => {
      const newStates = new Map(states);
      newStates.delete(pluginId);
      return newStates;
    });
  }

  private _getPluginState(pluginId: string): PluginState | undefined {
    return this._pluginStates().get(pluginId);
  }

  /**
   * Activate a plugin (load it if not already loaded)
   * @param isManualActivation - true when user manually enables plugin, false on startup
   */
  async activatePlugin(
    pluginId: string,
    isManualActivation: boolean = false,
  ): Promise<PluginInstance | null> {
    const state = this._getPluginState(pluginId);
    if (!state) {
      PluginLog.err(`Plugin ${pluginId} not found`);
      return null;
    }

    if (isManualActivation) {
      const hasConsent = await this.checkNodeExecutionPermission(state.manifest);
      if (!hasConsent) {
        return null;
      }
    }

    // If manually activated, ensure the state reflects that it's enabled
    if (isManualActivation && !state.isEnabled) {
      this._setPluginState(pluginId, {
        ...state,
        isEnabled: true,
      });
    }

    // If already loaded, return the instance
    if (state.status === 'loaded' && state.instance) {
      return state.instance;
    }

    // If currently loading, wait for it
    if (state.status === 'loading') {
      // Wait for status to change (max 10 seconds)
      const maxAttempts = 100;
      let attempts = 0;
      await new Promise<void>((resolve, reject) => {
        const checkStatus = setInterval(() => {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(checkStatus);
            reject(new Error(`Plugin loading timeout after ${maxAttempts * 100}ms`));
            return;
          }
          const currentState = this._getPluginState(pluginId);
          if (currentState && currentState.status !== 'loading') {
            clearInterval(checkStatus);
            resolve();
          }
        }, 100);
      }).catch((err) => {
        PluginLog.err('Plugin activation error:', err);
      });

      const updatedState = this._getPluginState(pluginId);
      return updatedState?.instance || null;
    }

    // Get the updated state if it was just enabled
    const currentState = isManualActivation
      ? this._getPluginState(pluginId) || state
      : state;

    // Only check for permission if plugin is actually enabled
    if (currentState.isEnabled) {
      // Only check permission on startup - manual activation already checked in UI
      if (!isManualActivation) {
        const hasConsent = await this._checkNodeExecutionPermissionForStartup(
          currentState.manifest,
        );
        if (!hasConsent) {
          PluginLog.log(
            'Plugin requires Node.js execution permission but no stored consent found:',
            state.manifest.id,
          );
          // Don't disable the plugin on startup - user may have enabled it but not granted permission yet
          return null;
        }
      }
    } else {
      // Plugin is not enabled, don't activate it
      PluginLog.log(`Plugin ${pluginId} is not enabled, skipping activation`);
      return null;
    }

    // Load the plugin. nodeExecution plugins must have a main-issued session
    // grant before onReady is fired.
    this._setPluginState(pluginId, {
      ...currentState,
      status: 'loading',
    });

    try {
      PluginLog.log(`Activating plugin: ${pluginId}`);
      const instance = await this._loadPluginLazy(currentState);
      if (!instance.loaded) {
        throw new Error(
          instance.error ||
            this._translateService.instant(T.PLUGINS.ERROR_LOADING_PLUGIN),
        );
      }

      this._setPluginState(pluginId, {
        ...currentState,
        status: 'loaded',
        instance: instance,
      });

      // Add to loaded plugins list for compatibility
      if (!this._loadedPlugins.find((p) => p.manifest.id === pluginId)) {
        this._loadedPlugins.push(instance);
      }

      return instance;
    } catch (error) {
      PluginLog.err(`Failed to activate plugin ${pluginId}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Tear down any partially-registered runtime (hooks, buttons, side effects)
      // to avoid a "running" plugin while UI shows error state.
      try {
        this._pluginRunner.unloadPlugin(pluginId);
      } catch (unloadError) {
        PluginLog.err(
          `Failed to clean up plugin ${pluginId} after activation error:`,
          unloadError,
        );
      }
      void this._revokeNodeExecutionGrant(pluginId);

      // Deny = clean disable, not an error tile — see _handleNodeExecutionConsentDenied.
      if (error instanceof NodeExecutionConsentDeniedError) {
        this._handleNodeExecutionConsentDenied(pluginId);
        return null;
      }

      this._setPluginState(pluginId, {
        ...currentState,
        status: 'error',
        instance: undefined,
        error: errorMsg,
      });
      // Only surface a snack on user-initiated activation. Startup auto-activation
      // failures stay silent; the plugin tile already renders the error state, so
      // a pile-up of snacks on cold boot would be noise.
      if (isManualActivation) {
        this._snackService.open({
          msg: this._translateService.instant(T.PLUGINS.PLUGIN_LOAD_FAILED, {
            pluginName: currentState.manifest.name,
            error: errorMsg,
          }),
          type: 'ERROR',
        });
      }
      return null;
    }
  }

  private async _loadPluginLazy(state: PluginState): Promise<PluginInstance> {
    // Load the plugin code and assets
    const assets = await this._pluginLoader.loadPluginAssets(state.path);
    const { code: pluginCode, indexHtml, translations } = assets;

    // Store assets
    if (indexHtml) {
      this._pluginIndexHtml.set(state.manifest.id, indexHtml);
    }

    // Load translations into i18n service
    if (translations && Object.keys(translations).length > 0) {
      this._pluginI18nService.loadPluginTranslationsFromContent(
        state.manifest.id,
        translations,
      );
    }

    // Create base config
    const baseCfg = this._getBaseCfg();

    // Run the plugin
    const instance = await this._pluginRunner.loadPlugin(
      state.manifest,
      pluginCode,
      baseCfg,
      state.isEnabled,
    );

    await this._fireOnReady(instance);

    return instance;
  }

  /**
   * Fire onReady for a successfully loaded plugin. For nodeExecution plugins on
   * Electron, obtains a main-issued execution grant and pings the IPC bridge
   * first (with retry); throws if the bridge stays unavailable. Called after
   * every plugin load path.
   */
  private async _fireOnReady(instance: PluginInstance): Promise<void> {
    if (!instance.loaded) {
      return;
    }
    if (IS_ELECTRON && instance.manifest.permissions?.includes('nodeExecution')) {
      const hasGrant = await this._ensureNodeExecutionGrant(instance.manifest);
      if (!hasGrant) {
        // `_ensureNodeExecutionGrant` returns false for two different reasons: a deliberate
        // user DENIAL (which records the id in `_nodeExecutionDeniedThisSession`) and a
        // technical grant-request failure (IPC/bridge error — not recorded). Only a real
        // denial becomes the recoverable "clean disable"; a technical failure must surface
        // as a normal error tile/snack so the user sees something actually went wrong.
        if (this._nodeExecutionDeniedThisSession.has(instance.manifest.id)) {
          throw new NodeExecutionConsentDeniedError(
            this._translateService.instant(T.PLUGINS.NODE_EXECUTION_PERMISSION_DENIED),
          );
        }
        throw new Error(
          this._translateService.instant(T.PLUGINS.NODE_EXECUTION_PERMISSION_DENIED),
        );
      }
      await this._pingNodeBridge(instance.manifest);
    }
    await this._pluginRunner.triggerReady(instance.manifest.id);
  }

  /**
   * Same as _fireOnReady but tears down the plugin runtime if onReady fails,
   * so we never leave a "running" plugin while the UI shows error state.
   * Used by load paths whose outer catch only logs and rethrows.
   */
  private async _fireOnReadyWithCleanup(instance: PluginInstance): Promise<void> {
    try {
      await this._fireOnReady(instance);
    } catch (error) {
      this._handleReadyFailure(instance, error);
      throw error;
    }
  }

  /**
   * Tear down a plugin's runtime (hooks, buttons, side effects), remove it from
   * the loaded list, and update its state to 'error'. Idempotent.
   */
  private _handleReadyFailure(instance: PluginInstance, error: unknown): void {
    const pluginId = instance.manifest.id;
    const errorMsg = error instanceof Error ? error.message : String(error);
    PluginLog.err(`onReady failed for plugin ${pluginId}:`, error);
    this._bumpPluginIframeGeneration(pluginId);

    try {
      this._pluginRunner.unloadPlugin(pluginId);
    } catch (unloadError) {
      PluginLog.err(
        `Failed to clean up plugin ${pluginId} after onReady error:`,
        unloadError,
      );
    }

    const idx = this._loadedPlugins.findIndex((p) => p.manifest.id === pluginId);
    if (idx !== -1) {
      this._loadedPlugins.splice(idx, 1);
    }
    void this._revokeNodeExecutionGrant(pluginId);

    // Deny = clean disable (no error tile / no ERROR snack) — see the helper below.
    if (error instanceof NodeExecutionConsentDeniedError) {
      this._handleNodeExecutionConsentDenied(pluginId);
      return;
    }

    const currentState = this._pluginStates().get(pluginId);
    if (currentState) {
      this._setPluginState(pluginId, {
        ...currentState,
        status: 'error',
        instance: undefined,
        error: errorMsg,
      });
    }

    this._snackService.open({
      msg: this._translateService.instant(T.PLUGINS.PLUGIN_LOAD_FAILED, {
        pluginName: instance.manifest.name,
        error: errorMsg,
      }),
      type: 'ERROR',
    });
  }

  /**
   * Normalise a plugin to a clean, re-enableable disabled state after the user DENIED its
   * nodeExecution consent prompt (#8512 deny-recovery). Clears any `error` so the
   * management toggle is no longer grayed out (`canEnablePlugin` is `!plugin.error`) and
   * sets it OFF; flipping it back on clears the session-denied marker (see
   * `checkNodeExecutionPermission`) and re-opens the prompt — no app restart needed.
   *
   * Deliberately IN-MEMORY ONLY — it does NOT persist `isEnabled=false`. nodeExecution
   * consent is a per-device, session-scoped decision (see `_nodeExecutionDeniedThisSession`);
   * persisting would write the synced `pluginMetadata` entity, propagating a local "not now"
   * to every device as a durable disable. Leaving the persisted `isEnabled` untouched means
   * the next start on THIS device re-prompts, which matches the existing session-scoped model.
   * Runtime teardown (unload + grant revoke) is the caller's responsibility.
   */
  private _handleNodeExecutionConsentDenied(pluginId: string): void {
    PluginLog.log(`nodeExecution consent denied; disabling plugin: ${pluginId}`);
    const currentState = this._getPluginState(pluginId);
    if (currentState) {
      this._setPluginState(pluginId, {
        ...currentState,
        status: 'not-loaded',
        instance: undefined,
        isEnabled: false,
        error: undefined,
      });
    }
  }

  private async _loadUploadedPlugins(): Promise<void> {
    try {
      const cachedPlugins = await this._pluginCacheService.getAllPlugins();

      const promises = cachedPlugins.map(async (cachedPlugin) => {
        try {
          PluginLog.log(`Loading cached plugin: ${cachedPlugin.id}`);
          // Set the path for reload functionality
          this._pluginPaths.set(cachedPlugin.id, `uploaded://${cachedPlugin.id}`);

          // Load the cached plugin
          await this._loadUploadedPlugin(cachedPlugin.id);
          // The plugin instance is already added to _loadedPlugins in _loadUploadedPlugin if loaded successfully
        } catch (error) {
          PluginLog.err(`Failed to load cached plugin ${cachedPlugin.id}:`, error);
          // Continue loading other plugins even if one fails
        }
      });

      await Promise.allSettled(promises);
    } catch (error) {
      PluginLog.err('Failed to load cached plugins:', error);
      // Don't throw - this shouldn't prevent other plugins from loading
    }
  }

  /**
   * Load plugins from multiple paths with error handling
   */
  private async _loadPluginsFromPaths(
    pluginPaths: string[],
    type: 'built-in' | 'uploaded',
  ): Promise<void> {
    const promises = pluginPaths.map(async (pluginPath) => {
      try {
        const pluginInstance = await this._loadPlugin(pluginPath);
        // Add all plugin instances to the loaded plugins list so they show up in the management UI
        // Note: _loadPlugin already adds loaded plugins to _loadedPlugins, so we only need to add disabled ones
        if (!pluginInstance.loaded && !pluginInstance.isEnabled) {
          this._loadedPlugins.push(pluginInstance);
        }
        // Store the path for built-in plugins to enable reload functionality
        // This ensures that built-in plugins can be reloaded just like uploaded ones
        if (pluginInstance.manifest && pluginInstance.manifest.id) {
          this._pluginPaths.set(pluginInstance.manifest.id, pluginPath);
        }
        PluginLog.log(`${type} plugin loaded successfully from ${pluginPath}`);
      } catch (error) {
        PluginLog.err(`Failed to load ${type} plugin from ${pluginPath}:`, error);
        // Continue loading other plugins even if one fails
      }
    });

    await Promise.allSettled(promises);
  }

  private async _loadPlugin(pluginPath: string): Promise<PluginInstance> {
    try {
      // Use the loader service for lazy loading
      const assets = await this._pluginLoader.loadPluginAssets(pluginPath);
      const { manifest, code: pluginCode, indexHtml, icon, translations } = assets;
      if (pluginPath.startsWith('uploaded://')) {
        this._assertUploadedPluginAllowed(manifest);
      }

      // Store assets if loaded
      if (indexHtml) {
        this._pluginIndexHtml.set(manifest.id, indexHtml);
      }
      if (icon) {
        this._pluginIcons.set(manifest.id, icon);
        this._registerPluginIcon(manifest.id, icon);
        this._pluginIconsSignal.set(new Map(this._pluginIcons));
      }

      // Load translations into i18n service
      if (translations && Object.keys(translations).length > 0) {
        this._pluginI18nService.loadPluginTranslationsFromContent(
          manifest.id,
          translations,
        );
      }

      // Check if plugin should be loaded based on persisted enabled state
      const isPluginEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
        manifest.id,
      );

      // Validate manifest and code
      const manifestValidation = validatePluginManifest(manifest);
      if (!manifestValidation.isValid) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.VALIDATION_FAILED, {
            errors: manifestValidation.errors.join(', '),
          }),
        );
      }

      // Check for dangerous permissions
      if (this._pluginSecurity.hasElevatedPermissions(manifest)) {
        if (!IS_ELECTRON) {
          // In web version, create a disabled placeholder for nodeExecution plugins
          const placeholderInstance: PluginInstance = {
            manifest,
            loaded: false,
            isEnabled: false,
            error: this._translateService.instant(T.PLUGINS.NODE_ONLY_DESKTOP),
          };
          this._pluginPaths.set(manifest.id, pluginPath); // Store the path for potential reload
          PluginLog.log(
            `Plugin ${manifest.id} requires desktop version, creating placeholder`,
          );
          return placeholderInstance;
        }

        // Skip consent check during startup - will be checked when plugin is activated
        // This prevents showing multiple dialogs at once during app startup
      }

      // Analyze plugin code (informational only - KISS approach)
      const codeAnalysis = this._pluginSecurity.analyzePluginCode(pluginCode, manifest);
      if (codeAnalysis.warnings.length > 0) {
        PluginLog.err(`Plugin ${manifest.id} warnings:`, codeAnalysis.warnings);
      }
      if (codeAnalysis.info.length > 0) {
        PluginLog.info(`Plugin ${manifest.id} info:`, codeAnalysis.info);
      }

      // If plugin is disabled, create a placeholder instance without loading code
      if (!isPluginEnabled) {
        const placeholderInstance: PluginInstance = {
          manifest,
          loaded: false,
          isEnabled: false,
          error: undefined,
        };
        this._pluginPaths.set(manifest.id, pluginPath); // Store the path for potential reload
        PluginLog.log(`Plugin ${manifest.id} is disabled, skipping load`);
        return placeholderInstance;
      }

      // Load the plugin
      const baseCfg = this._getBaseCfg();
      const pluginInstance = await this._pluginRunner.loadPlugin(
        manifest,
        pluginCode,
        baseCfg,
        true, // Plugin is enabled if we reach this point
      );

      if (pluginInstance.loaded) {
        // Check if plugin is already in the list to prevent duplicates
        const existingIndex = this._loadedPlugins.findIndex(
          (p) => p.manifest.id === manifest.id,
        );
        if (existingIndex === -1) {
          this._loadedPlugins.push(pluginInstance);
        } else {
          // Replace existing instance
          this._loadedPlugins[existingIndex] = pluginInstance;
        }
        this._pluginPaths.set(manifest.id, pluginPath); // Store the path

        // Mark plugin as enabled in memory only during startup to avoid sync conflicts
        // The enabled state will be persisted later when user explicitly enables/disables plugins
        this._ensurePluginEnabledInMemory(manifest.id);

        await this._fireOnReadyWithCleanup(pluginInstance);

        PluginLog.log(`Plugin ${manifest.id} loaded successfully`);
      } else {
        PluginLog.err(`Plugin ${manifest.id} failed to load:`, pluginInstance.error);
      }

      return pluginInstance;
    } catch (error) {
      PluginLog.err(`Failed to load plugin from ${pluginPath}:`, error);
      throw error;
    }
  }

  private _getBaseCfg(): PluginBaseCfg {
    let platform: PluginBaseCfg['platform'] = 'web';
    if (IS_ELECTRON) {
      platform = 'desktop';
    } else if (IS_ANDROID_WEB_VIEW) {
      platform = 'android';
    }

    const darkModeValue = this._globalThemeService.darkMode();
    const isDark = darkModeValue === 'dark';

    return {
      theme: isDark ? 'dark' : 'light',
      appVersion: environment.version,
      platform,
      isDev: !environment.production,
    };
  }

  async getAllPlugins(): Promise<PluginInstance[]> {
    // In lazy loading mode, return all discovered plugins
    const allPlugins: PluginInstance[] = [];

    for (const state of this._pluginStates().values()) {
      if (state.instance) {
        // Plugin is loaded, use the instance
        allPlugins.push(state.instance);
      } else {
        // Create a placeholder instance
        allPlugins.push({
          manifest: state.manifest,
          loaded: state.status === 'loaded',
          isEnabled: state.isEnabled,
          error: state.error,
        });
      }
    }

    return allPlugins;
  }

  getAllPluginStates(): Map<string, PluginState> {
    return new Map(this._pluginStates());
  }

  async getAllPluginsLegacy(): Promise<PluginInstance[]> {
    const loadedPlugins = [...this._loadedPlugins];
    const allPluginMetadata =
      await this._pluginMetaPersistenceService.getAllPluginMetadata();

    // Update loaded plugins with persistence state
    for (const plugin of loadedPlugins) {
      const metadata = allPluginMetadata.find((data) => data.id === plugin.manifest.id);
      plugin.isEnabled = metadata?.isEnabled ?? false;
    }

    // Add disabled plugins that aren't loaded
    for (const pluginMetadata of allPluginMetadata) {
      const isAlreadyLoaded = loadedPlugins.some(
        (p) => p.manifest.id === pluginMetadata.id,
      );
      if (!isAlreadyLoaded && pluginMetadata.isEnabled === false) {
        // Create minimal PluginInstance for disabled plugins
        loadedPlugins.push({
          manifest: {
            id: pluginMetadata.id,
            name: pluginMetadata.id,
            version: 'unknown',
            manifestVersion: 1,
            minSupVersion: 'unknown',
            hooks: [],
            permissions: [],
            type: 'standard',
          },
          loaded: false,
          isEnabled: false,
          error: undefined,
        });
      }
    }

    return loadedPlugins;
  }

  getLoadedPlugins(): PluginInstance[] {
    return [...this._loadedPlugins];
  }

  /**
   * Get a loaded plugin by ID
   * Returns an Observable that emits the plugin instance if found
   */
  getLoadedPlugin(pluginId: string): Observable<PluginInstance | null> {
    const plugin = this._loadedPlugins.find(
      (p) => p.manifest.id === pluginId && p.loaded,
    );
    return of(plugin || null);
  }

  getPluginPath(pluginId: string): string | undefined {
    return this._pluginPaths.get(pluginId);
  }

  getPluginIframeGeneration(pluginId: string): number {
    return this._pluginIframeGenerations.get(pluginId) ?? 0;
  }

  isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get index.html content for a plugin
   */
  getPluginIndexHtml(pluginId: string): string | null {
    if (!this._canServePluginIndexHtml(pluginId)) {
      return null;
    }
    return this._pluginIndexHtml.get(pluginId) || null;
  }

  /**
   * Get SVG icon content for a plugin
   */
  getPluginIcon(pluginId: string): string | null {
    return this._pluginIcons.get(pluginId) || null;
  }

  /**
   * Get reactive signal for plugin icons
   */
  getPluginIconsSignal(): import('@angular/core').Signal<ReadonlyMap<string, string>> {
    return this._pluginIconsSignal.asReadonly();
  }

  /**
   * Set the active side panel plugin
   */
  async setActiveSidePanelPlugin(pluginId: string | null): Promise<void> {
    if (!pluginId) {
      this._activeSidePanelPlugin$.next(null);
      return;
    }

    // Check if plugin exists in states
    const state = this._getPluginState(pluginId);
    if (!state) {
      PluginLog.err(`Plugin ${pluginId} not found`);
      this._activeSidePanelPlugin$.next(null);
      return;
    }

    // If plugin is already loaded, use it
    if (state.instance && state.status === 'loaded') {
      this._activeSidePanelPlugin$.next(state.instance);
      return;
    }

    // Lazy load the plugin if needed
    try {
      const instance = await this.activatePlugin(pluginId);
      if (instance) {
        this._activeSidePanelPlugin$.next(instance);
      } else {
        PluginLog.err(`Failed to activate plugin ${pluginId}`);
        this._activeSidePanelPlugin$.next(null);
      }
    } catch (error) {
      PluginLog.err(`Error activating plugin ${pluginId}:`, error);
      this._activeSidePanelPlugin$.next(null);
    }
  }

  /**
   * Get the current active side panel plugin ID
   */
  getActiveSidePanelPluginId(): string | null {
    const activePlugin = this._activeSidePanelPlugin$.value;
    return activePlugin?.manifest.id || null;
  }

  /**
   * Get the base configuration for plugins
   */
  async getBaseCfg(): Promise<PluginBaseCfg> {
    return this._getBaseCfg();
  }

  /**
   * Load plugin index.html content
   */
  async loadPluginIndexHtml(pluginId: string): Promise<string | null> {
    if (!this._canServePluginIndexHtml(pluginId)) {
      return null;
    }

    // First check if we already have it cached
    const cached = this._pluginIndexHtml.get(pluginId);
    if (cached) {
      return cached;
    }

    // Try to load from cache if it's an uploaded plugin
    const pluginPath = this._pluginPaths.get(pluginId);
    if (pluginPath?.startsWith('uploaded://')) {
      const cachedPlugin = await this._pluginCacheService.getPlugin(pluginId);
      if (cachedPlugin?.indexHtml) {
        if (!this._canServePluginIndexHtml(pluginId)) {
          return null;
        }
        this._pluginIndexHtml.set(pluginId, cachedPlugin.indexHtml);
        return cachedPlugin.indexHtml;
      }
    }

    return null;
  }

  private _canServePluginIndexHtml(pluginId: string): boolean {
    const state = this._getPluginState(pluginId);
    return (
      !!state &&
      state.status === 'loaded' &&
      state.isEnabled &&
      state.instance?.loaded === true &&
      !state.error
    );
  }

  async dispatchHook(hookName: Hooks, payload?: unknown): Promise<void> {
    // NOTE: these are events that the plugins might listen to. it is ok that they don't get them, if they happen
    // before the plugins are loaded
    if (!this._isInitialized) {
      return;
    }
    await this._pluginHooks.dispatchHook(hookName, payload);
  }

  async dispatchHookToPlugin(
    pluginId: string,
    hookName: Hooks,
    payload?: unknown,
  ): Promise<void> {
    if (!this._isInitialized) {
      return;
    }
    await this._pluginHooks.dispatchHookToPlugin(pluginId, hookName, payload);
  }

  async loadPluginFromPath(pluginPath: string): Promise<PluginInstance> {
    const pluginInstance = await this._loadPlugin(pluginPath);

    if (pluginInstance.loaded) {
      this._loadedPlugins.push(pluginInstance);
    }

    return pluginInstance;
  }

  async loadPluginFromZip(file: File): Promise<PluginInstance> {
    PluginLog.log('Starting plugin load from ZIP', {
      size: file.size,
      type: file.type,
    });

    // Import fflate dynamically for better bundle size
    const { unzip } = await import('fflate');

    try {
      // Validate ZIP file size
      if (file.size > MAX_PLUGIN_ZIP_SIZE) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.FILE_TOO_LARGE, {
            maxSize: (MAX_PLUGIN_ZIP_SIZE / 1024 / 1024).toFixed(1),
            fileSize: (file.size / 1024 / 1024).toFixed(1),
          }),
        );
      }

      // Convert File to Uint8Array
      const arrayBuffer = await file.arrayBuffer();
      const zipData = new Uint8Array(arrayBuffer);

      // Extract ZIP contents
      const extractedFiles = await new Promise<Record<string, Uint8Array>>(
        (resolve, reject) => {
          unzip(zipData, (err, files) => {
            if (err) {
              reject(
                new Error(
                  this._translateService.instant(T.PLUGINS.FAILED_TO_EXTRACT_ZIP, {
                    error: err.message,
                  }),
                ),
              );
              return;
            }
            resolve(files);
          });
        },
      );
      const extractedFileEntries = Object.entries(extractedFiles);
      PluginLog.log('Plugin ZIP extracted', {
        fileCount: extractedFileEntries.length,
        totalBytes: extractedFileEntries.reduce((sum, [, data]) => sum + data.length, 0),
        hasManifest: !!extractedFiles['manifest.json'],
        hasPluginJs: !!extractedFiles['plugin.js'],
        hasIndexHtml: !!extractedFiles['index.html'],
      });

      // Find and extract manifest.json
      if (!extractedFiles['manifest.json']) {
        throw new Error(this._translateService.instant(T.PLUGINS.MANIFEST_NOT_FOUND));
      }

      // Validate manifest.json size
      const manifestBytes = extractedFiles['manifest.json'];
      if (manifestBytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.MANIFEST_TOO_LARGE, {
            maxSize: (MAX_PLUGIN_MANIFEST_SIZE / 1024).toFixed(1),
          }),
        );
      }

      const manifestText = new TextDecoder().decode(manifestBytes);
      const manifest: PluginManifest = JSON.parse(manifestText);

      // Validate manifest
      const manifestValidation = validatePluginManifest(manifest);
      if (!manifestValidation.isValid) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.VALIDATION_FAILED, {
            errors: manifestValidation.errors.join(', '),
          }),
        );
      }
      this._assertUploadedPluginAllowed(manifest);

      // Extract index.html if it exists (optional) and iFrame is true
      let indexHtml: string | null = null;
      const hasIndexHtml =
        manifest.iFrame === true && extractedFiles['index.html'] !== undefined;
      if (hasIndexHtml) {
        const indexHtmlBytes = extractedFiles['index.html'];
        // Reuse the manifest size limit for index.html.
        if (indexHtmlBytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
          throw new Error(
            this._translateService.instant(T.PLUGINS.INDEX_HTML_TOO_LARGE, {
              maxSize: (MAX_PLUGIN_MANIFEST_SIZE / 1024).toFixed(1),
            }),
          );
        }
        indexHtml = new TextDecoder().decode(indexHtmlBytes);
      }

      // Extract plugin.js when available. Iframe-only plugins can omit it because
      // PluginRunner auto-registers iframe menu and side-panel entries from the manifest.
      let pluginCode = '';
      const pluginCodeBytes = extractedFiles['plugin.js'];
      if (pluginCodeBytes !== undefined) {
        if (pluginCodeBytes.length > MAX_PLUGIN_CODE_SIZE) {
          throw new Error(
            this._translateService.instant(T.PLUGINS.CODE_TOO_LARGE, {
              maxSize: (MAX_PLUGIN_CODE_SIZE / 1024 / 1024).toFixed(1),
            }),
          );
        }
        pluginCode = new TextDecoder().decode(pluginCodeBytes);
      } else if (!hasIndexHtml) {
        throw new Error(this._translateService.instant(T.PLUGINS.PLUGIN_JS_NOT_FOUND));
      } else if (!indexHtml?.trim()) {
        throw new Error(this._translateService.instant(T.PLUGINS.INDEX_HTML_NOT_LOADED));
      }

      // Extract icon if specified in manifest
      let iconContent: string | null = null;
      if (manifest.icon && extractedFiles[manifest.icon]) {
        const iconBytes = extractedFiles[manifest.icon];
        // Reuse the manifest size limit for the SVG icon.
        if (iconBytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
          throw new Error(
            this._translateService.instant(T.PLUGINS.ICON_TOO_LARGE, {
              maxSize: (MAX_PLUGIN_MANIFEST_SIZE / 1024).toFixed(1),
            }),
          );
        }
        iconContent = new TextDecoder().decode(iconBytes);
        // Basic SVG validation
        if (!iconContent.includes('<svg') || !iconContent.includes('</svg>')) {
          PluginLog.err(`Plugin icon ${manifest.icon} does not appear to be a valid SVG`);
          iconContent = null;
        }
      }

      // Extract config schema if specified in manifest
      let configSchema: string | undefined;
      if (manifest.jsonSchemaCfg && extractedFiles[manifest.jsonSchemaCfg]) {
        const schemaBytes = extractedFiles[manifest.jsonSchemaCfg];
        if (schemaBytes.length <= MAX_PLUGIN_MANIFEST_SIZE) {
          configSchema = new TextDecoder().decode(schemaBytes);
        } else {
          PluginLog.err(
            `Plugin config schema ${manifest.jsonSchemaCfg} is too large, skipping`,
          );
        }
      }

      // Analyze plugin code (informational only - KISS approach)
      const codeAnalysis = this._pluginSecurity.analyzePluginCode(pluginCode, manifest);
      if (codeAnalysis.warnings.length > 0) {
        PluginLog.err(`Plugin ${manifest.id} warnings:`, codeAnalysis.warnings);
      }
      if (codeAnalysis.info.length > 0) {
        PluginLog.info(`Plugin ${manifest.id} info:`, codeAnalysis.info);
      }

      // An explicit upload always (re)installs code under this id, so any prior persisted
      // nodeExecution consent no longer applies — clear it unconditionally, BEFORE loading
      // the new code and outside the `existingState` branch (issue #8512 Phase 2). This
      // closes the orphaned-consent gap: if consent survived in the main-owned store while
      // the in-memory/cache record was already gone (a crash mid-uninstall, IndexedDB
      // eviction, or an external/partial wipe), a same-id re-upload would otherwise skip the
      // clear and be silently granted node execution with no prompt. This MUST fail closed:
      // if the revoke can't be persisted we abort the upload here, before any teardown or
      // code store, rather than load replacement code that could inherit the old grant. (For
      // a brand-new id with nothing to clear the call is a no-op and returns true.) Re-asking
      // once per upload is intended; ask-once is about sessions, not uploads.
      if (!(await this.clearNodeExecutionConsent(manifest.id))) {
        throw new Error(
          `Aborting upload of "${manifest.id}": could not clear previous nodeExecution consent`,
        );
      }

      // Teardown existing plugin runtime if re-uploading same ID
      const existingState = this._getPluginState(manifest.id);
      if (existingState) {
        this._teardownPluginRuntime(manifest.id);
        // Clear stale assets from previous version
        this._pluginIndexHtml.delete(manifest.id);
        this._pluginIcons.delete(manifest.id);
        this._pluginIconsSignal.set(new Map(this._pluginIcons));
      }

      // Check if plugin is enabled (default to true for new uploads)
      const isPluginEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
        manifest.id,
      );

      // Create a unique path identifier for uploaded plugins
      const uploadedPluginPath = `uploaded://${manifest.id}`;

      // Always store plugin files in cache for later use (regardless of enabled state)
      await this._pluginCacheService.storePlugin(
        manifest.id,
        manifestText,
        pluginCode,
        indexHtml || undefined,
        iconContent || undefined,
        undefined,
        configSchema,
      );

      // Store index.html content if it exists
      if (indexHtml) {
        this._pluginIndexHtml.set(manifest.id, indexHtml);
      }

      // Store icon content if it exists
      if (iconContent) {
        this._pluginIcons.set(manifest.id, iconContent);
        this._registerPluginIcon(manifest.id, iconContent);
        this._pluginIconsSignal.set(new Map(this._pluginIcons));
      }

      // Check for dangerous permissions in web version
      if (this._pluginSecurity.hasElevatedPermissions(manifest) && !IS_ELECTRON) {
        // In web version, create a disabled placeholder for nodeExecution plugins
        const placeholderInstance: PluginInstance = {
          manifest,
          loaded: false,
          isEnabled: false,
          error: this._translateService.instant(T.PLUGINS.NODE_ONLY_DESKTOP),
        };
        this._pluginPaths.set(manifest.id, uploadedPluginPath);
        // Check if plugin is already in the list to prevent duplicates
        const existingIndex = this._loadedPlugins.findIndex(
          (p) => p.manifest.id === manifest.id,
        );
        if (existingIndex === -1) {
          this._loadedPlugins.push(placeholderInstance);
        } else {
          // Replace existing instance
          this._loadedPlugins[existingIndex] = placeholderInstance;
        }

        // Add to plugin states for UI reactivity
        const state: PluginState = {
          manifest,
          status: 'error',
          path: uploadedPluginPath,
          type: 'uploaded',
          isEnabled: false,
          error: placeholderInstance.error,
          icon: iconContent || undefined,
        };
        this._setPluginState(manifest.id, state);

        PluginLog.log(
          `Uploaded plugin ${manifest.id} requires desktop version, creating placeholder`,
        );
        return placeholderInstance;
      }

      // If plugin is disabled, create a placeholder instance without loading code
      if (!isPluginEnabled) {
        const placeholderInstance: PluginInstance = {
          manifest,
          loaded: false,
          isEnabled: false,
          error: undefined,
        };
        this._pluginPaths.set(manifest.id, uploadedPluginPath);
        // Check if plugin is already in the list to prevent duplicates
        const existingIndexDisabled = this._loadedPlugins.findIndex(
          (p) => p.manifest.id === manifest.id,
        );
        if (existingIndexDisabled === -1) {
          this._loadedPlugins.push(placeholderInstance);
        } else {
          // Replace existing instance
          this._loadedPlugins[existingIndexDisabled] = placeholderInstance;
        }

        // Add to plugin states for UI reactivity
        const state: PluginState = {
          manifest,
          status: 'not-loaded',
          path: uploadedPluginPath,
          type: 'uploaded',
          isEnabled: false,
          icon: iconContent || undefined,
        };
        this._setPluginState(manifest.id, state);

        PluginLog.log(`Uploaded plugin ${manifest.id} is disabled, skipping load`);
        return placeholderInstance;
      }

      // Load the plugin
      const baseCfg = this._getBaseCfg();
      const pluginInstance = await this._pluginRunner.loadPlugin(
        manifest,
        pluginCode,
        baseCfg,
        true, // Plugin is enabled if we reach this point
      );

      if (pluginInstance.loaded) {
        // Check if plugin is already in the list to prevent duplicates
        const existingIndexLoaded = this._loadedPlugins.findIndex(
          (p) => p.manifest.id === manifest.id,
        );
        if (existingIndexLoaded === -1) {
          this._loadedPlugins.push(pluginInstance);
        } else {
          // Replace existing instance
          this._loadedPlugins[existingIndexLoaded] = pluginInstance;
        }
        this._pluginPaths.set(manifest.id, uploadedPluginPath);

        // Add to plugin states for UI reactivity
        const state: PluginState = {
          manifest,
          status: 'loaded',
          path: uploadedPluginPath,
          type: 'uploaded',
          isEnabled: true,
          instance: pluginInstance,
          icon: iconContent || undefined,
        };
        this._setPluginState(manifest.id, state);

        await this._fireOnReadyWithCleanup(pluginInstance);

        PluginLog.log(`Uploaded plugin ${manifest.id} loaded successfully`);
      } else {
        PluginLog.err(
          `Uploaded plugin ${manifest.id} failed to load:`,
          pluginInstance.error,
        );

        // Add failed plugin to states as well
        const state: PluginState = {
          manifest,
          status: 'error',
          path: uploadedPluginPath,
          type: 'uploaded',
          isEnabled: false,
          error: pluginInstance.error,
          icon: iconContent || undefined,
        };
        this._setPluginState(manifest.id, state);
      }

      return pluginInstance;
    } catch (error) {
      PluginLog.err('Failed to load plugin from ZIP:', error);

      // Create error instance for UI display
      const errorInstance: PluginInstance = {
        manifest: {
          id: `error-${Date.now()}`,
          name: file.name.replace('.zip', ''),
          version: 'unknown',
          manifestVersion: 1,
          minSupVersion: 'unknown',
          hooks: [],
          permissions: [],
          type: 'standard',
        },
        loaded: false,
        isEnabled: false,
        error:
          error instanceof Error
            ? error.message
            : this._translateService.instant(T.PLUGINS.UNKNOWN_ERROR),
      };

      // Still add to loaded plugins list so user can see the error
      this._loadedPlugins.push(errorInstance);

      throw error;
    }
  }

  async removeUploadedPlugin(pluginId: string): Promise<void> {
    // Check if this plugin is active in the side panel
    const activePluginId = this.getActiveSidePanelPluginId();
    if (activePluginId === pluginId) {
      // Close the side panel if this plugin is active
      this.setActiveSidePanelPlugin(null);
    }

    // First disable and unload the plugin if it's currently loaded
    const pluginInstance = this._loadedPlugins.find((p) => p.manifest.id === pluginId);
    if (pluginInstance && pluginInstance.loaded) {
      // Disable the plugin first
      await this._pluginMetaPersistenceService.setPluginEnabled(pluginId, false);

      // Unload and unregister the plugin
      this.unloadPlugin(pluginId);
    }

    // Purge local-only credentials (secrets + OAuth tokens) FIRST so they
    // never outlive their plugin — even if a later cleanup step throws.
    // Best-effort: a purge failure is logged but must not abort the uninstall.
    // There is no later reconcile, so on IndexedDB failure the credentials
    // orphan on disk until the same plugin id is reinstalled and removed again.
    try {
      await this._pluginSecretService.removeSecretsForPlugin(pluginId);
    } catch (error) {
      PluginLog.err(`Failed to purge secrets for plugin ${pluginId}:`, error);
    }
    try {
      await this._pluginBridge.clearOAuthTokens(pluginId);
    } catch (error) {
      PluginLog.err(`Failed to purge OAuth tokens for plugin ${pluginId}:`, error);
    }

    // Remove from cache
    await this._pluginCacheService.removePlugin(pluginId);

    // Remove from persistence (both user data and metadata)
    await this._pluginUserPersistenceService.removePluginUserData(pluginId);
    await this._pluginMetaPersistenceService.removePluginMetadata(pluginId);

    // Remove from loaded plugins completely (not just unload)
    const index = this._loadedPlugins.findIndex((p) => p.manifest.id === pluginId);
    if (index !== -1) {
      this._loadedPlugins.splice(index, 1);
    }

    // Remove path mapping
    this._pluginPaths.delete(pluginId);

    // Remove index.html content
    this._pluginIndexHtml.delete(pluginId);

    // Remove icon content
    this._pluginIcons.delete(pluginId);
    this._pluginIconsSignal.set(new Map(this._pluginIcons));

    // Clear the session denial AND the main-owned persisted consent, so a fresh upload
    // of this id later starts from a clean prompt and a *different* plugin reusing the id
    // can never inherit the removed plugin's consent (issue #8512 Phase 2).
    await this.clearNodeExecutionConsent(pluginId);

    // Remove from plugin states
    this._deletePluginState(pluginId);

    PluginLog.log(`Uploaded plugin ${pluginId} removed completely`);
  }

  /**
   * Clear all uploaded plugins from memory. Called when the IndexedDB cache is cleared
   * so that in-memory state matches the empty cache.
   *
   * Also purges each uploaded plugin's local-only credentials (secrets + OAuth
   * tokens) and main-owned PERSISTED nodeExecution consent (issue #8512 Phase 2).
   * The cache wipe removes the plugin code, but credentials and consent live in
   * dedicated stores / the main process, so without this a later re-upload of the
   * same id — potentially *different* code — would silently inherit the previous
   * plugin's secrets, tokens, and node-execution grant with no prompt: the
   * post-clear upload has no `existingState`, so the re-upload clear in
   * `loadPluginFromZip` never fires. Mirrors `removeUploadedPlugin`, keeping
   * "replacing code under an id always re-asks" true on every removal path.
   */
  async clearUploadedPluginsFromMemory(): Promise<void> {
    const states = this._pluginStates();
    const uploadedIds: string[] = [];
    for (const [pluginId, state] of states.entries()) {
      if (state.type === 'uploaded') {
        uploadedIds.push(pluginId);
      }
    }
    for (const pluginId of uploadedIds) {
      this._teardownPluginRuntime(pluginId);
      this._pluginPaths.delete(pluginId);
      this._pluginIndexHtml.delete(pluginId);
      this._pluginIcons.delete(pluginId);
    }
    // Batch-delete all uploaded plugin states in a single signal update
    this._pluginStates.update((current) => {
      const updated = new Map(current);
      for (const pluginId of uploadedIds) {
        updated.delete(pluginId);
      }
      return updated;
    });
    this._pluginIconsSignal.set(new Map(this._pluginIcons));
    // Purge local-only credentials + persisted consent after teardown has released the
    // live grants. Each purge is best-effort and idempotent, so a single failure can't
    // skip the rest or leave a different id's credentials/consent behind for a same-id
    // re-upload to inherit.
    await Promise.all(
      uploadedIds.map(async (pluginId) => {
        try {
          await this._pluginSecretService.removeSecretsForPlugin(pluginId);
        } catch (error) {
          PluginLog.err(`Failed to purge secrets for plugin ${pluginId}:`, error);
        }
        try {
          await this._pluginBridge.clearOAuthTokens(pluginId);
        } catch (error) {
          PluginLog.err(`Failed to purge OAuth tokens for plugin ${pluginId}:`, error);
        }
        await this.clearNodeExecutionConsent(pluginId);
      }),
    );
  }

  /**
   * Teardown plugin runtime (hooks, runner, loaded-plugins list, side panel)
   * without changing isEnabled or _pluginStates. Used for re-upload and reload.
   */
  private _teardownPluginRuntime(pluginId: string): void {
    // Let the plugin clear its renderer-side timers/listeners first, while its
    // hooks and translations are still registered (#8281)
    this._pluginRunner.triggerUnload(pluginId);

    this._bumpPluginIframeGeneration(pluginId);

    // Close the side panel if this plugin is active
    const activePluginId = this.getActiveSidePanelPluginId();
    if (activePluginId === pluginId) {
      this.setActiveSidePanelPlugin(null);
    }

    // Remove from loaded plugins list
    const index = this._loadedPlugins.findIndex((p) => p.manifest.id === pluginId);
    if (index !== -1) {
      this._loadedPlugins.splice(index, 1);
    }

    // Unregister issue provider and sync adapter from their registries
    const registeredKey = this._pluginIssueProviderRegistry.getRegisteredKey(pluginId);
    this._pluginIssueProviderRegistry.unregister(pluginId);
    if (registeredKey) {
      this._syncAdapterRegistry.unregister(registeredKey);
    }

    // Unregister hooks, translations, and unload from runner
    this._pluginHooks.unregisterPluginHooks(pluginId);
    this._pluginI18nService.unloadPluginTranslations(pluginId);
    this._pluginRunner.unloadPlugin(pluginId);

    // SECURITY: revoke the main-process nodeExecution token on teardown, so a
    // disabled/uninstalled plugin cannot run Node for the rest of the session.
    // Best-effort and fire-and-forget because teardown is synchronous.
    // Deliberately AFTER triggerUnload above: the onUnload callback may make
    // one final node call for cleanup — same capability the plugin held while
    // enabled, just at a guaranteed point.
    void this._revokeNodeExecutionGrant(pluginId).catch((e) =>
      PluginLog.err(`Failed to revoke nodeExecution grant for ${pluginId}`, e),
    );
  }

  private _bumpPluginIframeGeneration(pluginId: string): void {
    this._pluginIframeGenerations.set(
      pluginId,
      this.getPluginIframeGeneration(pluginId) + 1,
    );
  }

  unloadPlugin(pluginId: string): boolean {
    // In lazy loading mode, update plugin state
    const state = this._getPluginState(pluginId);
    if (!state) {
      return false;
    }

    this._teardownPluginRuntime(pluginId);

    // Update state to not-loaded and disabled
    const updatedState: PluginState = {
      ...state,
      status: 'not-loaded',
      instance: undefined,
      isEnabled: false,
    };
    this._setPluginState(pluginId, updatedState);

    return true;
  }

  async reloadPlugin(pluginId: string): Promise<boolean> {
    const state = this._getPluginState(pluginId);
    if (!state) {
      PluginLog.err(`Cannot reload plugin ${pluginId}: not found`);
      return false;
    }

    // Teardown runtime without disabling, so activatePlugin can re-enable
    this._teardownPluginRuntime(pluginId);
    this._setPluginState(pluginId, {
      ...state,
      status: 'not-loaded',
      instance: undefined,
    });

    const instance = await this.activatePlugin(pluginId);
    return instance !== null && instance.loaded;
  }

  private async _loadUploadedPlugin(pluginId: string): Promise<PluginInstance> {
    try {
      // Use the loader service for uploaded plugins
      const assets = await this._pluginLoader.loadUploadedPluginAssets(pluginId);
      const { manifest, code: pluginCode, indexHtml, icon, translations } = assets;
      if (manifest.id !== pluginId) {
        throw new Error(`Cached plugin ${pluginId} manifest id mismatch`);
      }
      this._assertUploadedPluginAllowed(manifest);

      // Store assets if loaded
      if (indexHtml) {
        this._pluginIndexHtml.set(manifest.id, indexHtml);
      }
      if (icon) {
        this._pluginIcons.set(manifest.id, icon);
        this._registerPluginIcon(manifest.id, icon);
        this._pluginIconsSignal.set(new Map(this._pluginIcons));
      }

      // Load translations into i18n service
      if (translations && Object.keys(translations).length > 0) {
        this._pluginI18nService.loadPluginTranslationsFromContent(
          manifest.id,
          translations,
        );
      }

      // Validate manifest
      const manifestValidation = validatePluginManifest(manifest);
      if (!manifestValidation.isValid) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.VALIDATION_FAILED, {
            errors: manifestValidation.errors.join(', '),
          }),
        );
      }

      // Analyze plugin code (informational only - KISS approach)
      const codeAnalysis = this._pluginSecurity.analyzePluginCode(pluginCode, manifest);
      if (codeAnalysis.warnings.length > 0) {
        PluginLog.err(`Plugin ${manifest.id} warnings:`, codeAnalysis.warnings);
      }
      if (codeAnalysis.info.length > 0) {
        PluginLog.info(`Plugin ${manifest.id} info:`, codeAnalysis.info);
      }

      // Check if plugin is enabled
      const isPluginEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
        manifest.id,
      );

      // If plugin is disabled, create a placeholder instance without loading code
      if (!isPluginEnabled) {
        const placeholderInstance: PluginInstance = {
          manifest,
          loaded: false,
          isEnabled: false,
          error: undefined,
        };
        PluginLog.log(`Uploaded plugin ${manifest.id} is disabled, skipping reload`);
        return placeholderInstance;
      }

      // Load the plugin
      const baseCfg = this._getBaseCfg();
      const pluginInstance = await this._pluginRunner.loadPlugin(
        manifest,
        pluginCode,
        baseCfg,
        true, // Plugin is enabled if we reach this point
      );

      if (pluginInstance.loaded) {
        // Check if plugin is already in the list to prevent duplicates
        const existingIndex = this._loadedPlugins.findIndex(
          (p) => p.manifest.id === manifest.id,
        );
        if (existingIndex === -1) {
          this._loadedPlugins.push(pluginInstance);
        } else {
          // Replace existing instance
          this._loadedPlugins[existingIndex] = pluginInstance;
        }
        await this._fireOnReadyWithCleanup(pluginInstance);
        PluginLog.log(`Uploaded plugin ${manifest.id} reloaded successfully`);
      } else {
        PluginLog.err(
          `Uploaded plugin ${manifest.id} failed to reload:`,
          pluginInstance.error,
        );
      }

      return pluginInstance;
    } catch (error) {
      PluginLog.err(`Failed to reload uploaded plugin ${pluginId}:`, error);
      throw error;
    }
  }

  private async _ensureNodeExecutionGrant(manifest: PluginManifest): Promise<boolean> {
    if (!this._isElectronRuntime() || !manifest.permissions?.includes('nodeExecution')) {
      return true;
    }
    if (this._pluginBridge.hasNodeExecutionGrantToken(manifest.id)) {
      return true;
    }
    // A single enable flow reaches this from several call-sites; once the user has
    // denied this session, don't re-open the native prompt until they re-enable.
    if (this._nodeExecutionDeniedThisSession.has(manifest.id)) {
      return false;
    }
    let grant: { token: string } | null;
    try {
      // name/version are sent for the consent dialog only; main treats them as
      // self-declared/unverified for uploaded plugins (it never trusts them for auth).
      grant = await this._pluginBridge.requestNodeExecutionGrant(manifest.id, {
        name: manifest.name,
        version: manifest.version,
      });
    } catch (error) {
      PluginLog.err(`Failed to get nodeExecution grant for ${manifest.id}:`, error);
      return false;
    }
    if (!grant) {
      this._nodeExecutionDeniedThisSession.add(manifest.id);
      return false;
    }

    this._pluginBridge.setNodeExecutionGrantToken(manifest.id, grant.token);
    return true;
  }

  private async _revokeNodeExecutionGrant(pluginId: string): Promise<void> {
    const grantToken = this._pluginBridge.revokeNodeExecutionGrantToken(pluginId);
    if (!this._isElectronRuntime()) {
      return;
    }
    // Always tell main to drop the grant for this id, even if the renderer no longer
    // holds the token (main revokes by pluginId + webContents), so a re-upload under
    // the same id can never inherit a live session grant.
    await this._pluginBridge.revokeNodeExecutionGrant(pluginId, grantToken ?? '');
  }

  /**
   * Revoke a plugin's nodeExecution consent: clears the in-session grant token, the
   * session "denied" marker, and the main-owned PERSISTED consent (issue #8512 Phase 2),
   * so the next node call re-prompts. Called on disable, uninstall, and re-upload — the
   * three explicit, user-driven lifecycle edges. Deliberately NOT called from generic
   * teardown (`_teardownPluginRuntime`), which also fires on app shutdown/navigation and
   * must preserve "ask once across sessions".
   *
   * A persistence failure is logged (id only — the raw error can embed the userData path)
   * and reported via the RETURN VALUE rather than thrown: lifecycle edges (disable /
   * uninstall / cache-clear) treat the clear as best-effort and ignore the result, so a rare
   * disk failure can't abort their bookkeeping (zombie plugin state, or `disablePlugin`
   * rejecting after the plugin is already disabled). A SECURITY-critical caller that must
   * fail closed — `loadPluginFromZip`, before it loads replacement code under this id —
   * instead checks the result and aborts, so replacement code can never inherit a prior
   * grant just because the revoke write failed.
   *
   * @returns `true` if the persisted consent was cleared (or there was nothing to clear),
   *   `false` if the clear could not be persisted.
   */
  async clearNodeExecutionConsent(pluginId: string): Promise<boolean> {
    this._nodeExecutionDeniedThisSession.delete(pluginId);
    try {
      await this._pluginBridge.clearNodeExecutionConsent(pluginId);
      return true;
    } catch {
      PluginLog.err(`Failed to clear persisted nodeExecution consent for ${pluginId}`);
      return false;
    }
  }

  /**
   * Disable an installed plugin: persist `isEnabled=false`, tear down its runtime, and
   * revoke its nodeExecution consent (session grant + persisted), so re-enabling re-prompts
   * (issue #8512 Phase 2). Routing every disable through here keeps "disable revokes
   * consent" a structural invariant — a future disable path cannot silently skip the revoke
   * — which is why the revoke lives here rather than in `unloadPlugin` /
   * `_teardownPluginRuntime` (those also run on app shutdown/navigation, where consent must
   * survive). `clearNodeExecutionConsent` is a safe no-op for non-node plugins.
   */
  async disablePlugin(pluginId: string): Promise<void> {
    await this._pluginMetaPersistenceService.setPluginEnabled(pluginId, false);
    this.unloadPlugin(pluginId);
    await this.clearNodeExecutionConsent(pluginId);
  }

  /**
   * Check if a plugin requires and has consent for Node.js execution
   */
  async checkNodeExecutionPermission(manifest: PluginManifest): Promise<boolean> {
    // Check if plugin has nodeExecution permission
    if (!manifest.permissions?.includes('nodeExecution')) {
      return true; // No node execution permission needed
    }

    // Only check consent in Electron environment
    if (!this._isElectronRuntime()) {
      PluginLog.err(
        `Plugin ${manifest.id} requires nodeExecution permission which is not available in web environment`,
      );
      return false;
    }

    // This is the interactive (user-initiated) entry point, so an explicit enable
    // attempt clears any earlier this-session denial and re-opens the prompt.
    this._nodeExecutionDeniedThisSession.delete(manifest.id);
    return this._ensureNodeExecutionGrant(manifest);
  }

  /**
   * Ping the Node.js IPC bridge with a trivial no-op script.
   * Retries up to 3 times (delays: 1s, 2s) before throwing.
   * Throws if the bridge is unavailable after all retries.
   */
  private async _pingNodeBridge(manifest: PluginManifest): Promise<void> {
    const ok = await pingWithRetry(() => this._pluginRunner.pingNodeBridge(manifest.id));
    if (!ok) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.NODE_EXECUTION_BRIDGE_UNAVAILABLE),
      );
    }
  }

  /**
   * Startup only checks platform availability. Main-owned session grants are
   * requested later, immediately before onReady fires.
   */
  private async _checkNodeExecutionPermissionForStartup(
    manifest: PluginManifest,
  ): Promise<boolean> {
    // Check if plugin has nodeExecution permission
    if (!manifest.permissions?.includes('nodeExecution')) {
      return true; // No node execution permission needed
    }

    // Only check platform availability in Electron environment
    if (!this._isElectronRuntime()) {
      PluginLog.warn(
        `Plugin ${manifest.id} requires nodeExecution permission which is not available in web environment`,
      );
      return false;
    }

    // Startup may request a main-owned session grant during _fireOnReady.
    return true;
  }

  private _isElectronRuntime(): boolean {
    return IS_ELECTRON;
  }

  private _isBundledPluginId(pluginId: string): boolean {
    return BUNDLED_PLUGIN_IDS.has(pluginId);
  }

  private _assertUploadedPluginAllowed(manifest: PluginManifest): void {
    // Uploaded plugins may not reuse a bundled plugin's id (it would let unverified
    // code impersonate a built-in). nodeExecution is no longer blocked here: uploaded
    // node plugins are gated by the main-process consent dialog at grant time instead.
    if (this._isBundledPluginId(manifest.id)) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.PLUGIN_ID_RESERVED, {
          pluginId: manifest.id,
        }),
      );
    }
  }

  /**
   * Clean up all resources when service is destroyed
   */
  /**
   * Ensure plugin is marked as enabled in memory only during startup.
   * This avoids pfapi writes during initialization that could cause sync conflicts.
   */
  private _ensurePluginEnabledInMemory(pluginId: string): void {
    // We only need to track this in memory for startup purposes
    // The actual persistence will happen when user explicitly enables/disables plugins
    PluginLog.log(
      `Plugin ${pluginId} marked as enabled in memory (no pfapi write during startup)`,
    );
  }

  ngOnDestroy(): void {
    PluginLog.log('PluginService: Cleaning up all resources');

    // Complete the side panel subject
    this._activeSidePanelPlugin$.complete();

    // Unload all plugins first
    const pluginIds = [...this._loadedPlugins.map((p) => p.manifest.id)];
    pluginIds.forEach((pluginId) => {
      try {
        this.unloadPlugin(pluginId);
      } catch (error) {
        PluginLog.err(`Error unloading plugin ${pluginId} during cleanup:`, error);
      }
    });

    // Clear all internal maps
    this._pluginPaths.clear();
    this._pluginIndexHtml.clear();
    this._pluginIcons.clear();
    this._loadedPlugins = [];

    // Clean up any remaining resources
    this._cleanupService.cleanupAll();

    // Clear loader caches
    this._pluginLoader.clearAllCaches();

    PluginLog.log('PluginService: Cleanup complete');
  }
}

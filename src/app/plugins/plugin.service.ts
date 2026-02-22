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
import { MatDialog } from '@angular/material/dialog';
import {
  PluginNodeConsentDialogComponent,
  PluginNodeConsentDialogData,
} from './ui/plugin-node-consent-dialog/plugin-node-consent-dialog-simple.component';
import { first } from 'rxjs/operators';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginLoaderService } from './plugin-loader.service';
import { validatePluginManifest } from './util/validate-manifest.util';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../t.const';
import { PluginLog } from '../core/log';
import { PluginI18nService } from './plugin-i18n.service';

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
  private readonly _dialog = inject(MatDialog);
  private readonly _cleanupService = inject(PluginCleanupService);
  private readonly _pluginLoader = inject(PluginLoaderService);
  private readonly _translateService = inject(TranslateService);
  private readonly _pluginI18nService = inject(PluginI18nService);

  private _isInitialized = false;
  private _loadedPlugins: PluginInstance[] = [];
  private _pluginPaths: Map<string, string> = new Map(); // Store plugin ID -> path mapping
  private _pluginIndexHtml: Map<string, string> = new Map(); // Store plugin ID -> index.html content
  private _pluginIcons: Map<string, string> = new Map(); // Store plugin ID -> SVG icon content
  private _pluginIconsSignal = signal<Map<string, string>>(new Map());

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
      'assets/bundled-plugins/yesterday-tasks-plugin',
      'assets/bundled-plugins/sync-md',
      'assets/bundled-plugins/api-test-plugin',
      'assets/bundled-plugins/procrastination-buster',
      'assets/bundled-plugins/ai-productivity-prompts',
      'assets/bundled-plugins/automations',
    ];

    // Only load manifests for discovery
    for (const path of pluginPaths) {
      try {
        const manifestUrl = `${path}/manifest.json`;
        const manifest = await this._http.get<PluginManifest>(manifestUrl).toPromise();

        if (manifest) {
          const isEnabled = await this._pluginMetaPersistenceService.isPluginEnabled(
            manifest.id,
          );

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
    const pluginPaths = [
      'assets/bundled-plugins/yesterday-tasks-plugin',
      'assets/bundled-plugins/sync-md',
      'assets/bundled-plugins/api-test-plugin',
      'assets/bundled-plugins/procrastination-buster',
      'assets/bundled-plugins/automations',
    ];

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
        console.error('Plugin activation error:', err);
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
          console.log(
            'Plugin requires Node.js execution permission but no stored consent found:',
            state.manifest.id,
          );
          // Don't disable the plugin on startup - user may have enabled it but not granted permission yet
          return null;
        }
      }
    } else {
      // Plugin is not enabled, don't activate it
      console.log(`Plugin ${pluginId} is not enabled, skipping activation`);
      return null;
    }

    // Load the plugin
    this._setPluginState(pluginId, {
      ...currentState,
      status: 'loading',
    });

    try {
      PluginLog.log(`Activating plugin: ${pluginId}`);
      const instance = await this._loadPluginLazy(currentState);

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
      this._setPluginState(pluginId, {
        ...currentState,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
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

    return instance;
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

  isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get index.html content for a plugin
   */
  getPluginIndexHtml(pluginId: string): string | null {
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
        this._pluginIndexHtml.set(pluginId, cachedPlugin.indexHtml);
        return cachedPlugin.indexHtml;
      }
    }

    return null;
  }

  async dispatchHook(hookName: Hooks, payload?: unknown): Promise<void> {
    // NOTE: these are events that the plugins might listen to. it is ok that they don't get them, if they happen
    // before the plugins are loaded
    if (!this._isInitialized) {
      return;
    }
    await this._pluginHooks.dispatchHook(hookName, payload);
  }

  async loadPluginFromPath(pluginPath: string): Promise<PluginInstance> {
    const pluginInstance = await this._loadPlugin(pluginPath);

    if (pluginInstance.loaded) {
      this._loadedPlugins.push(pluginInstance);
    }

    return pluginInstance;
  }

  async loadPluginFromZip(file: File): Promise<PluginInstance> {
    PluginLog.log(`Starting plugin load from ZIP: ${file.name}`);

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
      PluginLog.log({ extractedFiles });

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
            fileSize: (manifestBytes.length / 1024).toFixed(1),
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

      // Find and extract plugin.js
      if (!extractedFiles['plugin.js']) {
        throw new Error(this._translateService.instant(T.PLUGINS.PLUGIN_JS_NOT_FOUND));
      }

      // Validate plugin.js size
      const pluginCodeBytes = extractedFiles['plugin.js'];
      if (pluginCodeBytes.length > MAX_PLUGIN_CODE_SIZE) {
        throw new Error(
          this._translateService.instant(T.PLUGINS.CODE_TOO_LARGE, {
            maxSize: (MAX_PLUGIN_CODE_SIZE / 1024 / 1024).toFixed(1),
            fileSize: (pluginCodeBytes.length / 1024 / 1024).toFixed(1),
          }),
        );
      }

      const pluginCode = new TextDecoder().decode(pluginCodeBytes);

      // Extract index.html if it exists (optional) and iFrame is true
      let indexHtml: string | null = null;
      if (manifest.iFrame && extractedFiles['index.html']) {
        const indexHtmlBytes = extractedFiles['index.html'];
        // Validate index.html size (same as manifest for now)
        if (indexHtmlBytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
          throw new Error(
            this._translateService.instant(T.PLUGINS.MANIFEST_TOO_LARGE, {
              maxSize: (MAX_PLUGIN_MANIFEST_SIZE / 1024).toFixed(1),
              fileSize: (indexHtmlBytes.length / 1024).toFixed(1),
            }),
          );
        }
        indexHtml = new TextDecoder().decode(indexHtmlBytes);
      }

      // Extract icon if specified in manifest
      let iconContent: string | null = null;
      if (manifest.icon && extractedFiles[manifest.icon]) {
        const iconBytes = extractedFiles[manifest.icon];
        // Validate icon size (same as manifest for now)
        if (iconBytes.length > MAX_PLUGIN_MANIFEST_SIZE) {
          throw new Error(
            this._translateService.instant(T.PLUGINS.MANIFEST_TOO_LARGE, {
              maxSize: (MAX_PLUGIN_MANIFEST_SIZE / 1024).toFixed(1),
              fileSize: (iconBytes.length / 1024).toFixed(1),
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

      // Analyze plugin code (informational only - KISS approach)
      const codeAnalysis = this._pluginSecurity.analyzePluginCode(pluginCode, manifest);
      if (codeAnalysis.warnings.length > 0) {
        PluginLog.err(`Plugin ${manifest.id} warnings:`, codeAnalysis.warnings);
      }
      if (codeAnalysis.info.length > 0) {
        PluginLog.info(`Plugin ${manifest.id} info:`, codeAnalysis.info);
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

    // Remove from plugin states
    this._deletePluginState(pluginId);

    PluginLog.log(`Uploaded plugin ${pluginId} removed completely`);
  }

  /**
   * Clear all uploaded plugins from memory. Called when IndexedDB cache is cleared
   * so that in-memory state matches the empty cache.
   */
  clearUploadedPluginsFromMemory(): void {
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
  }

  /**
   * Teardown plugin runtime (hooks, runner, loaded-plugins list, side panel)
   * without changing isEnabled or _pluginStates. Used for re-upload and reload.
   */
  private _teardownPluginRuntime(pluginId: string): void {
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

    // Unregister hooks, translations, and unload from runner
    this._pluginHooks.unregisterPluginHooks(pluginId);
    this._pluginI18nService.unloadPluginTranslations(pluginId);
    this._pluginRunner.unloadPlugin(pluginId);
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

  /**
   * Check if a plugin requires and has consent for Node.js execution
   */
  async checkNodeExecutionPermission(manifest: PluginManifest): Promise<boolean> {
    // Check if plugin has nodeExecution permission
    if (!manifest.permissions?.includes('nodeExecution')) {
      return true; // No node execution permission needed
    }

    // Only check consent in Electron environment
    if (!IS_ELECTRON) {
      PluginLog.err(
        `Plugin ${manifest.id} requires nodeExecution permission which is not available in web environment`,
      );
      return false;
    }

    return this._getNodeExecutionConsent(manifest);
  }

  /**
   * Check node execution permission on startup (uses stored consent)
   */
  private async _checkNodeExecutionPermissionForStartup(
    manifest: PluginManifest,
  ): Promise<boolean> {
    // Check if plugin has nodeExecution permission
    if (!manifest.permissions?.includes('nodeExecution')) {
      return true; // No node execution permission needed
    }

    // Only check consent in Electron environment
    if (!IS_ELECTRON) {
      console.warn(
        `Plugin ${manifest.id} requires nodeExecution permission which is not available in web environment`,
      );
      return false;
    }

    // On startup, use stored consent if available
    const storedConsent =
      await this._pluginMetaPersistenceService.getNodeExecutionConsent(manifest.id);

    // Only allow if consent was explicitly granted and stored
    return storedConsent === true;
  }

  /**
   * Get consent for Node.js execution permissions (KISS approach)
   */
  private async _getNodeExecutionConsent(manifest: PluginManifest): Promise<boolean> {
    // Check if we should pre-check the "remember" checkbox based on previous consent
    const previousConsent =
      await this._pluginMetaPersistenceService.getNodeExecutionConsent(manifest.id);

    // Always show dialog for nodeExecution permission
    const result = await this._dialog
      .open(PluginNodeConsentDialogComponent, {
        data: {
          manifest,
          rememberChoice: previousConsent === true, // Pre-check if previously consented
        } as PluginNodeConsentDialogData,
        disableClose: false,
        width: '500px',
      })
      .afterClosed()
      .pipe(first())
      .toPromise();

    if (result && result.granted) {
      // Store consent if user chose to remember
      if (result.remember) {
        // Delay write to avoid sync conflicts during startup
        setTimeout(() => {
          this._pluginMetaPersistenceService.setNodeExecutionConsent(manifest.id, true);
        }, 5000);
      } else {
        // User unchecked remember - remove stored consent
        setTimeout(() => {
          this._pluginMetaPersistenceService.setNodeExecutionConsent(manifest.id, false);
        }, 5000);
      }
      return true;
    }

    // User denied permission - remove any stored consent
    setTimeout(() => {
      this._pluginMetaPersistenceService.setNodeExecutionConsent(manifest.id, false);
    }, 5000);

    return false;
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

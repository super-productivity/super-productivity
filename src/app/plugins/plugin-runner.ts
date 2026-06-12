import { inject, Injectable } from '@angular/core';
import { PluginManifest, PluginBaseCfg, PluginInstance } from './plugin-api.model';
import { PluginAPI } from './plugin-api';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginSecurityService } from './plugin-security';
import { PluginI18nService } from './plugin-i18n.service';
import { SnackService } from '../core/snack/snack.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginLog } from '../core/log';

/**
 * Simplified plugin runner following KISS principles.
 * Focuses on functionality over complex sandboxing.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginRunner {
  private _pluginBridge = inject(PluginBridgeService);
  private _securityService = inject(PluginSecurityService);
  private _pluginI18nService = inject(PluginI18nService);
  private _snackService = inject(SnackService);
  private _cleanupService = inject(PluginCleanupService);

  private _loadedPlugins = new Map<string, PluginInstance>();
  private _pluginApis = new Map<string, PluginAPI>();
  private _readyCallbacks = new Map<string, () => void | Promise<void>>();
  private _unloadCallbacks = new Map<string, () => void | Promise<void>>();

  /**
   * Load and execute a plugin
   */
  async loadPlugin(
    manifest: PluginManifest,
    pluginCode: string,
    baseCfg: PluginBaseCfg,
    isEnabled: boolean = true,
  ): Promise<PluginInstance> {
    try {
      // Create plugin API
      const pluginAPI = new PluginAPI(
        baseCfg,
        manifest.id,
        this._pluginBridge,
        this._pluginI18nService,
        manifest,
        {
          // both registers ignore calls from a stale API instance — leaked
          // plugin code can run after its own unload (the failure class the
          // onUnload hook fixes) and must not clobber a reloaded instance's
          // callbacks
          onReady: (fn) => {
            if (this._pluginApis.get(manifest.id) === pluginAPI) {
              this._readyCallbacks.set(manifest.id, fn);
            }
          },
          onUnload: (fn) => {
            if (this._pluginApis.get(manifest.id) === pluginAPI) {
              this._unloadCallbacks.set(manifest.id, fn);
            }
          },
        },
      );

      // executeNodeScript is now automatically bound if permitted via createBoundMethods

      // Store API reference
      this._pluginApis.set(manifest.id, pluginAPI);

      // Create plugin instance
      const pluginInstance: PluginInstance = {
        manifest,
        loaded: false,
        isEnabled,
      };

      // Analyze code for user awareness (not blocking)
      const analysis = this._securityService.analyzePluginCode(pluginCode, manifest);

      // Show warnings if any
      if (analysis.warnings.length > 0) {
        PluginLog.err(`Plugin ${manifest.id} warnings:`, analysis.warnings);
        this._snackService.open({
          msg: `Plugin "${manifest.name}" has warnings: ${analysis.warnings[0]}`,
          type: 'CUSTOM',
          ico: 'warning',
        });
      }

      // Log info for transparency
      if (analysis.info.length > 0) {
        PluginLog.info(`Plugin ${manifest.id} info:`, analysis.info);
      }

      try {
        // Execute plugin code - simple and direct
        await this._executePlugin(pluginCode, pluginAPI, manifest);

        pluginInstance.loaded = true;

        // Register UI components for iframe plugins
        // Skip menu entry if this is a side panel plugin
        const pluginDisplayName = this._translatePluginText(
          manifest,
          'PLUGIN.NAME',
          manifest.name,
        );
        if (manifest.iFrame && !manifest.isSkipMenuEntry && !manifest.sidePanel) {
          pluginAPI.registerMenuEntry({
            label: pluginDisplayName,
            icon: manifest.icon || 'extension',
            onClick: () => pluginAPI.showIndexHtmlAsView(),
          });
        }

        // Auto-register side panel if configured
        if (manifest.sidePanel) {
          pluginAPI.registerSidePanelButton({
            label: pluginDisplayName,
            icon: manifest.icon || 'extension',
            onClick: () => {
              // No-op: the side panel toggle is handled by PluginSidePanelBtnsComponent
              // showIndexHtmlAsView() would navigate to full-screen which is not what we want
            },
          });
        }
      } catch (error) {
        pluginInstance.error =
          error instanceof Error ? error.message : 'Failed to load plugin';
        PluginLog.err(`Plugin ${manifest.id} error:`, error);
      }

      this._loadedPlugins.set(manifest.id, pluginInstance);
      return pluginInstance;
    } catch (error) {
      PluginLog.err(`Failed to load plugin ${manifest.id}:`, error);
      throw error;
    }
  }

  private _translatePluginText(
    manifest: PluginManifest,
    key: string,
    fallback: string,
  ): string {
    if (!manifest.i18n?.languages?.length) {
      return fallback;
    }
    const translated = this._pluginI18nService.translate(manifest.id, key);
    return translated === key ? fallback : translated;
  }

  /**
   * Execute plugin code - KISS approach
   */
  private async _executePlugin(
    code: string,
    api: PluginAPI,
    manifest: PluginManifest,
  ): Promise<void> {
    // Create a simple timeout wrapper
    const timeoutMs = 30000; // 30 seconds

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Plugin execution timeout')), timeoutMs);
    });

    const executionPromise = new Promise<void>((resolve, reject) => {
      try {
        // Simple function execution with plugin API in scope
        // Provide both 'plugin' and 'PluginAPI' for backward compatibility
        const pluginFunction = new Function(
          'plugin',
          'PluginAPI',
          `
          'use strict';
          try {
            ${code}
          } catch (error) {
            throw error;
          }
        `,
        );

        // Execute with API (pass same object for both parameter names)
        pluginFunction(api, api);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    // Race between execution and timeout
    await Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Unload a plugin and clean up resources
   */
  unloadPlugin(pluginId: string): boolean {
    // Fallback for teardown routes that bypass PluginService's
    // _teardownPluginRuntime (activation-error cleanup) — no-op when the
    // service already fired it. Outside the loaded-check so a plugin whose
    // loadPlugin threw after API creation still gets cleaned up.
    this.triggerUnload(pluginId);

    const plugin = this._loadedPlugins.get(pluginId);
    if (plugin) {
      this._readyCallbacks.delete(pluginId);

      // Clean up all resources
      this._cleanupService.cleanupPlugin(pluginId);

      // Remove from loaded plugins
      this._loadedPlugins.delete(pluginId);

      // Unregister hooks
      this._pluginBridge.unregisterPluginHooks(pluginId);

      PluginLog.log(`Plugin ${pluginId} unloaded`);
      return true;
    }
    return false;
  }

  /**
   * Get loaded plugin instance
   */
  getLoadedPlugin(pluginId: string): PluginInstance | undefined {
    return this._loadedPlugins.get(pluginId);
  }

  /**
   * Fire the plugin's registered onUnload callback so it can clear timers and
   * listeners it created in the renderer — code-based plugins outlive their
   * unload otherwise (see #8281). Idempotent: the callback fires at most once.
   * Fire-and-forget: teardown is sync and a buggy callback must not block it;
   * the returned promise of an async callback is not awaited (unlike
   * triggerReady, which is awaited and may throw).
   *
   * Side effect: also drops the plugin's API reference, which disables
   * sendMessageToPlugin and further lifecycle registrations for this instance.
   * Callers must follow up with unloadPlugin() — it is only called separately
   * by plugin.service.ts at the start of teardown, while hooks and
   * translations are still registered.
   */
  triggerUnload(pluginId: string): void {
    const unloadFn = this._unloadCallbacks.get(pluginId);
    this._unloadCallbacks.delete(pluginId);
    // drop the API reference first so re-registration from inside the callback
    // (or any later stale call) is ignored by the registration guard
    this._pluginApis.delete(pluginId);
    if (unloadFn) {
      void (async () => unloadFn())().catch((e) =>
        PluginLog.err(`Plugin ${pluginId} onUnload callback failed:`, e),
      );
    }
  }

  /**
   * Fire the onReady callback for a plugin.
   * Called by plugin.service.ts after the IPC bridge is confirmed available.
   */
  async triggerReady(pluginId: string): Promise<void> {
    const fn = this._readyCallbacks.get(pluginId);
    if (fn) {
      await fn();
    }
  }

  /**
   * Ping the Node.js IPC bridge by running a trivial script via the vm (executeDirectly)
   * path in the Electron executor. Uses the bridge directly — no plugin permission check.
   * Returns true if the bridge responds, false otherwise.
   */
  async pingNodeBridge(pluginId: string): Promise<boolean> {
    const instance = this._loadedPlugins.get(pluginId);
    if (!instance) {
      return false;
    }
    try {
      return await this._pluginBridge.pingNodeBridge(pluginId, instance.manifest);
    } catch {
      return false;
    }
  }

  /**
   * Send a message to a plugin's message handler
   */
  async sendMessageToPlugin(pluginId: string, message: unknown): Promise<unknown> {
    const pluginApi = this._pluginApis.get(pluginId);
    if (!pluginApi) {
      throw new Error(`Plugin ${pluginId} not found or not loaded`);
    }

    // Use the internal __sendMessage method on PluginAPI
    return (
      pluginApi as { __sendMessage: (message: unknown) => Promise<unknown> }
    ).__sendMessage(message);
  }

  // KISS: Hook execution is handled by PluginHooksService, not here
}

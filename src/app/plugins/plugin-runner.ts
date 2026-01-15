import { inject, Injectable } from '@angular/core';
import { PluginManifest, PluginBaseCfg, PluginInstance } from './plugin-api.model';
import { PluginAPI } from './plugin-api';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginSecurityService } from './plugin-security';
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
  private _snackService = inject(SnackService);
  private _cleanupService = inject(PluginCleanupService);

  private _loadedPlugins = new Map<string, PluginInstance>();
  private _pluginApis = new Map<string, PluginAPI>();

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
      const pluginAPI = new PluginAPI(baseCfg, manifest.id, this._pluginBridge, manifest);

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
        if (manifest.iFrame && !manifest.isSkipMenuEntry && !manifest.sidePanel) {
          pluginAPI.registerMenuEntry({
            label: manifest.name,
            icon: manifest.icon || 'extension',
            onClick: () => pluginAPI.showIndexHtmlAsView(),
          });
        }

        // Auto-register side panel if configured
        if (manifest.sidePanel) {
          pluginAPI.registerSidePanelButton({
            label: manifest.name,
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
    const plugin = this._loadedPlugins.get(pluginId);
    if (plugin) {
      // Clean up API reference
      this._pluginApis.delete(pluginId);

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

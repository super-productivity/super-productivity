import { inject, Injectable } from '@angular/core';
import { cleanupAllPluginIframeUrls } from './util/plugin-iframe.util';
import { PluginSyncProviderRegistryService } from './sync-provider/plugin-sync-provider-registry.service';
import { SyncProviderManager } from '../op-log/sync-providers/provider-manager.service';
import { PluginLocalPersistenceService } from './plugin-local-persistence.service';

/**
 * Simplified cleanup service following KISS principles.
 * Tracks iframes and handles sync provider/local data cleanup.
 * Let JavaScript's garbage collector handle the rest.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginCleanupService {
  private _pluginSyncProviderRegistry = inject(PluginSyncProviderRegistryService);
  private _syncProviderManager = inject(SyncProviderManager);
  private _pluginLocalPersistenceService = inject(PluginLocalPersistenceService);

  private _pluginIframes = new Map<string, HTMLIFrameElement>();

  /**
   * Register an iframe for cleanup
   */
  registerIframe(pluginId: string, iframe: HTMLIFrameElement): void {
    this._pluginIframes.set(pluginId, iframe);
  }

  /**
   * Clean up resources for a specific plugin (on disable/unload)
   */
  cleanupPlugin(pluginId: string): void {
    this._pluginIframes.delete(pluginId);

    // Unregister sync provider if registered
    const registeredKey = this._pluginSyncProviderRegistry.getRegisteredKey(pluginId);
    this._pluginSyncProviderRegistry.unregister(pluginId);
    if (registeredKey) {
      this._syncProviderManager.unregisterPluginProvider(registeredKey);
    }
  }

  /**
   * Full uninstall cleanup — also removes local data
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    this.cleanupPlugin(pluginId);
    await this._pluginLocalPersistenceService.removeLocalData(pluginId);
  }

  /**
   * Clean up all resources
   */
  cleanupAll(): void {
    this._pluginIframes.clear();
    cleanupAllPluginIframeUrls();
  }
}

import { Injectable } from '@angular/core';

/**
 * Simplified cleanup service following KISS principles.
 * Only track what's absolutely necessary - iframes.
 * Let JavaScript's garbage collector handle the rest.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginCleanupService {
  private _pluginIframes = new Map<string, HTMLIFrameElement>();

  /**
   * Register an iframe for cleanup
   */
  registerIframe(pluginId: string, iframe: HTMLIFrameElement): void {
    this._pluginIframes.set(pluginId, iframe);
  }

  /**
   * Clean up resources for a specific plugin
   */
  cleanupPlugin(pluginId: string): void {
    // Just clear the reference - let Angular manage the iframe DOM lifecycle
    // Removing iframe from DOM interferes with Angular's template management
    this._pluginIframes.delete(pluginId);
  }

  /**
   * Clean up all resources
   */
  cleanupAll(): void {
    // Just clear all references - let Angular manage iframe DOM lifecycle
    this._pluginIframes.clear();
  }
}

import { Injectable } from '@angular/core';
import { Hooks, PluginHookHandler } from '@super-productivity/plugin-api';
import { PluginLog } from '../core/log';

/**
 * Simplified plugin hooks service following KISS principles.
 * Each handler has a 5s timeout to prevent hung handlers from blocking others.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginHooksService {
  private static readonly HOOK_TIMEOUT_MS = 5000;
  private _handlers = new Map<Hooks, Map<string, PluginHookHandler<any>>>();

  /**
   * Register a hook handler
   */
  registerHookHandler<T extends Hooks>(
    pluginId: string,
    hook: T,
    handler: PluginHookHandler<T>,
  ): void {
    if (!this._handlers.has(hook)) {
      this._handlers.set(hook, new Map());
    }
    this._handlers.get(hook)!.set(pluginId, handler);
    PluginLog.log(`Plugin ${pluginId} registered for ${hook}`);
  }

  /**
   * Dispatch a hook to all registered handlers
   */
  async dispatchHook(hook: Hooks, payload?: unknown): Promise<void> {
    const handlers = this._handlers.get(hook);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const [pluginId, handler] of handlers) {
      let timeoutId: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          handler(payload),
          new Promise<void>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('Hook handler timed out')),
              PluginHooksService.HOOK_TIMEOUT_MS,
            );
          }),
        ]).finally(() => clearTimeout(timeoutId));
      } catch (error) {
        PluginLog.err(`Plugin ${pluginId} ${hook} handler error:`, error);
      }
    }
  }

  /**
   * Unregister all hooks for a plugin
   */
  unregisterPluginHooks(pluginId: string): void {
    for (const handlers of this._handlers.values()) {
      handlers.delete(pluginId);
    }
  }

  /**
   * Clear all hooks (for cleanup)
   */
  clearAllHooks(): void {
    this._handlers.clear();
  }
}

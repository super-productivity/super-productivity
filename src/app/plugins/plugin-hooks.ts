import { Injectable } from '@angular/core';
import { Hooks, PluginHookHandler } from '@super-productivity/plugin-api';
import { PluginLog } from '../core/log';

/**
 * Simplified plugin hooks service following KISS principles.
 * Each handler has a 5s timeout to prevent hung handlers from blocking others.
 *
 * A plugin may register multiple handlers for the same hook under one
 * pluginId — for example, doc-mode registers from both its background
 * script (host page) and its iframe editor. All registered handlers fire on
 * dispatch.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginHooksService {
  private static readonly HOOK_TIMEOUT_MS = 5000;
  private _handlers = new Map<Hooks, Map<string, Set<PluginHookHandler<any>>>>();

  /**
   * Register a hook handler.
   * Rejects pluginIds containing `:` so the persistence-key grammar
   * (`pluginId[:key]`) cannot be subverted via the hooks registry — the
   * differ collapses keyed entityIds to owner pluginIds for dispatch, and a
   * spoofed `victim:doc` registration would silently never fire.
   */
  registerHookHandler<T extends Hooks>(
    pluginId: string,
    hook: T,
    handler: PluginHookHandler<T>,
  ): void {
    if (pluginId.includes(':')) {
      throw new Error(
        `Plugin id "${pluginId}" must not contain ':' — the colon is reserved as the persistence-key delimiter.`,
      );
    }
    if (!this._handlers.has(hook)) {
      this._handlers.set(hook, new Map());
    }
    const perPlugin = this._handlers.get(hook)!;
    if (!perPlugin.has(pluginId)) {
      perPlugin.set(pluginId, new Set());
    }
    perPlugin.get(pluginId)!.add(handler);
    PluginLog.log(`Plugin ${pluginId} registered for ${hook}`);
  }

  /**
   * Dispatch a hook to all registered handlers (fan-out).
   * Use for events that potentially affect every plugin — task/project/language
   * changes. For per-plugin events (e.g. `PERSISTED_DATA_CHANGED`) use
   * {@link dispatchHookToPlugin} so only the owner's handler runs.
   */
  async dispatchHook(hook: Hooks, payload?: unknown): Promise<void> {
    const perPlugin = this._handlers.get(hook);
    if (!perPlugin || perPlugin.size === 0) {
      return;
    }
    for (const [pluginId, handlers] of perPlugin) {
      for (const handler of handlers) {
        await this._invokeWithTimeout(pluginId, hook, handler, payload);
      }
    }
  }

  /**
   * Dispatch a hook to a single plugin's handler(s) (scoped).
   * Counterpart to {@link dispatchHook} — use for per-owner events such as
   * `PERSISTED_DATA_CHANGED` where only the affected plugin should be notified.
   * Fires every handler the plugin registered for `hook` (a plugin with both
   * a background-script and an iframe handler runs both). No-op if `pluginId`
   * has no handler registered for `hook`.
   *
   * Callers are expected to invoke without awaiting (fire-and-forget). Each
   * call allocates one `Promise.race([handler, 5s timeout])` per handler (see
   * `HOOK_TIMEOUT_MS` above) — the closure is released within the timeout
   * window, so concurrent dispatches stay bounded by the number of in-flight
   * plugins.
   */
  async dispatchHookToPlugin<T extends Hooks>(
    pluginId: string,
    hook: T,
    payload?: unknown,
  ): Promise<void> {
    const handlers = this._handlers.get(hook)?.get(pluginId);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      await this._invokeWithTimeout(pluginId, hook, handler, payload);
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

  private async _invokeWithTimeout(
    pluginId: string,
    hook: Hooks,
    handler: PluginHookHandler<any>,
    payload?: unknown,
  ): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
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

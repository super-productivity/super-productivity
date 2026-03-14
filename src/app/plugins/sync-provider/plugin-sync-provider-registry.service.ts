import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { SyncProviderPluginDefinition } from '@super-productivity/plugin-api';

export interface RegisteredPluginSyncProvider {
  pluginId: string;
  registeredKey: string;
  definition: SyncProviderPluginDefinition;
  label: string;
  icon: string;
}

@Injectable({ providedIn: 'root' })
export class PluginSyncProviderRegistryService {
  private _providers = new Map<string, RegisteredPluginSyncProvider>();
  private _pluginIdToKey = new Map<string, string>();

  /** Emits on register/unregister so the UI can react */
  readonly providerChanged$ = new Subject<void>();

  register(pluginId: string, definition: SyncProviderPluginDefinition): void {
    const key = `plugin:${pluginId}`;
    if (this._providers.has(key)) {
      console.warn(
        `[PluginSyncProviderRegistry] Duplicate registration for '${key}', ignoring.`,
      );
      return;
    }
    this._providers.set(key, {
      pluginId,
      registeredKey: key,
      definition,
      label: definition.label || pluginId,
      icon: definition.icon || 'extension',
    });
    this._pluginIdToKey.set(pluginId, key);
    this.providerChanged$.next();
  }

  unregister(pluginId: string): void {
    const key = this._pluginIdToKey.get(pluginId);
    if (key) {
      this._providers.delete(key);
      this._pluginIdToKey.delete(pluginId);
      this.providerChanged$.next();
    }
  }

  getProvider(key: string): RegisteredPluginSyncProvider | undefined {
    return this._providers.get(key);
  }

  hasProvider(key: string): boolean {
    return this._providers.has(key);
  }

  getAvailableProviders(): RegisteredPluginSyncProvider[] {
    return Array.from(this._providers.values());
  }

  getRegisteredKey(pluginId: string): string | undefined {
    return this._pluginIdToKey.get(pluginId);
  }
}

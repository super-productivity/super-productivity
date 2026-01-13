import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  PluginUserData,
  MAX_PLUGIN_DATA_SIZE,
  MIN_PLUGIN_PERSIST_INTERVAL_MS,
} from './plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './store/plugin.actions';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';

/**
 * Service for persisting plugin user data using NgRx actions.
 * Handles data that plugins store and retrieve via persistDataSynced/loadSyncedData.
 * Includes rate limiting and size validation to prevent abuse.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginUserPersistenceService {
  private _store = inject(Store);

  /**
   * Track last persist time per plugin for rate limiting
   */
  private _lastPersistTime = new Map<string, number>();

  /**
   * Persist user data for a specific plugin (called by plugin via persistDataSynced)
   * @throws Error if data exceeds MAX_PLUGIN_DATA_SIZE
   * @throws Error if called too frequently (rate limited)
   */
  persistPluginUserData(pluginId: string, data: string): void {
    // Validate data size
    const dataSize = new Blob([data]).size;
    if (dataSize > MAX_PLUGIN_DATA_SIZE) {
      throw new Error(
        `Plugin data exceeds maximum size of ${MAX_PLUGIN_DATA_SIZE / 1024}KB. ` +
          `Current size: ${Math.round(dataSize / 1024)}KB`,
      );
    }

    // Rate limiting: check if enough time has passed since last persist
    const now = Date.now();
    const lastPersist = this._lastPersistTime.get(pluginId) || 0;
    const timeSinceLastPersist = now - lastPersist;

    if (timeSinceLastPersist < MIN_PLUGIN_PERSIST_INTERVAL_MS) {
      throw new Error(
        `Plugin data persist rate limited. Please wait ${MIN_PLUGIN_PERSIST_INTERVAL_MS}ms between calls. ` +
          `Time since last call: ${timeSinceLastPersist}ms`,
      );
    }

    // Update last persist time
    this._lastPersistTime.set(pluginId, now);

    const pluginUserData: PluginUserData = {
      id: pluginId,
      data,
    };
    this._store.dispatch(upsertPluginUserData({ pluginUserData }));
  }

  /**
   * Load user data for a specific plugin (called by plugin via loadSyncedData)
   */
  async loadPluginUserData(pluginId: string): Promise<string | null> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginUserDataFeatureState),
    );
    const pluginData = currentState.find((item) => item.id === pluginId);
    return pluginData?.data || null;
  }

  /**
   * Remove user data for a specific plugin
   */
  removePluginUserData(pluginId: string): void {
    this._store.dispatch(deletePluginUserData({ pluginId }));
  }

  /**
   * Get all plugin user data
   */
  async getAllPluginUserData(): Promise<PluginUserData[]> {
    return firstValueFrom(this._store.select(selectPluginUserDataFeatureState));
  }

  /**
   * Clear all plugin user data (removes each one individually to create operations)
   */
  async clearAllPluginUserData(): Promise<void> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginUserDataFeatureState),
    );
    for (const item of currentState) {
      this._store.dispatch(deletePluginUserData({ pluginId: item.id }));
    }
  }
}

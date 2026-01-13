import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PluginMetadata } from './plugin-persistence.model';
import { upsertPluginMetadata, deletePluginMetadata } from './store/plugin.actions';
import { selectPluginMetadataFeatureState } from './store/plugin-metadata.reducer';

/**
 * Service for persisting plugin metadata using NgRx actions.
 * Handles plugin management information like enabled state.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginMetaPersistenceService {
  private _store = inject(Store);

  /**
   * Set plugin enabled/disabled status
   */
  async setPluginEnabled(pluginId: string, isEnabled: boolean): Promise<void> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginMetadataFeatureState),
    );
    const existing = currentState.find((item) => item.id === pluginId);

    const pluginMetadata: PluginMetadata = existing
      ? { ...existing, isEnabled }
      : { id: pluginId, isEnabled };

    this._store.dispatch(upsertPluginMetadata({ pluginMetadata }));
  }

  /**
   * Check if plugin is enabled
   */
  async isPluginEnabled(pluginId: string): Promise<boolean> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginMetadataFeatureState),
    );
    const pluginMetadata = currentState.find((item) => item.id === pluginId);

    // Default to false for all plugins that haven't been explicitly enabled
    // This ensures plugins start disabled and must be manually enabled by the user
    return pluginMetadata?.isEnabled ?? false;
  }

  /**
   * Get all plugin metadata
   */
  async getAllPluginMetadata(): Promise<PluginMetadata[]> {
    return firstValueFrom(this._store.select(selectPluginMetadataFeatureState));
  }

  /**
   * Remove plugin metadata
   */
  removePluginMetadata(pluginId: string): void {
    this._store.dispatch(deletePluginMetadata({ pluginId }));
  }

  /**
   * Set Node.js execution consent for a plugin
   */
  async setNodeExecutionConsent(pluginId: string, hasConsent: boolean): Promise<void> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginMetadataFeatureState),
    );
    const existing = currentState.find((item) => item.id === pluginId);

    const pluginMetadata: PluginMetadata = existing
      ? { ...existing, nodeExecutionConsent: hasConsent }
      : { id: pluginId, isEnabled: false, nodeExecutionConsent: hasConsent };

    this._store.dispatch(upsertPluginMetadata({ pluginMetadata }));
  }

  /**
   * Get Node.js execution consent for a plugin
   */
  async getNodeExecutionConsent(pluginId: string): Promise<boolean | undefined> {
    const currentState = await firstValueFrom(
      this._store.select(selectPluginMetadataFeatureState),
    );
    const pluginMetadata = currentState.find((item) => item.id === pluginId);
    return pluginMetadata?.nodeExecutionConsent;
  }
}

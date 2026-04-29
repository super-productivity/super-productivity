import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { JSONSchema7 } from 'json-schema';
import { PluginManifest } from './plugin-api.model';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginCacheService } from './plugin-cache.service';
import { PluginLog } from '../core/log';
import { first } from 'rxjs/operators';

interface PluginConfigData {
  config: Record<string, unknown>;
  savedAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class PluginConfigService {
  private readonly _http = inject(HttpClient);
  private readonly _pluginUserPersistenceService = inject(PluginUserPersistenceService);
  private readonly _pluginCacheService = inject(PluginCacheService);

  /**
   * Load the JSON schema configuration file for a plugin
   */
  async loadPluginConfigSchema(
    manifest: PluginManifest,
    pluginPath: string,
  ): Promise<JSONSchema7> {
    if (!manifest.jsonSchemaCfg) {
      throw new Error('Plugin does not have a JSON schema configuration');
    }

    if (!pluginPath) {
      throw new Error(`Plugin path not provided for ${manifest.id}`);
    }

    // Build the URL to the config schema file
    let schemaUrl: string;
    if (pluginPath.startsWith('uploaded://')) {
      const pluginId = pluginPath.replace('uploaded://', '');
      const cached = await this._pluginCacheService.getPlugin(pluginId);
      if (!cached?.configSchema) {
        throw new Error(`No config schema found for uploaded plugin ${manifest.id}`);
      }
      const schema = JSON.parse(cached.configSchema) as JSONSchema7;
      if (!schema || typeof schema !== 'object') {
        throw new Error('Invalid JSON schema format');
      }
      return schema;
    } else {
      // For regular plugins, construct the URL
      schemaUrl = `${pluginPath}/${manifest.jsonSchemaCfg}`;
    }

    try {
      PluginLog.log(`Loading config schema from: ${schemaUrl}`);
      const schema = await this._http
        .get<JSONSchema7>(schemaUrl)
        .pipe(first())
        .toPromise();

      // Validate that it's a valid JSON schema
      if (!schema || typeof schema !== 'object') {
        throw new Error('Invalid JSON schema format');
      }

      return schema as JSONSchema7;
    } catch (error) {
      PluginLog.err(`Failed to load config schema for plugin ${manifest.id}:`, error);
      throw new Error(`Failed to load configuration schema: ${error}`);
    }
  }

  /**
   * Get the saved configuration for a plugin
   */
  async getPluginConfig(pluginId: string): Promise<Record<string, unknown> | null> {
    const configData =
      await this._pluginUserPersistenceService.loadPluginUserData(pluginId);

    if (!configData) {
      return null;
    }

    try {
      const parsed = JSON.parse(configData) as PluginConfigData;
      return parsed.config || null;
    } catch (error) {
      PluginLog.err(`Failed to parse config for plugin ${pluginId}:`, error);
      return null;
    }
  }

  /**
   * Save configuration for a plugin
   */
  async savePluginConfig(
    pluginId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const configData: PluginConfigData = {
      config,
      savedAt: Date.now(),
    };

    await this._pluginUserPersistenceService.persistPluginUserData(
      pluginId,
      JSON.stringify(configData),
    );

    PluginLog.log(`Saved config for plugin ${pluginId}`);
  }
}

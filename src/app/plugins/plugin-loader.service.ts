import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { first } from 'rxjs/operators';
import { PluginManifest } from './plugin-api.model';
import { PluginCacheService } from './plugin-cache.service';
// KISS: No size checks in loader - trust the browser's limits
import { validatePluginManifest } from './util/validate-manifest.util';
import { PluginLog } from '../core/log';

interface PluginAssets {
  manifest: PluginManifest;
  code: string;
  indexHtml?: string;
  icon?: string;
  translations?: Record<string, string>; // language code -> JSON string
}

/**
 * Simplified plugin loader following KISS principles.
 * Just load plugins - no complex state tracking or preloading.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginLoaderService {
  private readonly _http = inject(HttpClient);
  private readonly _cacheService = inject(PluginCacheService);

  /**
   * Load plugin assets - simple and direct
   */
  async loadPluginAssets(pluginPath: string): Promise<PluginAssets> {
    // Handle uploaded plugins differently
    if (pluginPath.startsWith('uploaded://')) {
      const pluginId = pluginPath.replace('uploaded://', '');
      return this.loadUploadedPluginAssets(pluginId);
    }

    try {
      // Load manifest
      const manifestUrl = `${pluginPath}/manifest.json`;
      const manifestText = await this._http
        .get(manifestUrl, { responseType: 'text' })
        .pipe(first())
        .toPromise();

      const manifest: PluginManifest = JSON.parse(manifestText);

      // Basic validation
      const validation = validatePluginManifest(manifest);
      if (!validation.isValid) {
        throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
      }

      // Log validation warnings
      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) => {
          PluginLog.warn(`[PluginLoader] ${manifest.id}: ${warning}`);
        });
      }

      // Load plugin code
      const codeUrl = `${pluginPath}/plugin.js`;
      const code = await this._http
        .get(codeUrl, { responseType: 'text' })
        .pipe(first())
        .toPromise();

      // Load optional assets
      let indexHtml: string | undefined;
      let icon: string | undefined;

      if (manifest.iFrame) {
        try {
          const htmlUrl = `${pluginPath}/index.html`;
          indexHtml = await this._http
            .get(htmlUrl, { responseType: 'text' })
            .pipe(first())
            .toPromise();
        } catch (e) {
          PluginLog.err(`No index.html for plugin ${manifest.id}`);
        }
      }

      if (manifest.icon) {
        try {
          const iconUrl = `${pluginPath}/${manifest.icon}`;
          icon = await this._http
            .get(iconUrl, { responseType: 'text' })
            .pipe(first())
            .toPromise();
        } catch (e) {
          PluginLog.err(`No icon for plugin ${manifest.id}`);
        }
      }

      // Load translation files if i18n is configured
      let translations: Record<string, string> | undefined;
      if (manifest.i18n?.languages && manifest.i18n.languages.length > 0) {
        translations = {};
        for (const lang of manifest.i18n.languages) {
          try {
            const translationUrl = `${pluginPath}/i18n/${lang}.json`;
            const translationContent = await this._http
              .get(translationUrl, { responseType: 'text' })
              .pipe(first())
              .toPromise();

            if (translationContent) {
              translations[lang] = translationContent;
              PluginLog.log(
                `[PluginLoader] Loaded ${lang} translations for ${manifest.id}`,
              );
            }
          } catch (e) {
            PluginLog.err(
              `[PluginLoader] Failed to load ${lang} translations for ${manifest.id}:`,
              e,
            );
          }
        }
      }

      return { manifest, code, indexHtml, icon, translations };
    } catch (error) {
      PluginLog.err(`Failed to load plugin from ${pluginPath}:`, error);
      throw error;
    }
  }

  /**
   * Load uploaded plugin assets from cache
   */
  async loadUploadedPluginAssets(pluginId: string): Promise<PluginAssets> {
    const cached = await this._cacheService.getPlugin(pluginId);
    if (!cached) {
      throw new Error(`Plugin ${pluginId} not found in cache`);
    }

    const manifest: PluginManifest = JSON.parse(cached.manifest);
    return {
      manifest,
      code: cached.code,
      indexHtml: cached.indexHtml,
      icon: cached.icon,
      translations: cached.translations,
    };
  }

  /**
   * Clear all caches - KISS: just delegate to cache service
   */
  async clearAllCaches(): Promise<void> {
    await this._cacheService.clearCache();
  }
}

import { Injectable } from '@angular/core';
import { PluginLog } from '../core/log';

export interface CachedPlugin {
  id: string;
  manifest: string;
  code: string;
  indexHtml?: string;
  icon?: string;
  translations?: Record<string, string>; // language code -> JSON string
  uploadDate: number;
}

/**
 * Simplified plugin cache service following KISS principles.
 * Just store and retrieve plugins - no compression, no complex cleanup.
 */
@Injectable({
  providedIn: 'root',
})
export class PluginCacheService {
  private readonly DB_NAME = 'SUPPluginCache';
  private readonly STORE_NAME = 'plugins';
  private _db: IDBDatabase | null = null;

  private async _getDB(): Promise<IDBDatabase> {
    if (this._db) {
      return this._db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Store a plugin in the cache - simple and direct
   */
  async storePlugin(
    pluginId: string,
    manifest: string,
    code: string,
    indexHtml?: string,
    icon?: string,
    translations?: Record<string, string>,
  ): Promise<void> {
    // Log plugin data sizes for debugging
    const translationsSize = translations
      ? Object.values(translations).reduce((sum, content) => {
          const sizeKB = new Blob([content]).size / 1024;
          return sum + sizeKB;
        }, 0)
      : 0;

    const sizes = {
      manifest: new Blob([manifest]).size / 1024,
      code: new Blob([code]).size / 1024,
      indexHtml: indexHtml ? new Blob([indexHtml]).size / 1024 : 0,
      icon: icon ? new Blob([icon]).size / 1024 : 0,
      translations: translationsSize,
    };
    const totalSizeKB = Object.values(sizes).reduce((sum, size) => sum + size, 0);

    PluginLog.log(`[PluginCache] Storing plugin "${pluginId}":`);
    PluginLog.log(`[PluginCache] - Manifest: ${sizes.manifest.toFixed(2)}KB`);
    PluginLog.log(`[PluginCache] - Code: ${sizes.code.toFixed(2)}KB`);
    if (indexHtml)
      PluginLog.log(`[PluginCache] - IndexHtml: ${sizes.indexHtml.toFixed(2)}KB`);
    if (icon) PluginLog.log(`[PluginCache] - Icon: ${sizes.icon.toFixed(2)}KB`);
    if (translations)
      PluginLog.log(`[PluginCache] - Translations: ${sizes.translations.toFixed(2)}KB`);
    PluginLog.log(
      `[PluginCache] - Total size: ${totalSizeKB.toFixed(2)}KB (${(totalSizeKB / 1024).toFixed(2)}MB)`,
    );

    if (totalSizeKB > 1024) {
      // Warn if plugin is larger than 1MB
      PluginLog.err(
        `[PluginCache] Large plugin detected: "${pluginId}" is ${(totalSizeKB / 1024).toFixed(2)}MB`,
      );
    }

    const db = await this._getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    const plugin: CachedPlugin = {
      id: pluginId,
      manifest,
      code,
      indexHtml,
      icon,
      translations,
      uploadDate: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const request = store.put(plugin);
      request.onsuccess = () => {
        PluginLog.log(`[PluginCache] Successfully stored plugin "${pluginId}"`);
        resolve();
      };
      request.onerror = () => {
        PluginLog.err(
          `[PluginCache] Failed to store plugin "${pluginId}":`,
          request.error,
        );
        reject(new Error(`Failed to store plugin ${pluginId}`));
      };
    });
  }

  /**
   * Get a plugin from the cache
   */
  async getPlugin(pluginId: string): Promise<CachedPlugin | null> {
    PluginLog.log(`[PluginCache] Loading plugin "${pluginId}"`);
    const db = await this._getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(pluginId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get plugin ${pluginId}`));
    });
  }

  /**
   * Remove a plugin from the cache
   */
  async removePlugin(pluginId: string): Promise<void> {
    const db = await this._getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete(pluginId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to remove plugin ${pluginId}`));
    });
  }

  /**
   * Get all cached plugins
   */
  async getAllPlugins(): Promise<CachedPlugin[]> {
    PluginLog.log('[PluginCache] Loading all plugins from cache');
    const db = await this._getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readonly');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as CachedPlugin[]);
      request.onerror = () => reject(new Error('Failed to get all plugins'));
    });
  }

  /**
   * Clear all plugins
   */
  async clearCache(): Promise<void> {
    const db = await this._getDB();
    const transaction = db.transaction([this.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(this.STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear cache'));
    });
  }
}

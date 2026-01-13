import { inject, Injectable } from '@angular/core';
import { SyncProviderId } from './provider.const';
import { SyncProviderServiceInterface, OperationSyncCapable } from './provider.interface';
import { FileBasedSyncAdapterService } from './file-based/file-based-sync-adapter.service';
import { SyncProviderManager } from './provider-manager.service';
import { isOperationSyncCapable, isFileBasedProvider } from '../sync/operation-sync.util';
import { OpLog } from '../../core/log';

/**
 * Service that provides OperationSyncCapable versions of sync providers.
 *
 * ## Purpose
 * This service bridges the gap between raw file-based providers (Dropbox, WebDAV, LocalFile)
 * and the operation-log sync system which requires `OperationSyncCapable` providers.
 *
 * ## Provider Types
 * - **SuperSync**: Already implements `OperationSyncCapable` directly, returned as-is
 * - **File-based**: Wrapped with `FileBasedSyncAdapterService` to add operation sync capability
 *
 * ## Caching
 * Wrapped adapters are cached per provider ID to avoid recreating them on every sync.
 * Call `clearCache()` when encryption settings change to force adapter recreation.
 *
 * @example
 * ```typescript
 * const wrappedProvider = inject(WrappedProviderService);
 * const provider = providerManager.getActiveProvider();
 *
 * const syncCapable = await wrappedProvider.getOperationSyncCapable(provider);
 * if (syncCapable) {
 *   await syncService.uploadPendingOps(syncCapable);
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class WrappedProviderService {
  private _fileBasedAdapter = inject(FileBasedSyncAdapterService);
  private _providerManager = inject(SyncProviderManager);

  /** Cache of wrapped adapters per provider ID */
  private _cache = new Map<string, OperationSyncCapable>();

  /**
   * Gets an OperationSyncCapable version of the provider.
   *
   * @param provider - The raw sync provider
   * @returns OperationSyncCapable provider, or null if provider doesn't support sync
   */
  async getOperationSyncCapable(
    provider: SyncProviderServiceInterface<SyncProviderId> | null,
  ): Promise<OperationSyncCapable | null> {
    if (!provider) {
      return null;
    }

    // SuperSync already implements OperationSyncCapable
    if (isOperationSyncCapable(provider)) {
      return provider;
    }

    // File-based providers need wrapping
    if (isFileBasedProvider(provider)) {
      return this._getOrCreateAdapter(provider);
    }

    // Unknown provider type
    OpLog.warn(`WrappedProviderService: Unknown provider type: ${provider.id}`);
    return null;
  }

  /**
   * Gets or creates a wrapped adapter for a file-based provider.
   */
  private async _getOrCreateAdapter(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<OperationSyncCapable> {
    const cached = this._cache.get(provider.id);
    if (cached) {
      return cached;
    }

    OpLog.normal(`WrappedProviderService: Creating adapter for ${provider.id}`);

    const cfg = this._providerManager.getEncryptAndCompressCfg();
    const privateCfg = await provider.privateCfg.load();
    const encryptKey = privateCfg?.encryptKey;

    const adapter = this._fileBasedAdapter.createAdapter(provider, cfg, encryptKey);
    this._cache.set(provider.id, adapter);
    return adapter;
  }

  /**
   * Clears the adapter cache.
   * Call this when encryption settings change to force adapter recreation.
   */
  clearCache(): void {
    this._cache.clear();
    OpLog.normal('WrappedProviderService: Cache cleared');
  }
}

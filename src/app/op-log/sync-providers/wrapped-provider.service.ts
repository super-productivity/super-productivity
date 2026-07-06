import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SyncProviderId } from './provider.const';
import {
  SyncProviderBase,
  FileSyncProvider,
  OperationSyncCapable,
} from './provider.interface';
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
  private _destroyRef = inject(DestroyRef);

  /** Cache of wrapped adapters per provider ID */
  private _cache = new Map<string, OperationSyncCapable>();

  constructor() {
    // Auto-invalidate cache when provider config changes
    this._providerManager.providerConfigChanged$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => {
        this._cache.clear();
        OpLog.normal(
          'WrappedProviderService: Cache auto-invalidated due to config change',
        );
      });
  }

  /**
   * Gets an OperationSyncCapable version of the provider.
   *
   * @param provider - The raw sync provider
   * @returns OperationSyncCapable provider, or null if provider doesn't support sync
   */
  async getOperationSyncCapable(
    provider: SyncProviderBase<SyncProviderId> | null,
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
      return this._getOrCreateAdapter(provider as FileSyncProvider<SyncProviderId>);
    }

    // Unknown provider type
    OpLog.warn(`WrappedProviderService: Unknown provider type: ${provider.id}`);
    return null;
  }

  /**
   * Gets or creates a wrapped adapter for a file-based provider.
   */
  private async _getOrCreateAdapter(
    provider: FileSyncProvider<SyncProviderId>,
  ): Promise<OperationSyncCapable> {
    const cached = this._cache.get(provider.id);
    if (cached) {
      return cached;
    }

    OpLog.normal(`WrappedProviderService: Creating adapter for ${provider.id}`);

    const baseCfg = this._providerManager.getEncryptAndCompressCfg();
    const privateCfg = await provider.privateCfg.load();
    const encryptKey = privateCfg?.encryptKey;
    const storedIntent = privateCfg?.isEncryptionEnabled;

    // Encryption intent for file-based providers (GHSA-9544-hjjr-fg8h) comes from
    // the PER-PROVIDER `isEncryptionEnabled` persisted in privateCfg — NOT the
    // global `sync.isEncryptionEnabled` in baseCfg, which is shared across
    // providers and re-derived from key presence in the settings form, so it is
    // stale after a provider switch and can be flipped off by an unrelated save.
    // privateCfg is per-provider, written atomically with the key, and survives
    // a silent key drop (the dropped-credential failure this fix targets).
    //   - intent ON + no key → isEncrypt stays true WITHOUT a key, so the adapter
    //     refuses to upload plaintext instead of leaking (upload-path guard +
    //     EncryptNoPasswordError chokepoint).
    //   - pre-fix configs have no stored intent → fall back to key presence, which
    //     is the exact old behaviour (no regression) and captures existing users
    //     while their key is still present.
    const isEncrypt = storedIntent ?? !!encryptKey;

    // Migration: record the intent for pre-fix configs while the key still proves
    // it, so a later silent key drop becomes detectable. Fire-and-forget — the
    // adapter below already uses the correct `isEncrypt`; only future loads
    // benefit. Runs at most once per provider (skips once an explicit value
    // exists). Self-contained so it re-reads fresh before writing.
    if (storedIntent === undefined && !!encryptKey) {
      void this._backfillEncryptionIntent(provider);
    }

    const cfg = {
      ...baseCfg,
      isEncrypt,
    };

    const adapter = this._fileBasedAdapter.createAdapter(provider, cfg, encryptKey);
    this._cache.set(provider.id, adapter);
    return adapter;
  }

  /**
   * One-time migration write of the per-provider encryption-intent flag for
   * pre-fix configs (GHSA-9544-hjjr-fg8h). Re-loads the config immediately before
   * writing and re-checks on that FRESH state, then merges the flag onto it — so a
   * concurrent privateCfg mutation that landed since the caller's load (an
   * explicit disable-encryption that cleared the key, or an OAuth token rotation)
   * is neither clobbered nor overridden: we skip if the key is gone or an explicit
   * intent already exists, and preserve every other field at its freshest value.
   */
  private async _backfillEncryptionIntent(
    provider: FileSyncProvider<SyncProviderId>,
  ): Promise<void> {
    try {
      const fresh = await provider.privateCfg.load();
      if (!fresh || fresh.isEncryptionEnabled !== undefined || !fresh.encryptKey) {
        return;
      }
      await this._providerManager.setProviderConfig(provider.id, {
        ...fresh,
        isEncryptionEnabled: true,
      });
    } catch (e) {
      OpLog.warn('WrappedProviderService: encryption-intent backfill failed', e);
    }
  }

  /**
   * Clears the adapter cache.
   * @deprecated Cache is now auto-invalidated when provider config changes via SyncProviderManager.
   * Kept as an escape hatch for edge cases.
   */
  clearCache(): void {
    this._cache.clear();
    OpLog.normal('WrappedProviderService: Cache cleared');
  }
}

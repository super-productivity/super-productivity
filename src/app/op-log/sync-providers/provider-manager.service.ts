import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { selectSyncConfig } from '../../features/config/store/global-config.reducer';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncLog } from '../../core/log';
import { SyncProviderId, toSyncProviderId } from './provider.const';
import { SyncProviderBase } from './provider.interface';
import {
  EncryptAndCompressCfg,
  PrivateCfgByProviderId,
  CurrentProviderPrivateCfg,
} from '../core/types/sync.types';
import { loadSyncProviders } from './sync-providers.factory';

/**
 * Sync status change payload type
 */
export type SyncStatusChangePayload =
  | 'UNKNOWN_OR_CHANGED'
  | 'ERROR'
  | 'IN_SYNC'
  | 'SYNCING';

/**
 * Service for managing sync providers.
 *
 * Providers are lazily loaded on first use to reduce initial bundle size.
 */
@Injectable({
  providedIn: 'root',
})
export class SyncProviderManager {
  private _dataInitStateService = inject(DataInitStateService);
  private _store = inject(Store);

  // Lazily loaded providers (cached after first load)
  private _providers: SyncProviderBase<SyncProviderId>[] | null = null;

  /** Counter to detect stale provider activations */
  private _activeProviderSetupId = 0;

  // Current active provider
  private _activeProvider: SyncProviderBase<SyncProviderId> | null = null;
  private _activeProviderId$ = new BehaviorSubject<SyncProviderId | null>(null);

  // Encryption/compression config
  private _encryptAndCompressCfg: EncryptAndCompressCfg = {
    isEncrypt: false,
    isCompress: false,
  };

  // Provider readiness state
  private _isProviderReady$ = new BehaviorSubject<boolean>(false);

  // Sync status state
  private _syncStatus$ = new BehaviorSubject<SyncStatusChangePayload>(
    'UNKNOWN_OR_CHANGED',
  );

  // Current provider's private config
  private _currentProviderPrivateCfg$ =
    new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);

  // Emits whenever provider config is updated via setProviderConfig()
  private _providerConfigChanged$ = new Subject<void>();

  /**
   * Observable for whether the sync provider is enabled and ready
   */
  public readonly isProviderReady$: Observable<boolean> = this._isProviderReady$.pipe(
    distinctUntilChanged(),
    shareReplay(1),
  );

  /**
   * Observable for the active provider ID
   */
  public readonly activeProviderId$: Observable<SyncProviderId | null> =
    this._activeProviderId$.pipe(distinctUntilChanged(), shareReplay(1));

  /**
   * Observable for sync status
   */
  public readonly syncStatus$: Observable<SyncStatusChangePayload> =
    this._syncStatus$.pipe(shareReplay(1));

  /**
   * Observable for whether sync is in progress
   */
  public readonly isSyncInProgress$: Observable<boolean> = this.syncStatus$.pipe(
    filter((state) => state !== 'UNKNOWN_OR_CHANGED'),
    map((state) => state === 'SYNCING'),
    startWith(false),
    distinctUntilChanged(),
    shareReplay(1),
  );

  /**
   * Observable for current provider's private config
   */
  public readonly currentProviderPrivateCfg$: Observable<CurrentProviderPrivateCfg | null> =
    this._currentProviderPrivateCfg$.pipe(shareReplay(1));

  /**
   * Emits whenever provider config is updated via setProviderConfig().
   * Used by WrappedProviderService to auto-invalidate its adapter cache.
   */
  public readonly providerConfigChanged$: Observable<void> =
    this._providerConfigChanged$.asObservable();

  /**
   * Config observable from store (after data init)
   */
  private readonly _syncConfig$ =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._store.select(selectSyncConfig)),
    );

  constructor() {
    // Listen to sync config changes and update active provider
    this._syncConfig$.subscribe((cfg) => {
      try {
        const newProviderId = cfg.isEnabled ? toSyncProviderId(cfg.syncProvider) : null;

        this._setActiveProvider(newProviderId);

        if (cfg.isEnabled) {
          this._encryptAndCompressCfg = {
            isEncrypt: !!cfg.isEncryptionEnabled,
            isCompress: !!cfg.isCompressionEnabled,
          };
        }
      } catch (e) {
        SyncLog.err('SyncProviderManager: Failed to set sync provider:', e);
      }
    });

    SyncLog.normal('SyncProviderManager: Initialized');
  }

  /**
   * Ensures providers are loaded. Returns cached providers if already loaded.
   * Deduplication of concurrent calls is handled by `loadSyncProviders()`.
   */
  private async _ensureProviders(): Promise<SyncProviderBase<SyncProviderId>[]> {
    if (this._providers) {
      return this._providers;
    }
    this._providers = await loadSyncProviders();
    return this._providers;
  }

  /**
   * Gets the currently active sync provider.
   * Note: May return null during initial lazy-load of provider modules.
   * Callers should gate on `isProviderReady$` before using the returned provider.
   */
  getActiveProvider(): SyncProviderBase<SyncProviderId> | null {
    return this._activeProvider;
  }

  /**
   * Gets a sync provider by ID
   */
  async getProviderById(
    providerId: SyncProviderId,
  ): Promise<SyncProviderBase<SyncProviderId> | undefined> {
    const providers = await this._ensureProviders();
    return providers.find((p) => p.id === providerId);
  }

  /**
   * Gets all available sync providers
   */
  async getAllProviders(): Promise<SyncProviderBase<SyncProviderId>[]> {
    const providers = await this._ensureProviders();
    return [...providers];
  }

  /**
   * Gets the current encryption/compression configuration
   */
  getEncryptAndCompressCfg(): EncryptAndCompressCfg {
    return this._encryptAndCompressCfg;
  }

  /**
   * Updates the sync status
   */
  setSyncStatus(status: SyncStatusChangePayload): void {
    this._syncStatus$.next(status);
  }

  /**
   * Gets the current sync status value
   */
  get isSyncInProgress(): boolean {
    const currentStatus = this._syncStatus$.getValue();
    return currentStatus === 'SYNCING';
  }

  /**
   * Gets the private configuration for a provider
   */
  async getProviderConfig<PID extends SyncProviderId>(
    providerId: PID,
  ): Promise<PrivateCfgByProviderId<PID> | null> {
    const provider = await this.getProviderById(providerId);
    if (!provider) {
      return null;
    }
    return provider.privateCfg.load() as Promise<PrivateCfgByProviderId<PID> | null>;
  }

  /**
   * Sets the private configuration for a provider
   */
  async setProviderConfig<PID extends SyncProviderId>(
    providerId: PID,
    config: PrivateCfgByProviderId<PID>,
  ): Promise<void> {
    const provider = await this.getProviderById(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    // Use setPrivateCfg() instead of privateCfg.setComplete() to ensure
    // provider-specific caches (like lastServerSeq key) are invalidated.
    // This is critical for server migration detection when switching users.
    await provider.setPrivateCfg(config);

    // Notify subscribers (e.g., WrappedProviderService) that config changed
    this._providerConfigChanged$.next();

    // If this is the active provider, update the current config observable
    if (this._activeProvider?.id === providerId) {
      this._currentProviderPrivateCfg$.next({
        providerId,
        privateCfg: config,
      });
      // Re-check readiness
      const ready = await provider.isReady();
      this._isProviderReady$.next(ready);
    }
  }

  /**
   * Clears authentication credentials for a provider while preserving non-auth config.
   * Updates readiness state and config observable after clearing.
   */
  async clearAuthCredentials(providerId: SyncProviderId): Promise<void> {
    const provider = await this.getProviderById(providerId);
    if (!provider?.clearAuthCredentials) {
      return;
    }
    await provider.clearAuthCredentials();

    if (this._activeProvider?.id === providerId) {
      const ready = await provider.isReady();
      this._isProviderReady$.next(ready);

      const privateCfg = await provider.privateCfg.load();
      this._currentProviderPrivateCfg$.next({ providerId, privateCfg });
    }
  }

  private readonly _LAST_SYNCED_PROVIDER_KEY = 'SP_LAST_SYNCED_PROVIDER_ID';

  getLastSyncedProviderId(): SyncProviderId | null {
    return toSyncProviderId(localStorage.getItem(this._LAST_SYNCED_PROVIDER_KEY));
  }

  setLastSyncedProviderId(id: SyncProviderId): void {
    localStorage.setItem(this._LAST_SYNCED_PROVIDER_KEY, id);
  }

  /**
   * Sets the active sync provider (loads providers lazily on first call)
   */
  private _setActiveProvider(providerId: SyncProviderId | null): void {
    // Skip if provider hasn't changed to avoid resetting state on unrelated config changes
    if (providerId === this._activeProviderId$.getValue()) {
      return;
    }

    const setupId = ++this._activeProviderSetupId;
    this._activeProviderId$.next(providerId);

    if (!providerId) {
      this._activeProvider = null;
      this._isProviderReady$.next(false);
      this._currentProviderPrivateCfg$.next(null);
      return;
    }

    // Clear stale config from previous provider during async load
    this._currentProviderPrivateCfg$.next(null);

    this.getProviderById(providerId)
      .then(async (provider) => {
        if (this._activeProviderSetupId !== setupId) {
          return;
        }
        if (!provider) {
          SyncLog.err(`SyncProviderManager: Provider not found: ${providerId}`);
          return;
        }
        this._activeProvider = provider;

        const [ready, privateCfg] = await Promise.all([
          provider.isReady(),
          provider.privateCfg.load(),
        ]);

        if (this._activeProviderSetupId !== setupId) {
          return;
        }
        this._isProviderReady$.next(ready);
        this._currentProviderPrivateCfg$.next({ providerId, privateCfg });
        SyncLog.normal(`SyncProviderManager: Active provider set to ${providerId}`);
      })
      .catch((e) => {
        SyncLog.err(`SyncProviderManager: Failed to load provider ${providerId}:`, e);
        if (this._activeProviderSetupId === setupId) {
          this._isProviderReady$.next(false);
        }
      });
  }
}

import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
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
import { PFLog } from '../../core/log';
import { SyncProviderId, toSyncProviderId } from './provider.const';
import { SyncProviderServiceInterface } from './provider.interface';
import {
  EncryptAndCompressCfg,
  PrivateCfgByProviderId,
  CurrentProviderPrivateCfg,
} from '../core/types/sync.types';
import { environment } from '../../../environments/environment';

// Import providers
import { Dropbox } from './file-based/dropbox/dropbox';
import { Webdav } from './file-based/webdav/webdav';
import { SuperSyncProvider } from './super-sync/super-sync';
import { LocalFileSyncElectron } from './file-based/local-file/local-file-sync-electron';
import { LocalFileSyncAndroid } from './file-based/local-file/local-file-sync-android';
import { DROPBOX_APP_KEY } from '../../imex/sync/dropbox/dropbox.const';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';

/**
 * Sync status change payload type
 */
export type SyncStatusChangePayload =
  | 'UNKNOWN_OR_CHANGED'
  | 'ERROR'
  | 'IN_SYNC'
  | 'SYNCING';

/**
 * Array of all available sync providers
 * Cast to generic SyncProviderServiceInterface - each provider implements
 * a specific SyncProviderId but we store them in a generic array.
 */
const SYNC_PROVIDERS: SyncProviderServiceInterface<SyncProviderId>[] = [
  new Dropbox({
    appKey: DROPBOX_APP_KEY,
    basePath: environment.production ? `/` : `/DEV/`,
  }) as SyncProviderServiceInterface<SyncProviderId>,
  new Webdav(
    environment.production ? undefined : `/DEV`,
  ) as SyncProviderServiceInterface<SyncProviderId>,
  new SuperSyncProvider(
    environment.production ? undefined : `/DEV`,
  ) as SyncProviderServiceInterface<SyncProviderId>,
  ...(IS_ELECTRON
    ? [new LocalFileSyncElectron() as SyncProviderServiceInterface<SyncProviderId>]
    : []),
  ...(IS_ANDROID_WEB_VIEW
    ? [new LocalFileSyncAndroid() as SyncProviderServiceInterface<SyncProviderId>]
    : []),
];

/**
 * Service for managing sync providers.
 *
 * This service replaces the provider management parts of PfapiService.
 * It handles:
 * - Active provider selection based on user config
 * - Provider readiness state
 * - Encryption/compression configuration
 * - Provider credential management
 *
 * ## Usage
 * ```typescript
 * const manager = inject(SyncProviderManager);
 *
 * // Get active provider
 * const provider = manager.getActiveProvider();
 *
 * // Subscribe to provider readiness
 * manager.isProviderReady$.subscribe(ready => ...);
 *
 * // Get provider by ID
 * const dropbox = manager.getProviderById(SyncProviderId.Dropbox);
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class SyncProviderManager {
  private _dataInitStateService = inject(DataInitStateService);
  private _store = inject(Store);

  // Current active provider
  private _activeProvider: SyncProviderServiceInterface<SyncProviderId> | null = null;
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
        PFLog.err('SyncProviderManager: Failed to set sync provider:', e);
      }
    });

    PFLog.normal('SyncProviderManager: Initialized');
  }

  /**
   * Gets the currently active sync provider
   */
  getActiveProvider(): SyncProviderServiceInterface<SyncProviderId> | null {
    return this._activeProvider;
  }

  /**
   * Gets a sync provider by ID
   */
  getProviderById(
    providerId: SyncProviderId,
  ): SyncProviderServiceInterface<SyncProviderId> | undefined {
    return SYNC_PROVIDERS.find((p) => p.id === providerId);
  }

  /**
   * Gets all available sync providers
   */
  getAllProviders(): SyncProviderServiceInterface<SyncProviderId>[] {
    return [...SYNC_PROVIDERS];
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
    const provider = this.getProviderById(providerId);
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
    const provider = this.getProviderById(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    // Use setPrivateCfg() instead of privateCfg.setComplete() to ensure
    // provider-specific caches (like lastServerSeq key) are invalidated.
    // This is critical for server migration detection when switching users.
    await provider.setPrivateCfg(config);

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
   * Sets the active sync provider
   */
  private _setActiveProvider(providerId: SyncProviderId | null): void {
    this._activeProviderId$.next(providerId);

    if (!providerId) {
      this._activeProvider = null;
      this._isProviderReady$.next(false);
      this._currentProviderPrivateCfg$.next(null);
      return;
    }

    const provider = SYNC_PROVIDERS.find((p) => p.id === providerId);
    if (provider) {
      this._activeProvider = provider;
      provider.isReady().then((ready) => this._isProviderReady$.next(ready));

      // Emit provider config to observable
      provider.privateCfg.load().then((privateCfg) => {
        this._currentProviderPrivateCfg$.next({
          providerId,
          privateCfg,
        });
      });

      PFLog.normal(`SyncProviderManager: Active provider set to ${providerId}`);
    } else {
      PFLog.err(`SyncProviderManager: Provider not found: ${providerId}`);
    }
  }
}

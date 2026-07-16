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
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { SyncProviderId, toSyncProviderId } from './provider.const';
import { SyncProviderBase } from './provider.interface';
import {
  EncryptAndCompressCfg,
  PrivateCfgByProviderId,
  CurrentProviderPrivateCfg,
} from '../core/types/sync.types';
import { loadSyncProviders } from './sync-providers.factory';
import { isSyncTargetChanged } from './sync-target-identity.util';

/**
 * Sync status change payload type
 */
export type SyncStatusChangePayload =
  | 'UNKNOWN_OR_CHANGED'
  | 'ERROR'
  | 'IN_SYNC'
  | 'SYNCING';

/** Payload of `providerConfigChanged$`. See that observable for the semantics. */
export interface ProviderConfigChange {
  /** True only when the write moved the sync target (see `isSyncTargetChanged`). */
  isTargetChanged: boolean;
}

// Module-level reference so static sync-form handlers can signal a target
// change without an injector (mirrors the encryption-dialog-opener pattern).
let providerManagerInstance: SyncProviderManager | null = null;

const setProviderManagerInstance = (instance: SyncProviderManager): void => {
  providerManagerInstance = instance;
};

/**
 * Signal that the active file-provider target changed through an ingress that
 * bypasses `setProviderConfig()` — the Electron LocalFile folder picker (which
 * persists the folder main-side, post-#8228) and Android `setupSaf()` (which
 * writes `safFolderUri` straight to the credential store). Both mutate the
 * target without firing `providerTargetChanged$`, so the file adapter would keep
 * the previous folder's revs/clocks/caches keyed by the (unchanged) `LocalFile`
 * provider id. Both ingresses are unambiguous target moves (the user picked a
 * different folder), so this asserts a target change directly rather than
 * inferring one from a config diff. It no-ops if the manager was never
 * instantiated — nothing is cached to leak.
 * (Task 2, docs/plans/2026-07-13-sync-simplification-plan.md.)
 */
export const notifyFileProviderTargetChanged = (): void => {
  providerManagerInstance?.notifyProviderTargetChanged();
};

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
  private _snackService = inject(SnackService);

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
  private _providerConfigChanged$ = new Subject<ProviderConfigChange>();
  private _hasShownLocalFileReselectSnack = false;

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
   * Emits on EVERY provider-config write, carrying whether that write moved the
   * sync TARGET — an account switch behind the same provider id, or a folder/URL
   * change — as opposed to a content-only edit. Both ride ONE emission so a
   * caller cannot raise a move without the cache drop, which would leave a stale
   * encryption key cached against fresh target state.
   * See `isSyncTargetChanged` and `FileBasedSyncAdapterService.invalidateAllTargets`.
   *
   * `isTargetChanged` is scoped to ONE provider's config and says nothing about
   * which provider is ACTIVE — the two axes have separate detectors. A provider
   * SWITCH is handled by `SyncWrapperService`'s `getLastSyncedProviderId()` check
   * → `forceFromSeq0`, so switching to an already-configured provider correctly
   * emits `isTargetChanged: false`: its provider-id-keyed state still describes
   * its own unchanged remote.
   */
  public readonly providerConfigChanged$: Observable<ProviderConfigChange> =
    this._providerConfigChanged$.asObservable();

  /**
   * Config observable from store (after data init)
   */
  private readonly _syncConfig$ =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._store.select(selectSyncConfig)),
    );

  constructor() {
    // Self-register so the module-level notifyFileProviderTargetChanged() can
    // reach this singleton from static form config handlers.
    setProviderManagerInstance(this);

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
    // Read the previous config BEFORE the write so an identity-affecting change
    // (account/folder/URL) can be told apart from a content-only one. Callers
    // save the whole privateCfg on every settings-dialog Save — including saves
    // that only touched a global setting — so "config was written" is far weaker
    // than "the target moved". See providerTargetChanged$.
    const prevCfg = await provider.privateCfg.load();

    // Use setPrivateCfg() instead of privateCfg.setComplete() to ensure
    // provider-specific caches (like lastServerSeq key) are invalidated.
    // This is critical for server migration detection when switching users.
    await provider.setPrivateCfg(config);

    // Notify subscribers (e.g., WrappedProviderService) that config changed
    this._providerConfigChanged$.next({
      isTargetChanged: isSyncTargetChanged(prevCfg, config),
    });

    // If this is the active provider, update the current config observable
    if (this._activeProvider?.id === providerId) {
      this._currentProviderPrivateCfg$.next({
        providerId,
        privateCfg: config,
      });
      // Re-check readiness
      const ready = await provider.isReady();
      this._isProviderReady$.next(ready);
      this._maybeShowLocalFileReselectSnack(providerId, ready, config);
    }
  }

  /**
   * Asserts a target change for a write that bypassed `setProviderConfig()`, so
   * no config diff is available to infer it from. Three such ingresses exist: the
   * Electron LocalFile folder picker, Android `setupSaf()`, and the OneDrive
   * pre-auth cfg write in `dialog-sync-cfg.component`. Callers that fire on every
   * save (OneDrive) MUST gate this on `isSyncTargetChanged` — an unconditional
   * notify reintroduces the cursor wipe this signal exists to avoid.
   *
   * Kept minimal on purpose: it does not reload provider config (the caller
   * already persisted the new target). See `notifyFileProviderTargetChanged()`.
   */
  notifyProviderTargetChanged(): void {
    this._providerConfigChanged$.next({ isTargetChanged: true });
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
        this._maybeShowLocalFileReselectSnack(providerId, ready, privateCfg);
        SyncLog.normal(`SyncProviderManager: Active provider set to ${providerId}`);
      })
      .catch((e) => {
        SyncLog.err(`SyncProviderManager: Failed to load provider ${providerId}:`, e);
        if (this._activeProviderSetupId === setupId) {
          this._isProviderReady$.next(false);
        }
      });
  }

  private _maybeShowLocalFileReselectSnack(
    providerId: SyncProviderId,
    isReady: boolean,
    privateCfg: unknown,
  ): void {
    if (
      this._hasShownLocalFileReselectSnack ||
      isReady ||
      providerId !== SyncProviderId.LocalFile
    ) {
      return;
    }
    const legacyPath = (privateCfg as { syncFolderPath?: unknown } | null)
      ?.syncFolderPath;
    if (typeof legacyPath !== 'string' || !legacyPath) {
      return;
    }
    this._hasShownLocalFileReselectSnack = true;
    this._snackService.open({
      msg: T.F.SYNC.S.LOCAL_FILE_RESELECT_REQUIRED,
      type: 'WARNING',
      config: { duration: 0 },
    });
  }
}

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
import { SyncEpochChangedError } from '../core/errors/sync-errors';

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

  /**
   * Monotonic sync epoch (#9074). Bumped whenever the sync target/identity
   * changes underneath in-flight work: an actual provider switch (after the
   * active-provider swap completes), a target-moving config write (account/
   * folder/URL — content-only saves do NOT bump), or a destructive config
   * operation (`SyncWrapperService.runWithSyncBlocked`: encryption ops, force
   * upload). Sync cycles capture it at cycle start and re-assert it via
   * {@link assertSyncEpochUnchanged} (and the epoch-guarded provider delegate,
   * see `WrappedProviderService`) before every apply/ack/cursor/remote write,
   * so a stale cycle aborts benignly instead of writing against the new
   * epoch/target. Ordering rule: bump AFTER the state mutation completes —
   * bumping before it would let a cycle capture the fresh epoch while still
   * reading the old provider/config.
   *
   * NOT the same counter as {@link configEpoch}, deliberately: configEpoch is
   * COARSE (every config write, auth clears, switch-start; first-time setup
   * included) and guards QUEUED work, where a false positive just re-schedules.
   * This one FENCES RUNNING cycles, where a false positive aborts a healthy
   * sync — so it must skip content-only saves and first-time setup, and bump
   * only after the swap. Do not merge the two.
   */
  private _syncEpoch = 0;

  get syncEpoch(): number {
    return this._syncEpoch;
  }

  bumpSyncEpoch(reason: string): void {
    this._syncEpoch++;
    SyncLog.log(`SyncProviderManager: sync epoch → ${this._syncEpoch} (${reason})`);
  }

  /**
   * Throws {@link SyncEpochChangedError} when the epoch moved since `captured`.
   * `undefined` is a no-op so unthreaded callers keep their current behavior —
   * an unthreaded flow is an UNFENCED flow (see contributor-sync-model.md).
   */
  assertSyncEpochUnchanged(captured: number | undefined, context: string): void {
    if (captured !== undefined && captured !== this._syncEpoch) {
      throw new SyncEpochChangedError(captured, this._syncEpoch, context);
    }
  }

  /**
   * Monotonic in-tab counter over authoritative sync-target/configuration
   * transitions. See {@link configEpoch}.
   */
  private _configEpoch = 0;

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
   * Monotonic counter over authoritative sync-target/configuration transitions.
   * Deferred work captures it and revalidates before I/O, so a request queued
   * against one target cannot be executed against another.
   *
   * Bumped on: any provider-config write (`setProviderConfig`), a target move
   * reported by a bypass ingress (`notifyProviderTargetChanged`), an active
   * provider switch, and a credential revoke. The switch and revoke cases are
   * why this is not derived from `providerConfigChanged$`: neither emits on that
   * stream, so an epoch built on it alone would silently miss both.
   *
   * Deliberately NOT bumped by machine-only OAuth access-token refresh for an
   * unchanged account — that goes through the credential store and moves no
   * target, so bumping would invalidate healthy queued work.
   *
   * In-tab, not persisted, not a cross-tab protocol, and not a security input:
   * it is a staleness heuristic over local UI/config actions. Never derive it
   * from, or let it carry, secrets — compare epochs, never configuration.
   */
  get configEpoch(): number {
    return this._configEpoch;
  }

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
    this._configEpoch++;
    const isTargetChanged = isSyncTargetChanged(prevCfg, config);
    this._providerConfigChanged$.next({ isTargetChanged });

    // Bump only AFTER the write and the synchronous cache-invalidation
    // emission above, so a cycle can never capture the fresh epoch while stale
    // caches/config are still live. Content-only saves must not bump — they
    // would abort a healthy cycle on every settings save. First-time setup
    // (no previous config) must not bump either: there is no old target an
    // in-flight cycle could be running against, and the bump races the fresh
    // config's first sync into a spurious abort (seen as every conflict-dialog
    // E2E timing out on `SyncEpochChangedError (1 → 2)`).
    if (isTargetChanged && prevCfg) {
      this.bumpSyncEpoch(`target change (${providerId})`);
    }

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
   * no config diff is available to infer it from. Two such ingresses exist,
   * both in `dialog-sync-cfg.component`: the Electron LocalFile folder commit
   * (main-side store, post-#8228/#9075) and the OneDrive pre-auth cfg write.
   * Callers MUST gate this on an actual move (`isSyncTargetChanged` for
   * OneDrive, `isChanged` from the LocalFile commit) — an unconditional notify
   * reintroduces the cursor wipe this signal exists to avoid.
   *
   * Kept minimal on purpose: it does not reload provider config (the caller
   * already persisted the new target).
   */
  notifyProviderTargetChanged(): void {
    this._configEpoch++;
    this._providerConfigChanged$.next({ isTargetChanged: true });
    this.bumpSyncEpoch('target change (bypass ingress)');
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

    // Revoking credentials invalidates the authority a queued request captured,
    // even though this path emits no providerConfigChanged$.
    this._configEpoch++;

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

    // A provider SWITCH deliberately does not emit providerConfigChanged$ (see
    // that observable's doc), so the epoch must be bumped here or work captured
    // against the previous provider would survive the switch.
    this._configEpoch++;

    const prevProviderId = this._activeProviderId$.getValue();
    const setupId = ++this._activeProviderSetupId;
    this._activeProviderId$.next(providerId);

    if (!providerId) {
      this._activeProvider = null;
      this._isProviderReady$.next(false);
      this._currentProviderPrivateCfg$.next(null);
      this.bumpSyncEpoch('provider disabled');
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
        // Bump only now that the swap is complete: a cycle that starts between
        // the config change and this point still reads the OLD provider, so it
        // must keep an old (stale-able) epoch — bumping earlier would hand it
        // a fresh epoch while it runs against the abandoned target. First-ever
        // activation (null → X) must not bump: no cycle can have run against a
        // previous target (getActiveProvider() was null), and the async bump
        // would race the fresh setup's first sync into a spurious abort.
        if (prevProviderId !== null) {
          this.bumpSyncEpoch(`provider switch (${providerId})`);
        }

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

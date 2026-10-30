import { computed, DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { generateCaptureKeyPair, isCryptoSubtleAvailable } from '@sp/sync-core';
import type {
  SuperSyncCaptureGrantInfo,
  SuperSyncCaptureTokenResult,
  SuperSyncCaptureConnectCodeResult,
  SuperSyncProvider,
} from '@sp/sync-providers/super-sync';
import { nanoid } from 'nanoid';
import {
  asyncScheduler,
  exhaustMap,
  filter,
  map,
  pairwise,
  throttleTime,
  withLatestFrom,
} from 'rxjs';
import { IS_ELECTRON } from '../../../app.constants';
import { Log } from '../../../core/log';
import { DateService } from '../../../core/date/date.service';
import { SyncWrapperService } from '../../../imex/sync/sync-wrapper.service';
import { SyncEpochChangedError } from '../../../op-log/core/errors/sync-errors';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import {
  getCaptureImportErrorReason,
  NativeCaptureImporter,
} from '../native-capture/native-capture-importer.service';
import {
  AgentCaptureRun,
  CaptureUnsupportedError,
  createSuperSyncCaptureSource,
} from './super-sync-capture-source';

/**
 * Survives a new sync client id (account switch, clean slate), so this
 * device keeps getting back the items it leased before.
 */
const DEVICE_ID_KEY = 'sp-agent-capture-device-id';
const MIN_RUN_INTERVAL_MS = 60 * 1000;
/** Web Locks name: tabs share the device id, so only one may claim at a time. */
const IMPORT_LOCK_NAME = 'sp-agent-capture-import';
const CAPTURE_KEY_VERSION = 1;

/**
 * Agent task capture on SuperSync: imports captures after each sync, and
 * switches the feature on and off for the account.
 */
@Injectable({ providedIn: 'root' })
export class AgentCaptureService {
  private _store = inject(Store);
  private _destroyRef = inject(DestroyRef);
  private _globalConfig = inject(GlobalConfigService);
  private _providerManager = inject(SyncProviderManager);
  private _syncWrapper = inject(SyncWrapperService);
  private _importer = inject(NativeCaptureImporter);
  private _dateService = inject(DateService);
  private _source = createSuperSyncCaptureSource({
    startRun: () => this._startRun(),
    dispatch: (action) => this._store.dispatch(action),
  });

  readonly isEnabled = computed(() => !!this._globalConfig.sync()?.captureKey);
  private _hasLoggedUnsupported = false;

  /**
   * Imports on the falling edge of every sync that left the app IN_SYNC.
   * SuperSync has no interval polling, so captures arrive when the app next
   * syncs for any reason. After a failed sync the synced key may be stale,
   * and the claim would re-register it over a newer one, dropping that key's
   * captures.
   */
  start(): void {
    this._syncWrapper.isSyncInProgress$
      .pipe(
        pairwise(),
        withLatestFrom(this._providerManager.syncStatus$),
        filter(
          ([[wasSyncing, isSyncing], status]) =>
            wasSyncing && !isSyncing && status === 'IN_SYNC',
        ),
        map(() => undefined),
        // Before the throttle, so syncs while capture is off use no slot.
        filter(() => !!this._activeCapture()),
        throttleTime(MIN_RUN_INTERVAL_MS, asyncScheduler, {
          leading: true,
          trailing: true,
        }),
        exhaustMap(() => this._importLogged()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
  }

  /** New key pair, synced to every device, registered with the server. */
  async switchOn(): Promise<void> {
    const provider = this._superSyncOrError();
    const captureKey = await generateCaptureKeyPair();
    // Server first: on a server without capture (404) nothing is saved, so
    // the switch does not stick on with no way to turn it off.
    await provider.registerCaptureKey(captureKey.publicKeySpki);
    this._globalConfig.updateSection('sync', { captureKey }, true);
  }

  /**
   * Disables the key on the server first (grants revoked, pending items
   * dropped), so a failed request changes nothing and can be retried. Then
   * clears the synced key; a device that still holds it until that op
   * arrives is refused when it re-registers it.
   */
  async switchOff(): Promise<void> {
    await this._superSyncOrError().disableCaptureKey();
    this._globalConfig.updateSection('sync', { captureKey: null }, true);
  }

  /** Settings act on the saved, active provider, not on a draft in the form. */
  isSuperSyncActive(): boolean {
    return this._providerManager.getActiveProvider()?.id === SyncProviderId.SuperSync;
  }

  getMcpUrl(): Promise<string> {
    return this._superSyncOrError().getCaptureMcpUrl();
  }

  createConnectCode(): Promise<SuperSyncCaptureConnectCodeResult> {
    return this._superSyncOrError().createCaptureConnectCode();
  }

  createToken(clientName: string): Promise<SuperSyncCaptureTokenResult> {
    return this._superSyncOrError().createCaptureToken(clientName);
  }

  async listGrants(): Promise<SuperSyncCaptureGrantInfo[]> {
    return (await this._superSyncOrError().listCaptureGrants()).grants;
  }

  /** Everything switching off would delete: grant captures and Android shares. */
  async countPending(): Promise<number> {
    const { grants, otherPendingCount } =
      await this._superSyncOrError().listCaptureGrants();
    return grants.reduce(
      (sum, grant) => sum + grant.pendingCount,
      otherPendingCount ?? 0,
    );
  }

  revokeGrant(grantId: string, discardPending: boolean): Promise<void> {
    return this._superSyncOrError().revokeCaptureGrant(grantId, discardPending);
  }

  /**
   * Skips when another tab of this browser is importing: its run covers ours.
   * Electron and the Android WebView are single-instance (as in LockService),
   * and never reject: a rejection here would end the trigger pipeline.
   */
  private async _importLogged(): Promise<void> {
    if (
      IS_ELECTRON ||
      IS_ANDROID_WEB_VIEW ||
      typeof navigator === 'undefined' ||
      !navigator.locks
    ) {
      return this._importLoggedUnlocked();
    }
    try {
      await navigator.locks.request(IMPORT_LOCK_NAME, { ifAvailable: true }, (lock) =>
        lock ? this._importLoggedUnlocked() : undefined,
      );
    } catch (e) {
      // The callback never throws, so the lock itself failed; captures stay queued.
      Log.err('Agent capture import skipped: lock unavailable', {
        reason: e instanceof Error ? e.name : 'unknown',
      });
    }
  }

  private async _importLoggedUnlocked(): Promise<void> {
    // Checked again: it can change during the throttle, and an empty run
    // would prune the importer's receipts.
    if (!this._activeCapture()) return;
    try {
      const { created, invalid } = await this._importer.importPending(this._source);
      if (created || invalid) {
        Log.log('Agent capture import', { createdCount: created, invalidCount: invalid });
      }
    } catch (e) {
      if (e instanceof SyncEpochChangedError) {
        Log.log('Agent capture import abandoned: sync target changed');
        return;
      }
      if (e instanceof CaptureUnsupportedError) {
        // Expected after a move to a server without capture; once per session.
        if (!this._hasLoggedUnsupported) {
          this._hasLoggedUnsupported = true;
          Log.log('Agent capture: this server does not support capture');
        }
        return;
      }
      Log.err('Agent capture import failed; captures stay queued', {
        reason: getCaptureImportErrorReason(e),
      });
    }
  }

  /** Runs synchronously inside the source's claim: the epoch fence's capture point. */
  private _startRun(): AgentCaptureRun | null {
    const active = this._activeCapture();
    if (!active) return null;
    const { provider } = active;
    const epoch = this._providerManager.syncEpoch;
    return {
      ...active,
      deviceId: this._deviceId(),
      defaultEstimate: this._globalConfig.cfg()?.timeTracking.defaultEstimate || 0,
      defaultRemindOption:
        this._globalConfig.cfg()?.reminder.defaultTaskRemindOption ??
        DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
      todayStr: this._dateService.todayStr(),
      assertUnchanged: (context) => {
        // The epoch bumps only after a provider swap completes; the identity
        // check covers the moment in between.
        if (this._providerManager.getActiveProvider() !== provider) {
          throw new SyncEpochChangedError(
            epoch,
            this._providerManager.syncEpoch,
            context,
          );
        }
        this._providerManager.assertSyncEpochUnchanged(epoch, context);
      },
    };
  }

  private _activeCapture(): Pick<AgentCaptureRun, 'provider' | 'key'> | null {
    const provider = this._providerManager.getActiveProvider();
    const key = this._globalConfig.sync()?.captureKey;
    // No WebCrypto (some Android WebViews) or a key from a newer client: the
    // captures wait for another device.
    if (
      provider?.id !== SyncProviderId.SuperSync ||
      key?.v !== CAPTURE_KEY_VERSION ||
      !isCryptoSubtleAvailable()
    ) {
      return null;
    }
    return { provider: provider as SuperSyncProvider, key };
  }

  private _deviceId(): string {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = nanoid();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  }

  private _superSyncOrError(): SuperSyncProvider {
    if (!this.isSuperSyncActive()) {
      throw new Error('Super Sync is not the active sync provider');
    }
    return this._providerManager.getActiveProvider() as SuperSyncProvider;
  }
}

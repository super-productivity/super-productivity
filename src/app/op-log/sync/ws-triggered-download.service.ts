import { inject, Injectable, Injector, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { SuperSyncWebSocketService } from './super-sync-websocket.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { WrappedProviderService } from '../sync-providers/wrapped-provider.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { SyncCycleGuardService } from './sync-cycle-guard.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { lazyInject } from '../../util/lazy-inject';
import { SyncLog } from '../../core/log';
import { AuthFailSPError, MissingCredentialsSPError } from '../sync-exports';
import {
  ForceUploadFailedError,
  ForceUploadPendingOpsError,
  IncompleteRemoteOperationsError,
} from '../core/errors/sync-errors';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

const WS_DOWNLOAD_DEBOUNCE_MS = 500;
const WS_GATE_RETRY_MS = 250;
const WS_DOWNLOAD_RETRY_BASE_MS = 1_000;
const WS_DOWNLOAD_MAX_RETRIES = 3;

/**
 * Triggers operation downloads when WebSocket notifications arrive.
 *
 * Debounced notifications are coalesced into a one-item high-watermark queue.
 * A blocked or in-flight download leaves the newest server sequence pending,
 * so realtime catch-up resumes after the active sync/encryption cycle ends.
 * Reuses the existing OperationLogSyncService.downloadRemoteOps() code path.
 */
@Injectable({
  providedIn: 'root',
})
export class WsTriggeredDownloadService implements OnDestroy {
  private _wsService = inject(SuperSyncWebSocketService);
  private _syncService = inject(OperationLogSyncService);
  private _providerManager = inject(SyncProviderManager);
  private _wrappedProvider = inject(WrappedProviderService);
  private _sessionValidation = inject(SyncSessionValidationService);
  private _syncCycleGuard = inject(SyncCycleGuardService);
  private _snackService = inject(SnackService);
  private _injector = inject(Injector);

  // Resolved lazily to break the DI cycle: SyncWrapperService injects this
  // service to start/stop the WS connection, so this service cannot
  // constructor-inject SyncWrapperService. By the time a WS notification can
  // arrive, the connection has been started from inside SyncWrapperService, so
  // the instance already exists.
  private _getSyncWrapper = lazyInject(this._injector, SyncWrapperService);

  private _subscription: Subscription | null = null;
  private _pendingLatestSeq: number | undefined;
  private _drainTimer: ReturnType<typeof setTimeout> | null = null;
  private _isDraining = false;
  private _downloadRetryCount = 0;

  /**
   * Whether an encryption operation (password change, enable/disable, force
   * upload) is running. Mirrors {@link ImmediateUploadService}, which gates the
   * other side channel on the same flag — a WS-triggered download must not
   * decrypt/apply remote ops while the key or full-state import is mid-flight.
   */
  private get _isEncryptionOperationInProgress(): boolean {
    return this._getSyncWrapper().isEncryptionOperationInProgress;
  }

  start(): void {
    if (this._subscription) {
      return;
    }

    this._subscription = this._wsService.newOpsNotification$
      .pipe(
        debounceTime(WS_DOWNLOAD_DEBOUNCE_MS),
        filter(() => !(globalThis as any).__SP_E2E_BLOCK_WS_DOWNLOAD),
      )
      .subscribe((notification) => {
        this._pendingLatestSeq = Math.max(
          this._pendingLatestSeq ?? 0,
          notification.latestSeq,
        );
        this._scheduleDrain(0);
      });

    SyncLog.log('WsTriggeredDownloadService: Started listening for WS notifications');
  }

  stop(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
    this._pendingLatestSeq = undefined;
    this._downloadRetryCount = 0;
    if (this._drainTimer !== null) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    SyncLog.log('WsTriggeredDownloadService: Stopped');
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private _scheduleDrain(delayMs: number): void {
    if (
      !this._subscription ||
      this._drainTimer !== null ||
      this._isDraining ||
      this._pendingLatestSeq === undefined
    ) {
      return;
    }

    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      void this._drainPending();
    }, delayMs);
  }

  private async _drainPending(): Promise<void> {
    if (!this._subscription || this._isDraining || this._pendingLatestSeq === undefined) {
      return;
    }

    if (this._providerManager.isSyncInProgress) {
      SyncLog.log('WsTriggeredDownloadService: Sync in progress, queueing WS download');
      this._scheduleDrain(WS_GATE_RETRY_MS);
      return;
    }

    if (this._isEncryptionOperationInProgress) {
      SyncLog.log(
        'WsTriggeredDownloadService: Encryption operation in progress, queueing WS download',
      );
      this._scheduleDrain(WS_GATE_RETRY_MS);
      return;
    }

    // #8309: claim the sync cycle. This check, the isSyncInProgress check, and
    // the encryption check above are all synchronous (no await between), so the
    // claim is atomic.
    // Skip if any cycle (main sync, force flow, or the immediate-upload side
    // channel) is active — its apply or its conflict dialog must not race this
    // download's gate decision / setLastServerSeq, and overlapping withSession()
    // calls would misattribute the validation latch.
    if (!this._syncCycleGuard.tryBegin()) {
      SyncLog.log(
        'WsTriggeredDownloadService: Another sync cycle is active, queueing WS download',
      );
      this._scheduleDrain(WS_GATE_RETRY_MS);
      return;
    }

    const latestSeq = this._pendingLatestSeq;
    this._pendingLatestSeq = undefined;
    this._isDraining = true;
    let retryDelayMs = 0;
    try {
      const shouldRetry = await this._downloadOpsInner(latestSeq);
      if (shouldRetry && this._subscription) {
        if (this._downloadRetryCount < WS_DOWNLOAD_MAX_RETRIES) {
          this._pendingLatestSeq = Math.max(this._pendingLatestSeq ?? 0, latestSeq);
          const retryMultiplier = 2 ** this._downloadRetryCount;
          retryDelayMs = WS_DOWNLOAD_RETRY_BASE_MS * retryMultiplier;
          this._downloadRetryCount++;
        } else {
          this._downloadRetryCount = 0;
          SyncLog.err(
            'WsTriggeredDownloadService: Download retry limit reached — reporting ERROR',
          );
          this._providerManager.setSyncStatus('ERROR');
        }
      } else {
        this._downloadRetryCount = 0;
      }
    } finally {
      this._syncCycleGuard.end();
      this._isDraining = false;
      this._scheduleDrain(retryDelayMs);
    }
  }

  private async _downloadOpsInner(latestSeq: number): Promise<boolean> {
    // WS-triggered downloads are their own session boundary. The session
    // wrapper resets the latch up-front so the read at the end reflects
    // only this session, and a leaked-failed latch from a prior path can't
    // masquerade as a failure here. (#7330 — codex review found that
    // without this the validation result of a realtime apply was silently
    // dropped before the next user-initiated sync() reset the latch.)
    return this._sessionValidation.withSession(async () => {
      try {
        const rawProvider = this._providerManager.getActiveProvider();
        if (!rawProvider) {
          SyncLog.log(
            'WsTriggeredDownloadService: No active provider, skipping WS download',
          );
          return false;
        }

        const syncCapableProvider =
          await this._wrappedProvider.getOperationSyncCapable(rawProvider);
        if (!syncCapableProvider) {
          SyncLog.log(
            'WsTriggeredDownloadService: Provider not operation-sync capable, skipping',
          );
          return false;
        }

        const localServerSeq = await syncCapableProvider.getLastServerSeq();
        if (localServerSeq >= latestSeq) {
          SyncLog.log(
            `WsTriggeredDownloadService: Local cursor ${localServerSeq} already covers WS notification ${latestSeq}`,
          );
          return false;
        }

        SyncLog.log(
          `WsTriggeredDownloadService: Downloading ops triggered by WS notification (latestSeq=${latestSeq})`,
        );

        const result = await this._syncService.downloadRemoteOps(syncCapableProvider);

        SyncLog.log(`WsTriggeredDownloadService: Download complete. kind=${result.kind}`);

        if (result.kind === 'blocked_incompatible') {
          SyncLog.warn(
            'WsTriggeredDownloadService: Download blocked by an incompatible operation',
          );
          this._providerManager.setSyncStatus('ERROR');
          return false;
        }

        if (this._sessionValidation.hasFailed()) {
          SyncLog.err(
            'WsTriggeredDownloadService: Post-sync validation failed during WS download — reporting ERROR',
          );
          this._providerManager.setSyncStatus('ERROR');
        }
        return false;
      } catch (err) {
        if (err instanceof ForceUploadPendingOpsError) {
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
          return false;
        }

        if (err instanceof ForceUploadFailedError) {
          this._providerManager.setSyncStatus('ERROR');
          this._snackService.open({
            msg: T.F.SYNC.S.FORCE_UPLOAD_FAILED,
            type: 'ERROR',
          });
          return false;
        }

        if (err instanceof IncompleteRemoteOperationsError) {
          SyncLog.err(
            'WsTriggeredDownloadService: Remote operation application is incomplete',
            err,
          );
          this._providerManager.setSyncStatus('ERROR');
          if (!this._snackService.hasPendingPersistentAction()) {
            this._snackService.open({
              msg: T.F.SYNC.S.INCOMPLETE_REMOTE_OPERATIONS,
              type: 'ERROR',
              config: { duration: 0 },
            });
          }
          return false;
        }
        if (err instanceof AuthFailSPError || err instanceof MissingCredentialsSPError) {
          SyncLog.warn('WsTriggeredDownloadService: Auth failure during download', err);
          this.stop();
          return false;
        }
        SyncLog.warn(
          'WsTriggeredDownloadService: Download failed, queueing WS retry',
          err,
        );
        return true;
      }
    });
  }
}

import { DestroyRef, inject, Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, firstValueFrom, Observable, of } from 'rxjs';
import { GlobalConfigService } from '../../features/config/global-config.service';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  shareReplay,
  switchMap,
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  SyncAlreadyInProgressError,
  LockAcquisitionTimeoutError,
  LocalDataConflictError,
  WebCryptoNotAvailableError,
  MissingRefreshTokenAPIError,
  HttpNotOkAPIError,
  EmptyRemoteBodySPError,
  JsonParseError,
  LegacySyncFormatDetectedError,
  SyncDataCorruptedError,
  UploadRevToMatchMismatchAPIError,
} from '../../op-log/core/errors/sync-errors';
import { MAX_LWW_REUPLOAD_RETRIES } from '../../op-log/core/operation-log.const';
import { SyncConfig } from '../../features/config/global-config.model';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import {
  AuthFailSPError,
  CanNotMigrateMajorDownError,
  ConflictData,
  ConflictReason,
  DecryptError,
  DecryptNoPasswordError,
  EncryptNoPasswordError,
  MissingCredentialsSPError,
  NetworkUnavailableSPError,
  PotentialCorsError,
  SyncProviderId,
  SyncStatus,
  toSyncProviderId,
} from '../../op-log/sync-exports';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { T } from '../../t.const';
import { getSyncErrorStr } from './get-sync-error-str';
import { getErrorTxt } from '../../util/get-error-text';
import { DialogGetAndEnterAuthCodeComponent } from './dialog-get-and-enter-auth-code/dialog-get-and-enter-auth-code.component';
import { DialogConflictResolutionResult } from './sync.model';
import { DialogSyncConflictComponent } from './dialog-sync-conflict/dialog-sync-conflict.component';
import { ReminderService } from '../../features/reminder/reminder.service';

import { DialogHandleDecryptErrorComponent } from './dialog-handle-decrypt-error/dialog-handle-decrypt-error.component';
import { DialogEnterEncryptionPasswordComponent } from './dialog-enter-encryption-password/dialog-enter-encryption-password.component';
import { SyncLog } from '../../core/log';
import { promiseTimeout } from '../../util/promise-timeout';
import { devError } from '../../util/dev-error';
import { alertDialog, confirmDialog } from '../../util/native-dialogs';
import { UserInputWaitStateService } from './user-input-wait-state.service';
import { SYNC_WAIT_TIMEOUT_MS } from './sync.const';
import { SuperSyncStatusService } from '../../op-log/sync/super-sync-status.service';
import { SuperSyncWebSocketService } from '../../op-log/sync/super-sync-websocket.service';
import { WsTriggeredDownloadService } from '../../op-log/sync/ws-triggered-download.service';
import { IS_ELECTRON } from '../../app.constants';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { SyncSessionValidationService } from '../../op-log/sync/sync-session-validation.service';
import { SyncCycleGuardService } from '../../op-log/sync/sync-cycle-guard.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { isSuperSyncWebSocketAccess } from '@sp/sync-providers/super-sync';
import { isTransientNetworkError } from '@sp/sync-providers/http';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import type { UploadOutcome } from '../../op-log/core/types/sync-results.types';

type CompletedUploadOutcome = Extract<UploadOutcome, { kind: 'completed' }>;

/**
 * Identifies which error or UI path triggered a destructive forceUpload.
 * Logged on every invocation so a future sync-stuck incident can be traced
 * back to its origin without diff-archaeology.
 */
export type ForceUploadTriggerSource =
  | 'EmptyRemoteBodySPError'
  | 'JsonParseError'
  | 'LegacySyncFormatDetectedError'
  | 'DecryptError'
  | 'unknown';

/**
 * When the post-sync SuperSync encryption prompt fires while another dialog is
 * still open (typically the sync-config dialog still playing its close animation
 * right after first-time setup), defer rather than drop the prompt: poll until
 * dialogs clear, up to this bound, then re-check state.
 * See `_promptSuperSyncEncryptionIfNeeded` (#8670 regression).
 */
const ENCRYPTION_PROMPT_DIALOG_WAIT_MS = 8000;
const ENCRYPTION_PROMPT_DIALOG_POLL_MS = 100;

@Injectable({
  providedIn: 'root',
})
export class SyncWrapperService {
  private _providerManager = inject(SyncProviderManager);
  private _legacyPfDb = inject(LegacyPfDbService);
  private _globalConfigService = inject(GlobalConfigService);
  private _translateService = inject(TranslateService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);

  private _reminderService = inject(ReminderService);
  private _userInputWaitState = inject(UserInputWaitStateService);
  private _superSyncStatusService = inject(SuperSyncStatusService);
  private _superSyncWsService = inject(SuperSyncWebSocketService);
  private _wsDownloadService = inject(WsTriggeredDownloadService);
  private _opLogStore = inject(OperationLogStoreService);
  private _opLogSyncService = inject(OperationLogSyncService);
  private _sessionValidation = inject(SyncSessionValidationService);
  private _syncCycleGuard = inject(SyncCycleGuardService);
  private _wrappedProvider = inject(WrappedProviderService);
  private _hydrationState = inject(HydrationStateService);

  syncState$ = this._providerManager.syncStatus$;

  syncCfg$: Observable<SyncConfig> = this._globalConfigService.cfg$.pipe(
    map((cfg) => cfg?.sync),
  );
  syncProviderId$: Observable<SyncProviderId | null> = this.syncCfg$.pipe(
    map((cfg) => toSyncProviderId(cfg.syncProvider)),
  );

  private _destroyRef = inject(DestroyRef);

  // Disconnect WebSocket when sync provider changes away from SuperSync or sync is disabled
  private _wsProviderCleanup = this.syncProviderId$
    .pipe(distinctUntilChanged(), takeUntilDestroyed(this._destroyRef))
    .subscribe((providerId) => {
      if (providerId !== SyncProviderId.SuperSync) {
        this.disconnectWebSocket();
      }
    });

  /**
   * Sync interval in milliseconds.
   * - When WebSocket is connected: 5 minutes (health check only)
   * - When WebSocket is disconnected: 1 minute for SuperSync
   * - Other providers: user-configured value
   * - Return 0 when manual sync only is enabled to disable automatic triggers
   */
  syncInterval$: Observable<number> = combineLatest([
    this.syncCfg$,
    toObservable(this._superSyncWsService.isConnected),
  ]).pipe(
    map(([cfg, wsConnected]) => {
      if (cfg.isManualSyncOnly) return 0;
      if (cfg.syncProvider === SyncProviderId.SuperSync) {
        return wsConnected ? 300_000 : 60_000;
      }
      return cfg.syncInterval;
    }),
    distinctUntilChanged(),
  );

  isEnabledAndReady$: Observable<boolean> = this._providerManager.isProviderReady$;

  // NOTE we don't use this._pfapiService.isSyncInProgress$ since it does not include handling and re-init view model
  private _isSyncInProgress$ = new BehaviorSubject(false);
  isSyncInProgress$ = this._isSyncInProgress$.asObservable();

  /**
   * Flag to block sync during critical encryption operations (password change, enable/disable).
   * When true, sync() will skip and return immediately. This prevents race conditions where
   * sync could read partial encryption state during password change.
   */
  private _isEncryptionOperationInProgress$ = new BehaviorSubject(false);

  /**
   * When true, encryption-related dialogs (missing password, decrypt error) are suppressed.
   * Set after the user cancels a dialog so they can navigate to settings to change the password
   * without being blocked by recurring auto-sync dialogs. Cleared when encryption config changes.
   */
  private _suppressEncryptionDialogs = false;

  /**
   * Tracks consecutive SuperSync AuthFailSPError occurrences.
   * Tolerates up to 2 transient 401s (e.g. infrastructure errors);
   * on the 3rd consecutive failure, clears the token so re-auth dialog opens.
   * Reset to 0 on any successful sync or any non-auth error.
   */
  private _consecutiveSuperSyncAuthFailures = 0;

  /**
   * Observable for UI: true when all local changes have been uploaded.
   * Used for all sync providers to show the single checkmark indicator.
   */
  hasNoPendingOps$: Observable<boolean> = toObservable(
    this._superSyncStatusService.hasNoPendingOps,
  ).pipe(distinctUntilChanged(), shareReplay(1));

  /**
   * Observable for UI: true when sync is confirmed fully in sync
   * (no pending ops AND remote recently checked within 1 minute).
   * Used for all sync providers to show the double checkmark indicator.
   */
  superSyncIsConfirmedInSync$: Observable<boolean> = toObservable(
    this._superSyncStatusService.isConfirmedInSync,
  ).pipe(distinctUntilChanged(), shareReplay(1));

  isSyncInProgressSync(): boolean {
    return this._isSyncInProgress$.getValue();
  }

  /**
   * Returns true if an encryption operation (password change, enable/disable) is in progress.
   * Used by ImmediateUploadService to avoid uploading during critical encryption operations.
   */
  get isEncryptionOperationInProgress(): boolean {
    return this._isEncryptionOperationInProgress$.getValue();
  }

  /**
   * Clears the suppression flag so encryption dialogs can appear again.
   * Called after the user changes the encryption password via settings.
   */
  clearEncryptionDialogSuppression(): void {
    this._suppressEncryptionDialogs = false;
  }

  // Expose shared user input wait state for other services (e.g., SyncTriggerService)
  isWaitingForUserInput$ = this._userInputWaitState.isWaitingForUserInput$;

  afterCurrentSyncDoneOrSyncDisabled$: Observable<unknown> = this.isEnabledAndReady$.pipe(
    switchMap((isEnabled) =>
      isEnabled
        ? this._isSyncInProgress$.pipe(
            filter((isInProgress) => !isInProgress),
            timeout({
              each: SYNC_WAIT_TIMEOUT_MS,
              with: () =>
                // If waiting for user input, don't error - just wait indefinitely
                this._userInputWaitState.isWaitingForUserInput$.pipe(
                  switchMap((isWaiting) => {
                    if (isWaiting) {
                      // Continue waiting for sync to complete (no timeout)
                      return this._isSyncInProgress$.pipe(
                        filter((isInProgress) => !isInProgress),
                      );
                    }
                    devError('Sync wait timeout exceeded');
                    return of(undefined);
                  }),
                ),
            }),
          )
        : of(undefined),
    ),
    first(),
  );

  /**
   * @param isUserTriggered  `true` when the sync was explicitly requested by the
   *   user (sync button, saving sync config). Automatic syncs (app resume/focus,
   *   interval, internal retries) pass `false` so that transient network failures
   *   — common right after Android wakes from Doze, before sockets/DNS recover —
   *   stay silent instead of flashing a self-healing "temporary network problem"
   *   snackbar the user never asked about. The next sync cycle retries anyway.
   */
  async sync(isUserTriggered = false): Promise<SyncStatus | 'HANDLED_ERROR'> {
    // Block sync if encryption operation is in progress (password change, enable/disable)
    if (this._isEncryptionOperationInProgress$.getValue()) {
      SyncLog.log('Sync blocked: encryption operation in progress');
      return 'HANDLED_ERROR';
    }

    // Clear suppression so encryption dialogs can appear again on each sync attempt
    this._suppressEncryptionDialogs = false;

    // Race condition fix: Check-and-set atomically before starting sync
    if (this._isSyncInProgress$.getValue()) {
      SyncLog.log('Sync already in progress, skipping concurrent sync attempt');
      return 'HANDLED_ERROR';
    }
    this._isSyncInProgress$.next(true);

    // #8309: claim the in-tab sync cycle so the conflict-gate decision,
    // setLastServerSeq, and the session-validation latch are serialized against
    // the side channels (immediate upload / WS download). Both this claim and
    // the re-entry check above are synchronous (no await between), so the
    // check-and-set stays atomic. If a (short-lived) side channel is mid-cycle
    // we skip rather than block — the next trigger retries. Released in the
    // finally below.
    if (!this._syncCycleGuard.tryBegin()) {
      this._isSyncInProgress$.next(false);
      SyncLog.log('Sync skipped: another sync cycle is in progress');
      return 'HANDLED_ERROR';
    }
    // Open before any async work — see `HydrationStateService.isInSyncWindow`.
    // Pass 0 to disable the failsafe: the `finally` block below is the
    // authoritative close, and a slow sync (provider I/O > 2s) would
    // otherwise expire the timer mid-sync and leave a stale-state gap.
    this._hydrationState.openSyncWindow(0);
    // Set SYNCING status so ImmediateUploadService knows not to interfere
    this._providerManager.setSyncStatus('SYNCING');
    const result = await this._sync(isUserTriggered).finally(() => {
      this._isSyncInProgress$.next(false);
      this._hydrationState.closeSyncWindow();
      this._syncCycleGuard.end();
      // Safeguard: if _sync() threw or completed without setting a final status,
      // reset from SYNCING to UNKNOWN_OR_CHANGED to avoid getting stuck in SYNCING state
      if (this._providerManager.isSyncInProgress) {
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
      }
    });

    // After any successful sync, prompt for encryption if SuperSync is active
    // without it. This ensures data is downloaded and merged first, preventing
    // data loss. Note: a successful sync now returns UpdateRemote when data
    // changed and InSync only when nothing changed (discussion #7196), so this
    // gate must accept both — only HANDLED_ERROR skips the prompt.
    if (result !== 'HANDLED_ERROR') {
      this._promptSuperSyncEncryptionIfNeeded().catch((err) => {
        SyncLog.err('Error prompting for encryption:', err);
      });
    }

    return result;
  }

  /**
   * Runs an encryption operation (password change, enable, disable) with sync blocked.
   *
   * This method:
   * 1. Waits for any ongoing sync to complete
   * 2. Blocks new syncs from starting
   * 3. Runs the operation
   * 4. Unblocks sync
   *
   * This prevents race conditions where sync could interfere with encryption state changes.
   *
   * @param operation - The async operation to run with sync blocked
   * @returns The result of the operation
   */
  async runWithSyncBlocked<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for any ongoing sync to complete (with timeout)
    if (this._isSyncInProgress$.getValue()) {
      SyncLog.log('Waiting for ongoing sync to complete before encryption operation...');
      try {
        // Race between sync completing and timeout
        await Promise.race([
          firstValueFrom(
            this._isSyncInProgress$.pipe(filter((inProgress) => !inProgress)),
          ),
          promiseTimeout(SYNC_WAIT_TIMEOUT_MS).then(() => {
            throw new Error('Timeout waiting for sync');
          }),
        ]);
      } catch (e) {
        throw new Error(
          'Cannot change encryption settings: sync timed out. Please try again.',
        );
      }
    }

    // Block new syncs
    this._isEncryptionOperationInProgress$.next(true);
    SyncLog.log('Sync blocked for encryption operation');

    try {
      return await operation();
    } finally {
      // Unblock sync
      this._isEncryptionOperationInProgress$.next(false);
      SyncLog.log('Sync unblocked after encryption operation');
    }
  }

  /**
   * Connects the WebSocket for real-time sync notifications.
   * Called after a successful SuperSync sync cycle.
   */
  async connectWebSocket(): Promise<void> {
    const providerId = await firstValueFrom(this.syncProviderId$);
    if (providerId !== SyncProviderId.SuperSync) {
      return;
    }

    const provider = await this._providerManager.getProviderById(
      SyncProviderId.SuperSync,
    );
    if (!provider) {
      SyncLog.warn(
        'SyncWrapperService: No SuperSync provider found for WebSocket connection',
      );
      return;
    }

    if (!isSuperSyncWebSocketAccess(provider)) {
      SyncLog.warn(
        'SyncWrapperService: SuperSync provider does not expose WebSocket access',
      );
      return;
    }
    const wsParams = await provider.getWebSocketParams();
    if (!wsParams) {
      SyncLog.warn(
        'SyncWrapperService: No WebSocket params available from SuperSync provider',
      );
      return;
    }

    await this._superSyncWsService.connect(wsParams.baseUrl, wsParams.accessToken);
    this._wsDownloadService.start();
  }

  /**
   * Disconnects the WebSocket and stops WS-triggered downloads.
   */
  disconnectWebSocket(): void {
    this._wsDownloadService.stop();
    this._superSyncWsService.disconnect();
  }

  private async _sync(isUserTriggered: boolean): Promise<SyncStatus | 'HANDLED_ERROR'> {
    const providerId = await firstValueFrom(this.syncProviderId$);
    if (!providerId) {
      throw new Error('No Sync Provider for sync()');
    }

    // Open a session-validation scope for this sync. Any post-sync
    // validation failure during the session (download, upload, piggyback,
    // retry, USE_REMOTE force-download) flips the latch; the wrapper reads
    // it once before claiming IN_SYNC. (#7330)
    return this._sessionValidation.withSession(() =>
      this._syncBody(providerId, isUserTriggered),
    );
  }

  private async _syncBody(
    providerId: SyncProviderId,
    isUserTriggered: boolean,
  ): Promise<SyncStatus | 'HANDLED_ERROR'> {
    try {
      // PERF: For legacy sync providers (WebDAV, Dropbox, LocalFile), sync the vector clock
      // from SUP_OPS to pf.META_MODEL before sync. This bridges the gap between the new
      // atomic write system (vector clock in SUP_OPS) and legacy sync which reads from pf.
      // SuperSync uses operation log directly, so it doesn't need this bridge.
      if (providerId !== SyncProviderId.SuperSync) {
        await this._syncVectorClockToPfapi();
      }

      // Get the sync-capable version of the provider
      // - SuperSync: returned as-is (already implements OperationSyncCapable)
      // - File-based (Dropbox, WebDAV, LocalFile): wrapped with FileBasedSyncAdapterService
      const rawProvider = this._providerManager.getActiveProvider();
      const syncCapableProvider =
        await this._wrappedProvider.getOperationSyncCapable(rawProvider);

      if (!syncCapableProvider) {
        SyncLog.warn('SyncWrapperService: Provider does not support operation sync');
        return SyncStatus.InSync;
      }

      // Perform actual sync: download first, then upload
      SyncLog.log('SyncWrapperService: Starting op-log sync...');

      // Detect provider switch: force fresh download to trigger conflict dialog
      const lastSyncedProvider = this._providerManager.getLastSyncedProviderId();
      const isProviderSwitch =
        lastSyncedProvider !== null && lastSyncedProvider !== providerId;
      if (isProviderSwitch) {
        SyncLog.warn(
          `SyncWrapperService: Provider switch detected (${lastSyncedProvider} → ${providerId}). ` +
            'Forcing download from seq 0 for fresh state comparison.',
        );
      }

      // Capture sync history BEFORE download. The SYNC_IMPORT conflict gate (both the
      // download and piggyback-upload paths) uses this to decide whether a USE_LOCAL
      // choice would overwrite a populated remote with throwaway pre-first-sync state.
      // It MUST be read here, before this sync persists any synced ops, or the
      // never-synced guard reads its own just-written state and disarms itself.
      const isNeverSyncedAtSyncStart = !(await this._opLogSyncService.hasSyncedOps());

      // 1. Download remote ops first (important for fresh clients to receive data)
      const downloadResult = await this._opLogSyncService.downloadRemoteOps(
        syncCapableProvider,
        {
          forceFromSeq0: isProviderSwitch || undefined,
          isNeverSynced: isNeverSyncedAtSyncStart,
        },
      );
      // Auth is confirmed working if download didn't throw AuthFailSPError.
      // Reset here rather than only at InSync so early returns (cancelled,
      // LWW pending, payload rejected) also break the consecutive-failure chain.
      this._consecutiveSuperSyncAuthFailures = 0;
      SyncLog.log(`SyncWrapperService: Download complete. kind=${downloadResult.kind}`);

      // If user cancelled the sync import conflict dialog, skip upload entirely.
      // This keeps the local state unchanged and doesn't push it to the server.
      // Don't update lastSyncedProvider so the next sync retries with forceFromSeq0.
      if (downloadResult.kind === 'cancelled') {
        SyncLog.log('SyncWrapperService: Sync cancelled by user. Skipping upload phase.');
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return 'HANDLED_ERROR';
      }

      // Track the successfully synced provider for switch detection on next sync
      this._providerManager.setLastSyncedProviderId(providerId);

      // 2. Upload pending local ops
      const uploadResult = await this._opLogSyncService.uploadPendingOps(
        syncCapableProvider,
        { isNeverSynced: isNeverSyncedAtSyncStart },
      );
      const completedUploadResults: CompletedUploadOutcome[] =
        uploadResult.kind === 'completed' ? [uploadResult] : [];
      if (uploadResult.kind === 'completed') {
        SyncLog.log(
          `SyncWrapperService: Upload complete. uploaded=${uploadResult.uploadedCount}, piggybacked=${uploadResult.piggybackedOpsCount}`,
        );
      }

      // If upload was cancelled (piggybacked SYNC_IMPORT conflict dialog), skip LWW re-upload
      if (uploadResult.kind === 'cancelled') {
        SyncLog.log(
          'SyncWrapperService: Upload cancelled by user (piggybacked SYNC_IMPORT). Skipping LWW re-upload.',
        );
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return 'HANDLED_ERROR';
      }

      // If the provider mandates encryption but no key is configured yet, the upload was
      // skipped with pending ops still unsynced (GHSA-9v8x guard). Downloads still ran
      // (merge-first), but nothing local can be uploaded until encryption is set up — so
      // this is NOT in sync. Report it honestly instead of falling through to IN_SYNC.
      // Also short-circuit the LWW loop below: its local-win ops are blocked by the same
      // missing key and would just spin to the retry cap.
      if (
        uploadResult.kind === 'completed' &&
        uploadResult.encryptionRequiredKeyMissing
      ) {
        SyncLog.log(
          'SyncWrapperService: Upload skipped — encryption required but no key configured. ' +
            'Reporting UNKNOWN_OR_CHANGED (sync paused until encryption is set up).',
        );
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return SyncStatus.UpdateRemote;
      }

      // 3. If LWW created local-win ops, upload them (with retry limit to prevent infinite loops)
      const downloadLwwOps =
        downloadResult.kind === 'ops_processed' ? downloadResult.localWinOpsCreated : 0;
      const uploadLwwOps =
        uploadResult.kind === 'completed' ? uploadResult.localWinOpsCreated : 0;
      let lwwRetries = 0;
      let pendingLwwOps = downloadLwwOps + uploadLwwOps;
      while (pendingLwwOps > 0 && lwwRetries < MAX_LWW_REUPLOAD_RETRIES) {
        lwwRetries++;
        SyncLog.log(
          `SyncWrapperService: Re-uploading ${pendingLwwOps} local-win op(s) from LWW ` +
            `(attempt ${lwwRetries}/${MAX_LWW_REUPLOAD_RETRIES})...`,
        );
        // Re-thread isNeverSyncedAtSyncStart (the snapshot captured BEFORE the
        // initial upload ran) instead of letting uploadPendingOps re-read live
        // state — the initial batch has already flipped hasSyncedOps() to true
        // and a live read here would mis-classify a still-fresh client. Mirrors
        // the orchestrator-snapshot rationale at the top of uploadPendingOps.
        const reuploadResult = await this._opLogSyncService.uploadPendingOps(
          syncCapableProvider,
          { isNeverSynced: isNeverSyncedAtSyncStart },
        );
        if (reuploadResult.kind === 'cancelled') {
          // Mirror the initial-upload cancel path: a cancelled LWW re-upload
          // means downloaded localWinOpsCreated stay pending in the op-log.
          // UNKNOWN_OR_CHANGED forces a retry on the next sync tick.
          SyncLog.log(
            'SyncWrapperService: LWW re-upload cancelled by user. Skipping remaining sync work.',
          );
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
          return 'HANDLED_ERROR';
        }
        if (reuploadResult.kind === 'completed') {
          completedUploadResults.push(reuploadResult);
        }
        pendingLwwOps =
          reuploadResult.kind === 'completed' ? reuploadResult.localWinOpsCreated : 0;
      }
      if (pendingLwwOps > 0) {
        SyncLog.warn(
          `SyncWrapperService: LWW re-upload still has ${pendingLwwOps} pending ops after ` +
            `${MAX_LWW_REUPLOAD_RETRIES} retries. Will retry on next sync.`,
        );
        // Issue #7521: validation failure is more serious than unuploaded
        // ops — prefer ERROR over UNKNOWN_OR_CHANGED if the latch was
        // flipped at any point during the session.
        if (this._sessionValidation.hasFailed()) {
          SyncLog.err(
            'SyncWrapperService: Validation failed during sync (retry exhaustion path); reporting ERROR',
          );
          this._providerManager.setSyncStatus('ERROR');
          return 'HANDLED_ERROR';
        }
        if (this._handlePermanentUploadRejections(completedUploadResults)) {
          return 'HANDLED_ERROR';
        }
        // Don't claim IN_SYNC — there are known unuploaded ops.
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return SyncStatus.UpdateRemote;
      }

      // Issue #7330: post-sync state validation failure must not be reported
      // as IN_SYNC. The latch is flipped by every validation site; we read it
      // once here before claiming IN_SYNC.
      if (this._sessionValidation.hasFailed()) {
        SyncLog.err(
          'SyncWrapperService: Post-sync state validation failed, not marking as IN_SYNC',
        );
        this._providerManager.setSyncStatus('ERROR');
        return 'HANDLED_ERROR';
      }

      // 4. Check for permanent rejection failures
      if (this._handlePermanentUploadRejections(completedUploadResults)) {
        return 'HANDLED_ERROR';
      }

      // Mark as in-sync for all providers after successful sync
      this._providerManager.setSyncStatus('IN_SYNC');
      SyncLog.log('SyncWrapperService: Sync complete, status=IN_SYNC');

      // Did this sync actually move any data (either direction)? Used by the
      // sync button to show "Data successfully synced" vs "Already in sync"
      // (discussion #7196). UpdateRemote is reused here as the generic
      // "data changed this sync" status — the only consumer that inspects the
      // return value (main-header) treats all UpdateLocal/UpdateRemote variants
      // identically, so no new enum value is needed.
      const didDownloadChanges =
        downloadResult.kind === 'snapshot_hydrated' ||
        downloadResult.kind === 'server_migration_handled' ||
        (downloadResult.kind === 'ops_processed' && downloadResult.newOpsCount > 0);
      const didUploadChanges =
        uploadResult.kind === 'completed' && uploadResult.uploadedCount > 0;
      const didChange = didDownloadChanges || didUploadChanges;

      // Connect WebSocket after first successful SuperSync sync (fire-and-forget)
      if (
        providerId === SyncProviderId.SuperSync &&
        !this._superSyncWsService.isConnected()
      ) {
        this.connectWebSocket().catch((err) => {
          SyncLog.warn(
            'SyncWrapperService: WebSocket connection failed, will retry on next sync',
            err,
          );
        });
      }

      return didChange ? SyncStatus.UpdateRemote : SyncStatus.InSync;
    } catch (error) {
      // DecryptNoPasswordError is expected control flow, not a failure: it signals the
      // app to prompt for the encryption password (handled below). The download/upload
      // service already logged it at the right severity — quiet for a fresh-client
      // onboarding prompt, loud for the dropped-credential signature. Re-logging it here
      // at error level would re-raise the very noise that scoping was meant to remove.
      if (!(error instanceof DecryptNoPasswordError)) {
        SyncLog.err(error);
      }

      // Reset consecutive SuperSync auth failure counter for non-auth errors.
      // Only AuthFailSPError for SuperSync should accumulate the counter.
      if (
        !(error instanceof AuthFailSPError) ||
        providerId !== SyncProviderId.SuperSync
      ) {
        this._consecutiveSuperSyncAuthFailures = 0;
      }

      if (error instanceof PotentialCorsError) {
        this._snackService.open({
          msg: T.F.SYNC.S.ERROR_CORS,
          type: 'ERROR',
          // a bit longer since it is a long message
          config: { duration: 12000 },
        });
        return 'HANDLED_ERROR';
      } else if (
        error instanceof AuthFailSPError ||
        error instanceof MissingRefreshTokenAPIError ||
        error instanceof MissingCredentialsSPError
      ) {
        this._providerManager.setSyncStatus('ERROR');
        this._superSyncStatusService.clearScope();
        // Clear stale auth credentials so isReady() returns false and re-auth dialog opens.
        // SuperSync AuthFailSPError gets special handling: tolerate up to 2 transient 401s
        // (e.g. infrastructure errors returning 401 instead of 500), but on the 3rd
        // consecutive failure, clear the token to break the stale-credential loop.
        // Dropbox clears its refreshable OAuth token immediately so its re-auth flow
        // works. WebDAV/Nextcloud intentionally do NOT clear: the credential is a
        // user-typed (often irrecoverable) password, not a refreshable token — they
        // expose no clearAuthCredentials hook, so clearAuthCredentials() below is a
        // no-op for them and the actionable snackbar handles recovery without
        // destroying the user's config. See issue #7616 — do NOT re-add a WebDAV
        // clearAuthCredentials override.
        let skipClear = false;
        if (error instanceof AuthFailSPError && providerId === SyncProviderId.SuperSync) {
          this._consecutiveSuperSyncAuthFailures++;
          if (this._consecutiveSuperSyncAuthFailures < 3) {
            skipClear = true;
          } else {
            this._consecutiveSuperSyncAuthFailures = 0;
          }
        }
        if (providerId && !skipClear) {
          try {
            await this._providerManager.clearAuthCredentials(providerId);
          } catch (clearError) {
            SyncLog.err('Failed to clear stale auth credentials:', clearError);
          }
        }

        // Show different messages for server rejection vs missing credentials
        if (error instanceof AuthFailSPError) {
          this._snackService.open({
            msg: T.F.SYNC.S.AUTH_TOKEN_REJECTED,
            translateParams: { reason: error.message },
            type: 'ERROR',
            actionFn: () => this._openSyncCfgDialog(),
            actionStr: T.F.SYNC.S.BTN_CONFIGURE,
          });
        } else {
          this._snackService.open({
            msg: T.F.SYNC.S.INCOMPLETE_CFG,
            type: 'ERROR',
            actionFn: () => this._openSyncCfgDialog(),
            actionStr: T.F.SYNC.S.BTN_CONFIGURE,
          });
        }
        return 'HANDLED_ERROR';
      } else if (error instanceof EmptyRemoteBodySPError) {
        // Remote file returned an empty body (e.g. Koofr WebDAV corrupted file).
        // Force overwrite is safe: local data is intact, remote is empty.
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.ERROR_REMOTE_FILE_EMPTY,
          type: 'ERROR',
          config: { duration: 12000 },
          actionFn: async () => this.forceUpload('EmptyRemoteBodySPError'),
          actionStr: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof JsonParseError) {
        // Remote JSON is unparseable (e.g. truncated write, encoding issue).
        // Force overwrite is safe: local data is intact, remote cannot be parsed.
        // Issues: #5574, #4616.
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.ERROR_REMOTE_FILE_CORRUPTED,
          type: 'ERROR',
          config: { duration: 12000 },
          actionFn: async () => this.forceUpload('JsonParseError'),
          actionStr: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof SyncDataCorruptedError) {
        // Remote file format version is incompatible (could be older or newer than local).
        // Do NOT offer force-upload: if remote is newer, overwriting would destroy newer data.
        // Users should ensure all devices run the same app version.
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.ERROR_SYNC_VERSION_MISMATCH,
          type: 'ERROR',
          config: { duration: 12000 },
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof LegacySyncFormatDetectedError) {
        // Remote has v16.x pfapi files (__meta_) but no sync-data.json. Usual cause:
        // an old device still writing the legacy format, which would silently diverge
        // from this client. Force-overwrite is offered as an escape hatch for the
        // stale-__meta_ case (successful migration but old files never cleaned up);
        // it drops any remaining v16 data in favor of the current local state.
        // Issues: #5964, #6174.
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.LEGACY_FORMAT_DETECTED,
          type: 'ERROR',
          config: { duration: 20000 },
          actionFn: async () => this.forceUpload('LegacySyncFormatDetectedError'),
          actionStr: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof HttpNotOkAPIError && error.response.status === 423) {
        // HTTP 423 Locked: WebDAV server holds a file lock.
        // Do NOT offer force overwrite — the PUT will also receive 423.
        // The lock typically resolves on the next sync attempt.
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.ERROR_REMOTE_FILE_LOCKED,
          type: 'ERROR',
        });
        return 'HANDLED_ERROR';
      } else if (
        error instanceof DecryptNoPasswordError ||
        // Upload-side twin (GHSA-9544-hjjr-fg8h): encryption is enabled but the
        // key is gone (dropped credentials) — same recovery as the download
        // case: prompt for the password instead of syncing plaintext.
        error instanceof EncryptNoPasswordError
      ) {
        this._handleMissingPasswordDialog();
        return 'HANDLED_ERROR';
      } else if (error instanceof DecryptError) {
        this._handleDecryptionError();
        return 'HANDLED_ERROR';
      } else if (error instanceof CanNotMigrateMajorDownError) {
        // Log warning instead of alert - user can't do anything about version mismatch during import
        SyncLog.warn(
          'Remote model version newer than local - app update may be required',
        );
        return 'HANDLED_ERROR';
      } else if (error instanceof SyncAlreadyInProgressError) {
        // Silently ignore concurrent sync attempts (using proper error class)
        SyncLog.log('Sync already in progress, skipping concurrent sync attempt');
        return 'HANDLED_ERROR';
      } else if (error instanceof LockAcquisitionTimeoutError) {
        SyncLog.err(
          `Lock acquisition timed out for "${error.lockName}" after ${error.timeoutMs}ms`,
        );
        // Self-healing like the network/timeout branches below: the lock is held
        // by another in-flight op-log operation (compaction, a prior cycle, a
        // queued write) and the next sync cycle retries once it frees. Since
        // #8306 a lock timeout no longer wedges the write queue, so for automatic
        // syncs (resume/focus/interval) the snack would just flash and vanish on
        // its own — only surface it when the user explicitly asked to sync.
        if (isUserTriggered) {
          this._snackService.open({
            msg: T.F.SYNC.S.LOCK_TIMEOUT_ERROR,
            type: 'ERROR',
          });
        }
        return 'HANDLED_ERROR';
      } else if (error instanceof LocalDataConflictError) {
        // File-based sync: Local data exists and remote snapshot would overwrite it
        // Show conflict dialog to let user choose between local and remote data
        return this._handleLocalDataConflict(error);
      } else if (error instanceof WebCryptoNotAvailableError) {
        // WebCrypto (crypto.subtle) is unavailable in insecure contexts
        // (e.g., Android Capacitor serves from http://localhost)
        this._providerManager.setSyncStatus('ERROR');
        this._snackService.open({
          msg: T.F.SYNC.S.WEB_CRYPTO_NOT_AVAILABLE,
          type: 'ERROR',
          config: { duration: 15000 },
        });
        return 'HANDLED_ERROR';
      } else if (
        error instanceof NetworkUnavailableSPError ||
        isTransientNetworkError(error)
      ) {
        // Transient + self-healing (the next sync cycle retries). SuperSync
        // maps connectivity failures to NetworkUnavailableSPError; file-based
        // providers (Dropbox/WebDAV) surface them as generic errors instead, so
        // isTransientNetworkError() catches those too (e.g. UnknownHostException,
        // "could not connect to the server") — provider-agnostic.
        //
        // Only surface a snack when the user explicitly asked to sync; for
        // automatic syncs (notably the auto-sync fired on Android resume, before
        // sockets/DNS recover from Doze) stay silent to avoid a snack that
        // flashes and vanishes on its own.
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        if (isUserTriggered) {
          this._snackService.open({
            msg: T.F.SYNC.S.NETWORK_ERROR,
            type: 'WARNING',
          });
        }
        return 'HANDLED_ERROR';
      } else if (this._isTimeoutError(error)) {
        // Like transient network failures, a sync timeout is self-healing (the
        // next cycle retries) and its "Please try again" message only makes
        // sense for someone actively waiting. Structured native transport
        // timeouts are handled by the network branch above so status is marked
        // UNKNOWN_OR_CHANGED consistently.
        if (isUserTriggered) {
          this._snackService.open({
            msg: T.F.SYNC.S.TIMEOUT_ERROR,
            type: 'ERROR',
            config: { duration: 12000 },
            translateParams: {
              suggestion:
                'Large sync operations may take up to 90 seconds. Please try again.',
            },
          });
        }
        return 'HANDLED_ERROR';
      } else if (this._isPermissionError(error)) {
        this._snackService.open({
          msg: this._getPermissionErrorMessage(),
          type: 'ERROR',
          config: { duration: 12000 },
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof UploadRevToMatchMismatchAPIError) {
        // Another client uploaded between our download and upload — self-healing.
        // The next sync cycle will download their ops first, then upload successfully.
        // Do not show an error snackbar; just mark as UNKNOWN_OR_CHANGED so the
        // next sync cycle triggers and resolves the state.
        SyncLog.log(
          'SyncWrapperService: Concurrent upload detected, will retry on next sync cycle',
        );
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return 'HANDLED_ERROR';
      } else {
        this._providerManager.setSyncStatus('ERROR');
        const errStr = getSyncErrorStr(error);
        this._snackService.open({
          // msg: T.F.SYNC.S.UNKNOWN_ERROR,
          msg: errStr,
          type: 'ERROR',
          translateParams: {
            err: errStr,
          },
        });
        return 'HANDLED_ERROR';
      }
    }
  }

  private _handlePermanentUploadRejections(
    uploadResults: readonly CompletedUploadOutcome[],
  ): boolean {
    const rejectedResult = uploadResults.find((r) => r.permanentRejectionCount > 0);
    if (!rejectedResult) {
      return false;
    }

    const hasPayloadError = rejectedResult.rejectedOps.some(
      (r) =>
        r.error?.includes('Payload too complex') ||
        r.error?.includes('Payload too large'),
    );

    if (hasPayloadError) {
      SyncLog.err(
        'SyncWrapperService: Upload rejected - payload too large/complex',
        rejectedResult.rejectedOps,
      );
      this._providerManager.setSyncStatus('ERROR');
      alertDialog(this._translateService.instant(T.F.SYNC.S.ERROR_PAYLOAD_TOO_LARGE));
      return true;
    }

    SyncLog.err(
      `SyncWrapperService: Upload had ${rejectedResult.permanentRejectionCount} permanent rejection(s), not marking as IN_SYNC`,
      rejectedResult.rejectedOps,
    );
    this._providerManager.setSyncStatus('ERROR');
    return true;
  }

  async forceUpload(triggerSource: ForceUploadTriggerSource = 'unknown'): Promise<void> {
    if (!this._c(this._translateService.instant(T.F.SYNC.C.FORCE_UPLOAD))) {
      return;
    }

    // Diagnostic: stamp the originating error/dialog so we can correlate
    // "what stuck the user" with "what they recovered with" in shared logs.
    SyncLog.log('SyncWrapperService: forceUpload called - uploading local state', {
      triggerSource,
    });

    // Block parallel syncs during force upload to prevent them from trying to
    // download/decrypt old data with a potentially different encryption key.
    // This is critical when forceUpload is triggered after password change.
    await this.runWithSyncBlocked(async () => {
      // #8309: claim the sync cycle so this flow's setLastServerSeq bookkeeping
      // and session-validation latch are isolated from the immediate-upload /
      // WS-download side channels. runWithSyncBlocked
      // has already drained any main sync and set isEncryptionOperationInProgress
      // (which the side channels honour), so the only thing that could hold the
      // guard here is a short-lived side channel; skip-and-let-the-user-retry
      // rather than block.
      if (!this._syncCycleGuard.tryBegin()) {
        SyncLog.log('Force upload skipped: another sync cycle is in progress');
        return;
      }
      try {
        const rawProvider = this._providerManager.getActiveProvider();
        const syncCapableProvider =
          await this._wrappedProvider.getOperationSyncCapable(rawProvider);

        if (!syncCapableProvider) {
          SyncLog.warn(
            'SyncWrapperService: Cannot force upload - provider not available',
          );
          return;
        }

        await this._opLogSyncService.forceUploadLocalState(syncCapableProvider);
        this._providerManager.setSyncStatus('IN_SYNC');
        SyncLog.log('SyncWrapperService: Force upload complete');
      } catch (error) {
        // GHSA-9544-hjjr-fg8h: a keyless-but-encryption-enabled provider makes
        // force upload refuse to send plaintext. Route to the enter-password
        // recovery dialog like the main sync path, not a dead-end error snack —
        // otherwise "force overwrite" (offered as the lost-key recovery) loops.
        if (error instanceof EncryptNoPasswordError) {
          this._handleMissingPasswordDialog();
        } else {
          SyncLog.err('SyncWrapperService: Force upload failed:', error);
          const errStr = getSyncErrorStr(error);
          this._snackService.open({
            msg: errStr,
            type: 'ERROR',
          });
        }
      } finally {
        this._syncCycleGuard.end();
      }
    });
  }

  async configuredAuthForSyncProviderIfNecessary(
    providerId: SyncProviderId,
    force = false,
  ): Promise<{ wasConfigured: boolean }> {
    const provider = await this._providerManager.getProviderById(providerId);

    if (!provider) {
      return { wasConfigured: false };
    }

    if (!provider.getAuthHelper) {
      return { wasConfigured: false };
    }

    if (!force && (await provider.isReady())) {
      SyncLog.warn('Provider already configured');
      return { wasConfigured: false };
    }

    try {
      const { authUrl, codeVerifier, verifyCodeChallenge } =
        await provider.getAuthHelper();
      if (authUrl && codeVerifier && verifyCodeChallenge) {
        const authCode = await this._matDialog
          .open(DialogGetAndEnterAuthCodeComponent, {
            restoreFocus: true,
            data: {
              providerName: provider.id,
              url: authUrl,
            },
          })
          .afterClosed()
          .toPromise();
        if (authCode) {
          const r = await verifyCodeChallenge(authCode);
          // Preserve existing config (especially encryptKey) when updating auth
          const existingConfig = await provider.privateCfg.load();
          await this._providerManager.setProviderConfig(provider.id, {
            ...existingConfig,
            ...r,
          });
          // NOTE: exec sync afterward; promise not awaited
          setTimeout(() => {
            this.sync();
          }, 1000);
          return { wasConfigured: true };
        } else {
          return { wasConfigured: false };
        }
      }
    } catch (error) {
      SyncLog.err(`Failed to configure auth for provider ${providerId}:`, error);
      const httpErr = error instanceof HttpNotOkAPIError ? error : null;
      const isTokenExchangeError = httpErr?.response?.status === 400;
      // A OneDrive token-exchange 400 is almost always a misconfigured
      // Microsoft Entra app registration (typically "Allow public client
      // flows" disabled), not a mistyped/expired code — the authorize step
      // already succeeded. Point the user at the registration fix and surface
      // the Azure error detail (AADSTSxxxxx, carried on the UI-only `.detail`)
      // so it is self-diagnosable.
      let msg: string;
      let translateParams: { [key: string]: string } | undefined;
      if (isTokenExchangeError && providerId === SyncProviderId.OneDrive) {
        msg = T.F.SYNC.S.ONEDRIVE_AUTH_FAILED;
        translateParams = { error: httpErr?.detail || getErrorTxt(error) };
      } else if (isTokenExchangeError) {
        msg = T.F.SYNC.S.INVALID_AUTH_CODE;
      } else {
        msg = T.F.SYNC.S.AUTH_SETUP_FAILED;
      }
      this._snackService.open({
        msg,
        translateParams,
        type: 'ERROR',
        config: { duration: 0 },
      });
      return { wasConfigured: false };
    }
    return { wasConfigured: false };
  }

  private async _openSyncCfgDialog(): Promise<void> {
    const { DialogSyncCfgComponent } =
      await import('./dialog-sync-cfg/dialog-sync-cfg.component');
    this._matDialog.open(DialogSyncCfgComponent);
  }

  /**
   * Handles missing encryption password when receiving encrypted data.
   * Opens a simple dialog to prompt for the password, then re-syncs.
   */
  private _handleMissingPasswordDialog(): void {
    // Suppress dialog if user previously cancelled (so they can navigate to settings)
    if (this._suppressEncryptionDialogs) {
      this._providerManager.setSyncStatus('ERROR');
      return;
    }

    // Prevent multiple password dialogs from opening simultaneously
    if (this._passwordDialog) {
      return;
    }

    // Set ERROR status so sync button shows error icon
    this._providerManager.setSyncStatus('ERROR');

    // Open dialog for password entry
    this._passwordDialog = this._matDialog.open(DialogEnterEncryptionPasswordComponent, {
      width: '450px',
      disableClose: true,
    });

    firstValueFrom(this._passwordDialog.afterClosed())
      .then((result) => {
        this._passwordDialog = undefined;

        if (result?.password) {
          // Password was entered and saved — clear suppression and re-sync
          this._suppressEncryptionDialogs = false;
          this.sync();
        } else if (result?.forceOverwrite) {
          // Force overwrite succeeded; reflect synced status
          this._suppressEncryptionDialogs = false;
          this._providerManager.setSyncStatus('IN_SYNC');
        } else {
          // User cancelled — suppress future dialogs so they can navigate to settings
          this._suppressEncryptionDialogs = true;
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        }
      })
      .catch((err) => {
        this._passwordDialog = undefined;
        SyncLog.err('Error handling missing password dialog result:', err);
      });
  }

  private _handleDecryptionError(): void {
    // Suppress dialog if user previously cancelled (so they can navigate to settings)
    if (this._suppressEncryptionDialogs) {
      this._providerManager.setSyncStatus('ERROR');
      return;
    }

    // Prevent multiple password dialogs from opening simultaneously
    if (this._passwordDialog) {
      return;
    }

    // Set ERROR status so sync button shows error icon
    this._providerManager.setSyncStatus('ERROR');

    // Show snackbar (consistent with other error handlers)
    this._snackService.open({
      msg: T.F.SYNC.S.DECRYPTION_FAILED,
      type: 'ERROR',
      config: { duration: 10000 }, // Longer duration for critical errors
    });

    // Open dialog for password correction
    this._passwordDialog = this._matDialog.open(DialogHandleDecryptErrorComponent, {
      disableClose: true,
    });

    firstValueFrom(this._passwordDialog.afterClosed())
      .then((result) => {
        this._passwordDialog = undefined;

        if (result?.isReSync) {
          this._suppressEncryptionDialogs = false;
          this.sync();
        } else if (result?.isForceUpload) {
          this._suppressEncryptionDialogs = false;
          this.forceUpload('DecryptError');
        } else {
          // User cancelled — suppress future dialogs so they can navigate to settings
          this._suppressEncryptionDialogs = true;
          this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        }
      })
      .catch((err) => {
        this._passwordDialog = undefined;
        SyncLog.err('Error handling decrypt error dialog result:', err);
      });
  }

  /**
   * Handles LocalDataConflictError by showing a conflict resolution dialog.
   * This occurs when sync detects local data that would be overwritten by remote data.
   *
   * User can choose:
   * - USE_LOCAL: Upload local data, overwriting remote (uses forceUploadLocalState)
   * - USE_REMOTE: Download remote data, discarding local (uses forceDownloadRemoteState)
   */
  private async _handleLocalDataConflict(
    error: LocalDataConflictError,
  ): Promise<SyncStatus | 'HANDLED_ERROR'> {
    // Signal that we're waiting for user input (prevents sync timeout)
    const stopWaiting = this._userInputWaitState.startWaiting('local-data-conflict');

    try {
      // Build ConflictData for the dialog
      const vcEntry = await this._opLogStore.getVectorClockEntry();
      const localClock = vcEntry?.clock;
      const localLastUpdate = vcEntry?.lastUpdate || Date.now();

      const conflictData: ConflictData = {
        reason: ConflictReason.NoLastSync,
        remote: {
          lastUpdate: Date.now(), // Remote snapshot doesn't have a timestamp, use now
          lastUpdateAction: 'Remote data',
          revMap: {},
          crossModelVersion: 1,
          mainModelData: error.remoteSnapshotState,
          isFullData: true,
          vectorClock: error.remoteVectorClock,
        },
        local: {
          lastUpdate: localLastUpdate,
          lastUpdateAction: `${error.unsyncedCount} local changes pending`,
          revMap: {},
          crossModelVersion: 1,
          lastSyncedUpdate: null,
          metaRev: null,
          vectorClock: localClock,
          lastSyncedVectorClock: null,
        },
      };

      SyncLog.log(
        `SyncWrapperService: Showing conflict dialog for ${error.unsyncedCount} local changes vs remote snapshot`,
      );

      const resolution = await firstValueFrom(this._openConflictDialog$(conflictData));

      // Get sync provider for the resolution operation
      const rawProvider = this._providerManager.getActiveProvider();
      const syncCapableProvider =
        await this._wrappedProvider.getOperationSyncCapable(rawProvider);

      if (!syncCapableProvider) {
        SyncLog.err(
          'SyncWrapperService: Cannot resolve conflict - provider not available',
        );
        return 'HANDLED_ERROR';
      }

      if (resolution === 'USE_LOCAL') {
        // User chose to keep local data and upload it to remote
        SyncLog.log(
          'SyncWrapperService: User chose USE_LOCAL - uploading local state to overwrite remote',
        );
        await this._opLogSyncService.forceUploadLocalState(syncCapableProvider);
        this._providerManager.setSyncStatus('IN_SYNC');
        return SyncStatus.InSync;
      } else if (resolution === 'USE_REMOTE') {
        // User chose to discard local data and download remote.
        // Reset latch — read after forceDownloadRemoteState returns. (#7330)
        SyncLog.log(
          'SyncWrapperService: User chose USE_REMOTE - downloading remote state, discarding local',
        );
        this._sessionValidation.reset();
        await this._opLogSyncService.forceDownloadRemoteState(syncCapableProvider);
        if (this._sessionValidation.hasFailed()) {
          SyncLog.err(
            'SyncWrapperService: USE_REMOTE applied but post-sync validation failed; reporting ERROR',
          );
          this._providerManager.setSyncStatus('ERROR');
          return 'HANDLED_ERROR';
        }
        this._providerManager.setSyncStatus('IN_SYNC');
        return SyncStatus.InSync;
      } else {
        // User cancelled the dialog
        SyncLog.log('SyncWrapperService: User cancelled first sync conflict dialog');
        this._snackService.open({
          msg: T.F.SYNC.S.LOCAL_DATA_REPLACE_CANCELLED,
        });
        return 'HANDLED_ERROR';
      }
    } catch (resolutionError) {
      // GHSA-9544-hjjr-fg8h: USE_LOCAL force-uploads, which refuses to send
      // plaintext when the key is missing. Route to the enter-password recovery
      // dialog instead of a dead-end error snack (mirrors the main sync path).
      if (resolutionError instanceof EncryptNoPasswordError) {
        this._handleMissingPasswordDialog();
        return 'HANDLED_ERROR';
      }
      // Error during conflict resolution (forceUpload or forceDownload failed)
      SyncLog.err(
        'SyncWrapperService: Error during conflict resolution:',
        resolutionError,
      );
      const errStr = getSyncErrorStr(resolutionError);
      this._snackService.open({
        msg: errStr,
        type: 'ERROR',
      });
      return 'HANDLED_ERROR';
    } finally {
      stopWaiting();
    }
  }

  private _c(str: string): boolean {
    return confirmDialog(this._translateService.instant(str));
  }

  private _isPermissionError(error: unknown): boolean {
    const errStr = String(error);
    return /EROFS|EACCES|EPERM|read-only file system|permission denied/i.test(errStr);
  }

  private _isTimeoutError(error: unknown): boolean {
    const errStr = String(error).toLowerCase();
    return (
      errStr.includes('timeout') ||
      errStr.includes('504') ||
      errStr.includes('gateway timeout')
    );
  }

  private _getPermissionErrorMessage(): string {
    if (IS_ELECTRON && window.ea?.isFlatpak?.()) {
      return T.F.SYNC.S.ERROR_PERMISSION_FLATPAK;
    }
    if (IS_ELECTRON && window.ea?.isSnap?.()) {
      return T.F.SYNC.S.ERROR_PERMISSION_SNAP;
    }
    return T.F.SYNC.S.ERROR_PERMISSION;
  }

  private lastConflictDialog?: MatDialogRef<
    DialogSyncConflictComponent,
    DialogConflictResolutionResult
  >;

  /**
   * Reference to any open password-related dialog (enter password or decrypt error).
   * Used to prevent multiple simultaneous password dialogs from opening.
   * Uses Record<string, unknown> because dialog components are dynamically imported.
   */

  private _passwordDialog?: MatDialogRef<any, Record<string, unknown>>;

  /**
   * Reference to the encryption-required dialog to prevent multiple opens.
   * Uses Record<string, unknown> because dialog component is dynamically imported.
   */

  private _encryptionRequiredDialog?: MatDialogRef<any, Record<string, unknown>>;

  /**
   * Synchronous guard to prevent TOCTOU race in _promptSuperSyncEncryptionIfNeeded.
   * The async import() between checking _encryptionRequiredDialog and opening the dialog
   * creates a window where concurrent calls can both pass the guard.
   */
  private _isOpeningEncryptionDialog = false;

  /**
   * One-shot flag: the legacy post-sync setup modal only fires for the fresh-setup
   * sync (the sync triggered right after the config dialog enables SuperSync).
   * Established/returning unencrypted accounts are nudged by the calm, dismissible
   * SuperSyncEncryptionMigrationBannerService instead, so the per-sync modal must
   * NOT fire for them — otherwise both would prompt at startup. Set by the config
   * dialog via markPromptEncryptionAfterSetupSync(); consumed on the first
   * post-sync prompt evaluation for SuperSync (see _promptSuperSyncEncryptionIfNeeded).
   */
  private _shouldPromptEncryptionAfterSetupSync = false;

  /**
   * Called by the sync config dialog immediately after (re)enabling SuperSync from
   * a disabled state, so the setup encryption modal fires once for that setup sync.
   */
  markPromptEncryptionAfterSetupSync(): void {
    this._shouldPromptEncryptionAfterSetupSync = true;
  }

  /**
   * After a successful sync, checks if SuperSync is active without encryption.
   * If so, opens the encryption dialog. Data has already been synced, so no data loss.
   */
  private async _promptSuperSyncEncryptionIfNeeded(): Promise<void> {
    SyncLog.log(
      '_promptSuperSyncEncryptionIfNeeded called, _isOpeningEncryptionDialog=',
      this._isOpeningEncryptionDialog,
      ', _encryptionRequiredDialog=',
      !!this._encryptionRequiredDialog,
      ', openDialogs=',
      this._matDialog.openDialogs.length,
    );
    const providerId = await firstValueFrom(this.syncProviderId$);
    if (providerId !== SyncProviderId.SuperSync) {
      return;
    }

    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      return;
    }

    // Established/returning unencrypted accounts are owned by the calm migration
    // banner (SuperSyncEncryptionMigrationBannerService); only the fresh-setup sync
    // that armed the flag fires this dead-end modal, so the two never both prompt.
    // Consume the one-shot flag HERE (not at dialog-open) so it can't leak to a
    // later, unrelated sync via one of the early-returns below. A failed setup sync
    // returns HANDLED_ERROR and never reaches this method, so the arming survives
    // and retries on the next successful sync. Tradeoff: if the modal-open is later
    // blocked (another dialog open / TOCTOU guard below), the flag is already spent
    // and this modal won't retry — acceptable because the migration banner catches
    // the still-unencrypted account on the next app start (seq is now > 0).
    // TODO(#8670): once the mandatory-encryption upload guard lands, retire this
    // modal + flag entirely and let the banner own all cohorts.
    if (!this._shouldPromptEncryptionAfterSetupSync) {
      SyncLog.log(
        'Skipping legacy setup encryption modal — migration banner owns established nudge',
      );
      return;
    }
    this._shouldPromptEncryptionAfterSetupSync = false;

    const cfg = (await provider.privateCfg.load()) as
      | { isEncryptionEnabled?: boolean; encryptKey?: string }
      | undefined;
    if (cfg?.isEncryptionEnabled && cfg?.encryptKey) {
      SyncLog.log('SuperSync encryption already enabled, skipping');
      return;
    }

    SyncLog.log(
      'SuperSync encryption not enabled — prompting user, openDialogs=',
      this._matDialog.openDialogs.length,
      ', _isOpeningEncryptionDialog=',
      this._isOpeningEncryptionDialog,
      ', _encryptionRequiredDialog=',
      !!this._encryptionRequiredDialog,
    );

    // If our own encryption prompt is already open or being opened, there is
    // nothing to do — and we must not wait on it below.
    if (this._encryptionRequiredDialog || this._isOpeningEncryptionDialog) {
      SyncLog.log('Encryption prompt already open/opening — skipping');
      return;
    }

    // A transiently-open dialog — typically the sync-config dialog still playing
    // its close animation right after first-time setup — must only DEFER this
    // prompt, never drop it. With the E2EE-mandatory upload guard (GHSA-9v8x) the
    // initial sync finishes almost instantly (upload is skipped until a key
    // exists), so it can now beat the config dialog's close animation; a one-shot
    // skip here then leaves SuperSync enabled with no encryption configured and no
    // prompt shown (#8670 regression). Wait (bounded) for open dialogs to clear,
    // then re-check state before prompting. A competing dialog that is still open
    // after the wait (e.g. an enter-password flow the user is interacting with) is
    // left alone — the next sync re-runs this check.
    if (this._matDialog.openDialogs.length > 0) {
      SyncLog.log('Dialog open — deferring encryption prompt until it closes');
      const waitStart = Date.now();
      while (
        this._matDialog.openDialogs.length > 0 &&
        Date.now() - waitStart < ENCRYPTION_PROMPT_DIALOG_WAIT_MS
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, ENCRYPTION_PROMPT_DIALOG_POLL_MS),
        );
      }
      if (this._matDialog.openDialogs.length > 0) {
        SyncLog.log('Dialog still open after wait — skipping encryption prompt');
        return;
      }
      // Provider/encryption state can change during the wait: the closing dialog
      // may switch providers, disable SuperSync, or configure encryption itself
      // (e.g. an enter-password flow). Re-validate the active provider and its
      // config before prompting — otherwise we could open the disableClose setup
      // dialog for a provider that is no longer active, trapping the user.
      const providerIdAfterWait = await firstValueFrom(this.syncProviderId$);
      if (providerIdAfterWait !== SyncProviderId.SuperSync) {
        SyncLog.log('Provider changed while waiting — skipping encryption prompt');
        return;
      }
      const providerAfterWait = this._providerManager.getActiveProvider();
      if (!providerAfterWait) {
        return;
      }
      const cfgAfterWait = (await providerAfterWait.privateCfg.load()) as
        | { isEncryptionEnabled?: boolean; encryptKey?: string }
        | undefined;
      if (cfgAfterWait?.isEncryptionEnabled && cfgAfterWait?.encryptKey) {
        SyncLog.log('Encryption enabled while waiting — skipping prompt');
        return;
      }
    }

    if (!this._encryptionRequiredDialog && !this._isOpeningEncryptionDialog) {
      this._isOpeningEncryptionDialog = true;
      SyncLog.log('Opening encryption dialog (guard passed)');
      try {
        const { DialogEnableEncryptionComponent } =
          await import('./dialog-enable-encryption/dialog-enable-encryption.component');

        // Double-check after async import: another call might have opened a dialog
        if (this._encryptionRequiredDialog || this._matDialog.openDialogs.length > 0) {
          SyncLog.log('Dialog appeared during import — aborting');
          return;
        }

        this._encryptionRequiredDialog = this._matDialog.open(
          DialogEnableEncryptionComponent,
          {
            disableClose: true,
            data: { providerType: 'supersync', initialSetup: true },
          },
        );

        this._encryptionRequiredDialog.afterClosed().subscribe((result) => {
          this._encryptionRequiredDialog = undefined;
          if (result?.success) {
            this.sync();
          }
        });
      } finally {
        this._isOpeningEncryptionDialog = false;
      }
    } else {
      SyncLog.log(
        'Skipping encryption dialog — guard blocked: _encryptionRequiredDialog=',
        !!this._encryptionRequiredDialog,
        ', _isOpeningEncryptionDialog=',
        this._isOpeningEncryptionDialog,
      );
    }
  }

  private _openConflictDialog$(
    conflictData: ConflictData,
  ): Observable<DialogConflictResolutionResult | undefined> {
    if (this.lastConflictDialog) {
      this.lastConflictDialog.close();
    }
    this.lastConflictDialog = this._matDialog.open(DialogSyncConflictComponent, {
      restoreFocus: true,
      disableClose: true,
      data: conflictData,
    });
    // disableClose blocks ESC/backdrop, but a programmatic close (iOS app
    // lifecycle, navigation, or re-entry calling close()) emits `undefined`.
    // Forward it as-is so _handleLocalDataConflict treats it as cancellation;
    // filtering it would leave firstValueFrom() to throw EmptyError (issue #7339).
    return this.lastConflictDialog.afterClosed();
  }

  /**
   * Syncs the current vector clock from SUP_OPS to pf.META_MODEL.
   * Called before legacy sync providers start syncing.
   * This ensures the legacy sync provider sees the latest vector clock.
   */
  private async _syncVectorClockToPfapi(): Promise<void> {
    const vcEntry = await this._opLogStore.getVectorClockEntry();

    if (vcEntry) {
      SyncLog.log('[SyncWrapper] Syncing vector clock to pf.META_MODEL', {
        clockSize: Object.keys(vcEntry.clock).length,
        lastUpdate: vcEntry.lastUpdate,
      });

      const existing = await this._legacyPfDb.loadMetaModel();
      await this._legacyPfDb.saveMetaModel({
        ...existing,
        vectorClock: vcEntry.clock,
        lastUpdate: vcEntry.lastUpdate,
      });
    } else {
      SyncLog.log('[SyncWrapper] No vector clock in SUP_OPS, skipping sync');
    }
  }
}

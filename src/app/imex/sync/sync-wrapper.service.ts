import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, of } from 'rxjs';
import { GlobalConfigService } from '../../features/config/global-config.service';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  shareReplay,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  SyncAlreadyInProgressError,
  LocalDataConflictError,
  WebCryptoNotAvailableError,
  MissingRefreshTokenAPIError,
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
  LockPresentError,
  MissingCredentialsSPError,
  NoRemoteModelFile,
  PotentialCorsError,
  RevMismatchForModelError,
  SyncInvalidTimeValuesError,
  SyncProviderId,
  SyncStatus,
  toSyncProviderId,
} from '../../op-log/sync-exports';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { T } from '../../t.const';
import { getSyncErrorStr } from './get-sync-error-str';
import { DialogGetAndEnterAuthCodeComponent } from './dialog-get-and-enter-auth-code/dialog-get-and-enter-auth-code.component';
import { DialogConflictResolutionResult } from './sync.model';
import { DialogSyncConflictComponent } from './dialog-sync-conflict/dialog-sync-conflict.component';
import { ReminderService } from '../../features/reminder/reminder.service';
import { DataInitService } from '../../core/data-init/data-init.service';
import { DialogSyncInitialCfgComponent } from './dialog-sync-initial-cfg/dialog-sync-initial-cfg.component';
import { DialogIncompleteSyncComponent } from './dialog-incomplete-sync/dialog-incomplete-sync.component';
import { DialogHandleDecryptErrorComponent } from './dialog-handle-decrypt-error/dialog-handle-decrypt-error.component';
import { DialogEnterEncryptionPasswordComponent } from './dialog-enter-encryption-password/dialog-enter-encryption-password.component';
import { DialogIncoherentTimestampsErrorComponent } from './dialog-incoherent-timestamps-error/dialog-incoherent-timestamps-error.component';
import { SyncLog } from '../../core/log';
import { promiseTimeout } from '../../util/promise-timeout';
import { devError } from '../../util/dev-error';
import { alertDialog, confirmDialog } from '../../util/native-dialogs';
import { UserInputWaitStateService } from './user-input-wait-state.service';
import { LegacySyncProvider } from './legacy-sync-provider.model';
import { SYNC_WAIT_TIMEOUT_MS, SYNC_REINIT_DELAY_MS } from './sync.const';
import { SuperSyncStatusService } from '../../op-log/sync/super-sync-status.service';
import { IS_ELECTRON } from '../../app.constants';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';

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
  private _dataInitService = inject(DataInitService);
  private _reminderService = inject(ReminderService);
  private _userInputWaitState = inject(UserInputWaitStateService);
  private _superSyncStatusService = inject(SuperSyncStatusService);
  private _opLogStore = inject(OperationLogStoreService);
  private _opLogSyncService = inject(OperationLogSyncService);
  private _wrappedProvider = inject(WrappedProviderService);

  syncState$ = this._providerManager.syncStatus$;

  syncCfg$: Observable<SyncConfig> = this._globalConfigService.cfg$.pipe(
    map((cfg) => cfg?.sync),
  );
  syncProviderId$: Observable<SyncProviderId | null> = this.syncCfg$.pipe(
    map((cfg) => toSyncProviderId(cfg.syncProvider)),
  );

  // SuperSync always uses 1 minute interval; other providers use configured value
  // Return 0 when manual sync only is enabled to disable automatic triggers
  syncInterval$: Observable<number> = this.syncCfg$.pipe(
    map((cfg) => {
      if (cfg.isManualSyncOnly) return 0;
      return cfg.syncProvider === LegacySyncProvider.SuperSync ? 60000 : cfg.syncInterval;
    }),
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

  async sync(): Promise<SyncStatus | 'HANDLED_ERROR'> {
    // Block sync if encryption operation is in progress (password change, enable/disable)
    if (this._isEncryptionOperationInProgress$.getValue()) {
      SyncLog.log('Sync blocked: encryption operation in progress');
      return 'HANDLED_ERROR';
    }

    // Race condition fix: Check-and-set atomically before starting sync
    if (this._isSyncInProgress$.getValue()) {
      SyncLog.log('Sync already in progress, skipping concurrent sync attempt');
      return 'HANDLED_ERROR';
    }
    this._isSyncInProgress$.next(true);
    // Set SYNCING status so ImmediateUploadService knows not to interfere
    this._providerManager.setSyncStatus('SYNCING');
    return this._sync().finally(() => {
      this._isSyncInProgress$.next(false);
      // Safeguard: if _sync() threw or completed without setting a final status,
      // reset from SYNCING to UNKNOWN_OR_CHANGED to avoid getting stuck in SYNCING state
      if (this._providerManager.isSyncInProgress) {
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
      }
    });
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
        SyncLog.warn('Timeout waiting for sync to complete, proceeding anyway');
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

  private async _sync(): Promise<SyncStatus | 'HANDLED_ERROR'> {
    const providerId = await this.syncProviderId$.pipe(take(1)).toPromise();
    if (!providerId) {
      throw new Error('No Sync Provider for sync()');
    }

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

      // 1. Download remote ops first (important for fresh clients to receive data)
      const downloadResult =
        await this._opLogSyncService.downloadRemoteOps(syncCapableProvider);
      SyncLog.log(
        `SyncWrapperService: Download complete. newOps=${downloadResult.newOpsCount}, migration=${downloadResult.serverMigrationHandled}`,
      );

      // If user cancelled the sync import conflict dialog, skip upload entirely.
      // This keeps the local state unchanged and doesn't push it to the server.
      if (downloadResult.cancelled) {
        SyncLog.log('SyncWrapperService: Sync cancelled by user. Skipping upload phase.');
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return SyncStatus.NotConfigured;
      }

      // 2. Upload pending local ops
      const uploadResult =
        await this._opLogSyncService.uploadPendingOps(syncCapableProvider);
      if (uploadResult) {
        SyncLog.log(
          `SyncWrapperService: Upload complete. uploaded=${uploadResult.uploadedCount}, piggybacked=${uploadResult.piggybackedOps.length}`,
        );
      }

      // 3. If LWW created local-win ops, upload them (with retry limit to prevent infinite loops)
      let lwwRetries = 0;
      let pendingLwwOps =
        (downloadResult.localWinOpsCreated ?? 0) +
        (uploadResult?.localWinOpsCreated ?? 0);
      while (pendingLwwOps > 0 && lwwRetries < MAX_LWW_REUPLOAD_RETRIES) {
        lwwRetries++;
        SyncLog.log(
          `SyncWrapperService: Re-uploading ${pendingLwwOps} local-win op(s) from LWW ` +
            `(attempt ${lwwRetries}/${MAX_LWW_REUPLOAD_RETRIES})...`,
        );
        const reuploadResult =
          await this._opLogSyncService.uploadPendingOps(syncCapableProvider);
        pendingLwwOps = reuploadResult?.localWinOpsCreated ?? 0;
      }
      if (pendingLwwOps > 0) {
        SyncLog.warn(
          `SyncWrapperService: LWW re-upload still has ${pendingLwwOps} pending ops after ` +
            `${MAX_LWW_REUPLOAD_RETRIES} retries. Will retry on next sync.`,
        );
        // Don't claim IN_SYNC — there are known unuploaded ops.
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
        return SyncStatus.UpdateRemote;
      }

      // 4. Check for permanent rejection failures - these are critical failures that should
      // NOT be reported as "in sync" to the user.
      //
      // IMPORTANT: We check permanentRejectionCount, NOT rejectedCount.
      // - Transient errors (INTERNAL_ERROR) will retry on next sync
      // - Resolved conflicts (CONFLICT_CONCURRENT merged successfully) are not failures
      // - Duplicate operations (already synced) are not failures
      // Only permanent rejections (VALIDATION_ERROR, payload too large) should block success.
      //
      // Fall back to rejectedCount for backward compatibility if permanentRejectionCount is undefined.
      const permanentFailures =
        uploadResult?.permanentRejectionCount ?? uploadResult?.rejectedCount ?? 0;

      if (permanentFailures > 0) {
        // Check for payload errors first (special handling with alert)
        const hasPayloadError = uploadResult?.rejectedOps?.some(
          (r) =>
            r.error?.includes('Payload too complex') ||
            r.error?.includes('Payload too large'),
        );

        if (hasPayloadError) {
          SyncLog.err(
            'SyncWrapperService: Upload rejected - payload too large/complex',
            uploadResult?.rejectedOps,
          );
          this._providerManager.setSyncStatus('ERROR');
          // Use alertDialog for maximum visibility - this is a critical error
          alertDialog(this._translateService.instant(T.F.SYNC.S.ERROR_PAYLOAD_TOO_LARGE));
          return 'HANDLED_ERROR';
        }

        // Other permanent rejections - still shouldn't claim success
        SyncLog.err(
          `SyncWrapperService: Upload had ${permanentFailures} permanent rejection(s), not marking as IN_SYNC`,
          uploadResult?.rejectedOps,
        );
        this._providerManager.setSyncStatus('ERROR');
        return 'HANDLED_ERROR';
      }

      // Mark as in-sync for all providers after successful sync
      // This indicates the sync operation completed successfully
      this._providerManager.setSyncStatus('IN_SYNC');
      SyncLog.log('SyncWrapperService: Sync complete, status=IN_SYNC');
      return SyncStatus.InSync;
    } catch (error) {
      SyncLog.err(error);

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
        // Clear stale auth credentials so isReady() returns false and re-auth dialog opens
        if (providerId) {
          try {
            await this._providerManager.clearAuthCredentials(providerId);
          } catch (clearError) {
            SyncLog.err('Failed to clear stale auth credentials:', clearError);
          }
        }

        this._snackService.open({
          msg: T.F.SYNC.S.INCOMPLETE_CFG,
          type: 'ERROR',
          actionFn: async () => this._matDialog.open(DialogSyncInitialCfgComponent),
          actionStr: T.F.SYNC.S.BTN_CONFIGURE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof SyncInvalidTimeValuesError) {
        // Handle async dialog result properly to avoid silent error swallowing
        this._handleIncoherentTimestampsDialog();
        return 'HANDLED_ERROR';
      } else if (
        error instanceof RevMismatchForModelError ||
        error instanceof NoRemoteModelFile
      ) {
        SyncLog.log(error, Object.keys(error));
        // Extract modelId safely with proper type validation
        const modelId = this._extractModelIdFromError(error);
        // Handle async dialog result properly to avoid silent error swallowing
        this._handleIncompleteSyncDialog(modelId);
        return 'HANDLED_ERROR';
      } else if (error instanceof LockPresentError) {
        this._snackService.open({
          // TODO translate
          msg: T.F.SYNC.S.ERROR_DATA_IS_CURRENTLY_WRITTEN,
          type: 'ERROR',
          actionFn: async () => this.forceUpload(),
          actionStr: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof DecryptNoPasswordError) {
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
      } else if (this._isTimeoutError(error)) {
        this._snackService.open({
          msg: T.F.SYNC.S.TIMEOUT_ERROR,
          type: 'ERROR',
          config: { duration: 12000 },
          translateParams: {
            suggestion:
              'Large sync operations may take up to 90 seconds. Please try again.',
          },
        });
        return 'HANDLED_ERROR';
      } else if (this._isPermissionError(error)) {
        this._snackService.open({
          msg: this._getPermissionErrorMessage(),
          type: 'ERROR',
          config: { duration: 12000 },
        });
        return 'HANDLED_ERROR';
      } else {
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

  async forceUpload(): Promise<void> {
    if (!this._c(this._translateService.instant(T.F.SYNC.C.FORCE_UPLOAD))) {
      return;
    }

    SyncLog.log('SyncWrapperService: forceUpload called - uploading local state');

    // Block parallel syncs during force upload to prevent them from trying to
    // download/decrypt old data with a potentially different encryption key.
    // This is critical when forceUpload is triggered after password change.
    await this.runWithSyncBlocked(async () => {
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
        SyncLog.err('SyncWrapperService: Force upload failed:', error);
        const errStr = getSyncErrorStr(error);
        this._snackService.open({
          msg: errStr,
          type: 'ERROR',
        });
      }
    });
  }

  async configuredAuthForSyncProviderIfNecessary(
    providerId: SyncProviderId,
    force = false,
  ): Promise<{ wasConfigured: boolean }> {
    const provider = this._providerManager.getProviderById(providerId);

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
      this._snackService.open({
        // TODO don't limit snack to dropbox
        msg: T.F.DROPBOX.S.UNABLE_TO_GENERATE_PKCE_CHALLENGE,
        type: 'ERROR',
        config: { duration: 0 }, // Stay visible until dismissed for critical setup errors
      });
      return { wasConfigured: false };
    }
    return { wasConfigured: false };
  }

  /**
   * Handle incoherent timestamps dialog with proper async error handling.
   * Uses fire-and-forget pattern but logs errors instead of swallowing them.
   */
  private _handleIncoherentTimestampsDialog(): void {
    const dialogRef = this._matDialog.open(DialogIncoherentTimestampsErrorComponent, {
      disableClose: true,
      autoFocus: false,
    });

    // Use firstValueFrom for proper async handling
    firstValueFrom(dialogRef.afterClosed())
      .then(async (res) => {
        if (res === 'FORCE_UPDATE_REMOTE') {
          await this.forceUpload();
        } else if (res === 'FORCE_UPDATE_LOCAL') {
          // Op-log architecture handles this differently
          SyncLog.log(
            'SyncWrapperService: forceDownload called (delegated to op-log sync)',
          );
        }
      })
      .catch((err) => {
        SyncLog.err('Error handling incoherent timestamps dialog result:', err);
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.DIALOG_RESULT_ERROR,
        });
      });
  }

  /**
   * Handle incomplete sync dialog with proper async error handling.
   * Uses fire-and-forget pattern but logs errors instead of swallowing them.
   */
  private _handleIncompleteSyncDialog(modelId: string | undefined): void {
    const dialogRef = this._matDialog.open(DialogIncompleteSyncComponent, {
      data: { modelId },
      disableClose: true,
      autoFocus: false,
    });

    // Use firstValueFrom for proper async handling
    firstValueFrom(dialogRef.afterClosed())
      .then(async (res) => {
        if (res === 'FORCE_UPDATE_REMOTE') {
          await this.forceUpload();
        }
      })
      .catch((err) => {
        SyncLog.err('Error handling incomplete sync dialog result:', err);
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.DIALOG_RESULT_ERROR,
        });
      });
  }

  /**
   * Safely extract modelId from error with proper type validation.
   */
  private _extractModelIdFromError(
    error: RevMismatchForModelError | NoRemoteModelFile,
  ): string | undefined {
    if (!error.additionalLog) {
      return undefined;
    }
    // Handle both array and string formats
    if (Array.isArray(error.additionalLog) && error.additionalLog.length > 0) {
      const firstItem = error.additionalLog[0];
      return typeof firstItem === 'string' ? firstItem : undefined;
    }
    if (typeof error.additionalLog === 'string') {
      return error.additionalLog;
    }
    return undefined;
  }

  /**
   * Handles missing encryption password when receiving encrypted data.
   * Opens a simple dialog to prompt for the password, then re-syncs.
   */
  private _handleMissingPasswordDialog(): void {
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
      autoFocus: false,
    });

    this._passwordDialog.afterClosed().subscribe((result) => {
      this._passwordDialog = undefined;

      if (result?.password) {
        // Password was entered and saved, re-sync
        this.sync();
      } else if (result?.forceOverwrite) {
        // Force overwrite succeeded; reflect synced status
        this._providerManager.setSyncStatus('IN_SYNC');
      } else {
        // User cancelled - set status to unknown
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
      }
    });
  }

  private _handleDecryptionError(): void {
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
      autoFocus: false,
    });

    this._passwordDialog.afterClosed().subscribe(({ isReSync, isForceUpload }) => {
      this._passwordDialog = undefined;

      if (isReSync) {
        this.sync();
      }
      if (isForceUpload) {
        this.forceUpload();
      }
      // Reset status if user cancelled without taking action
      if (!isReSync && !isForceUpload) {
        this._providerManager.setSyncStatus('UNKNOWN_OR_CHANGED');
      }
    });
  }

  /**
   * Handles LocalDataConflictError by showing a conflict resolution dialog.
   * This occurs when file-based sync (Dropbox, WebDAV) detects local unsynced
   * changes that would be lost if the remote snapshot is applied.
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
        // User chose to discard local data and download remote
        SyncLog.log(
          'SyncWrapperService: User chose USE_REMOTE - downloading remote state, discarding local',
        );
        await this._opLogSyncService.forceDownloadRemoteState(syncCapableProvider);
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

  private async _reInitAppAfterDataModelChange(
    downloadedMainModelData?: Record<string, unknown>,
  ): Promise<void> {
    SyncLog.log('Starting data re-initialization after sync...');

    try {
      await Promise.all([
        // Use reInitFromRemoteSync() which now uses the passed downloaded data
        // instead of reading from IndexedDB (entity models aren't stored there)
        this._dataInitService.reInitFromRemoteSync(downloadedMainModelData),
      ]);
      // wait an extra frame to potentially avoid follow up problems
      await promiseTimeout(SYNC_REINIT_DELAY_MS);
      SyncLog.log('Data re-initialization complete');
      // Signal that data reload is complete
    } catch (error) {
      SyncLog.err('Error during data re-initialization:', error);
      throw error;
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

  private lastConflictDialog?: MatDialogRef<any, any>;

  /**
   * Reference to any open password-related dialog (enter password or decrypt error).
   * Used to prevent multiple simultaneous password dialogs from opening.
   */
  private _passwordDialog?: MatDialogRef<any, any>;

  private _openConflictDialog$(
    conflictData: ConflictData,
  ): Observable<DialogConflictResolutionResult> {
    if (this.lastConflictDialog) {
      this.lastConflictDialog.close();
    }
    this.lastConflictDialog = this._matDialog.open(DialogSyncConflictComponent, {
      restoreFocus: true,
      autoFocus: false,
      disableClose: true,
      data: conflictData,
    });
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

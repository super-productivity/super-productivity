import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { catchError, filter, first, map, switchMap, take, timeout } from 'rxjs/operators';
import { SyncConfig } from '../../features/config/global-config.model';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import {
  AuthFailSPError,
  CanNotMigrateMajorDownError,
  ConflictData,
  DecryptError,
  DecryptNoPasswordError,
  LockPresentError,
  NoRemoteModelFile,
  PotentialCorsError,
  RevMismatchForModelError,
  SyncInvalidTimeValuesError,
  SyncProviderId,
  SyncStatus,
} from '../../pfapi/api';
import { PfapiService } from '../../pfapi/pfapi.service';
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
import { DialogIncoherentTimestampsErrorComponent } from './dialog-incoherent-timestamps-error/dialog-incoherent-timestamps-error.component';
import { SyncLog } from '../../core/log';
import { promiseTimeout } from '../../util/promise-timeout';
import { devError } from '../../util/dev-error';
import { IS_ELECTRON } from '../../app.constants';

@Injectable({
  providedIn: 'root',
})
export class SyncWrapperService {
  private _pfapiService = inject(PfapiService);
  private _globalConfigService = inject(GlobalConfigService);
  private _translateService = inject(TranslateService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);
  private _dataInitService = inject(DataInitService);
  private _reminderService = inject(ReminderService);

  syncState$ = this._pfapiService.syncState$;

  syncCfg$: Observable<SyncConfig> = this._globalConfigService.cfg$.pipe(
    map((cfg) => cfg?.sync),
  );
  syncProviderId$: Observable<SyncProviderId | null> = this.syncCfg$.pipe(
    // NOTE: types are compatible
    map((cfg) => cfg.syncProvider as unknown as SyncProviderId | null),
  );

  syncInterval$: Observable<number> = this.syncCfg$.pipe(map((cfg) => cfg.syncInterval));

  isEnabledAndReady$: Observable<boolean> =
    this._pfapiService.isSyncProviderEnabledAndReady$.pipe();

  // NOTE we don't use this._pfapiService.isSyncInProgress$ since it does not include handling and re-init view model
  private _isSyncInProgress$ = new BehaviorSubject(false);
  isSyncInProgress$ = this._isSyncInProgress$.asObservable();

  afterCurrentSyncDoneOrSyncDisabled$: Observable<unknown> = this.isEnabledAndReady$.pipe(
    switchMap((isEnabled) =>
      isEnabled
        ? this._isSyncInProgress$.pipe(
            filter((isInProgress) => !isInProgress),
            timeout(40000),
            catchError((error) => {
              devError('Sync wait timeout exceeded');
              return of(undefined);
            }),
          )
        : of(undefined),
    ),
    first(),
  );

  async sync(): Promise<SyncStatus | 'HANDLED_ERROR'> {
    this._isSyncInProgress$.next(true);
    return this._sync().finally(() => {
      this._isSyncInProgress$.next(false);
    });
  }

  private async _sync(): Promise<SyncStatus | 'HANDLED_ERROR'> {
    const providerId = await this.syncProviderId$.pipe(take(1)).toPromise();
    if (!providerId) {
      throw new Error('No Sync Provider for sync()');
    }

    try {
      const r = await this._pfapiService.pf.sync();

      switch (r.status) {
        case SyncStatus.InSync:
          return r.status;

        case SyncStatus.UpdateRemote:
        case SyncStatus.UpdateRemoteAll:
          return r.status;

        case SyncStatus.UpdateLocal:
        case SyncStatus.UpdateLocalAll:
          // Note: We can't create a backup BEFORE the sync because we don't know
          // what operation will happen until after checking with the remote.
          // The data has already been downloaded and saved to the database at this point.
          // Future improvement: modify the pfapi sync service to support pre-download callbacks.

          await this._reInitAppAfterDataModelChange();
          this._snackService.open({
            msg: T.F.SYNC.S.SUCCESS_DOWNLOAD,
            type: 'SUCCESS',
          });
          return r.status;

        case SyncStatus.NotConfigured:
          this.configuredAuthForSyncProviderIfNecessary(providerId);
          return r.status;

        case SyncStatus.IncompleteRemoteData:
          return r.status;

        case SyncStatus.Conflict:
          SyncLog.log('Sync conflict detected:', {
            remote: r.conflictData?.remote.lastUpdate,
            local: r.conflictData?.local.lastUpdate,
            lastSync: r.conflictData?.local.lastSyncedUpdate,
            conflictData: r.conflictData,
          });

          // Enhanced debugging for vector clock issues
          SyncLog.log('CONFLICT DEBUG - Vector Clock Analysis:', {
            localVectorClock: r.conflictData?.local.vectorClock,
            remoteVectorClock: r.conflictData?.remote.vectorClock,
            localLastSyncedVectorClock: r.conflictData?.local.lastSyncedVectorClock,
            conflictReason: r.conflictData?.reason,
            additional: r.conflictData?.additional,
          });
          const res = await this._openConflictDialog$(
            r.conflictData as ConflictData,
          ).toPromise();

          if (res === 'USE_LOCAL') {
            SyncLog.log('User chose USE_LOCAL, calling uploadAll(true) with force');
            // Use force upload to skip the meta file check and ensure lastUpdate is updated
            await this._pfapiService.pf.uploadAll(true);
            SyncLog.log('uploadAll(true) completed');
            return SyncStatus.UpdateRemoteAll;
          } else if (res === 'USE_REMOTE') {
            await this._pfapiService.pf.downloadAll();
            await this._reInitAppAfterDataModelChange();
          }
          SyncLog.log({ res });

          return r.status;
      }
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
      } else if (error instanceof AuthFailSPError) {
        this._snackService.open({
          msg: T.F.SYNC.S.INCOMPLETE_CFG,
          type: 'ERROR',
          actionFn: async () => this._matDialog.open(DialogSyncInitialCfgComponent),
          actionStr: T.F.SYNC.S.BTN_CONFIGURE,
        });
        return 'HANDLED_ERROR';
      } else if (error instanceof SyncInvalidTimeValuesError) {
        this._matDialog
          .open(DialogIncoherentTimestampsErrorComponent, {
            disableClose: true,
            autoFocus: false,
          })
          .afterClosed()
          .subscribe(async (res) => {
            if (res === 'FORCE_UPDATE_REMOTE') {
              await this._forceUpload();
            } else if (res === 'FORCE_UPDATE_LOCAL') {
              await this._pfapiService.pf.downloadAll();
              await this._reInitAppAfterDataModelChange();
            }
          });
        return 'HANDLED_ERROR';
      } else if (
        error instanceof RevMismatchForModelError ||
        error instanceof NoRemoteModelFile
      ) {
        SyncLog.log(error, Object.keys(error));
        const modelId =
          (error.additionalLog && error.additionalLog[0]) || error.additionalLog;

        this._matDialog
          .open(DialogIncompleteSyncComponent, {
            data: { modelId },
            disableClose: true,
            autoFocus: false,
          })
          .afterClosed()
          .subscribe((res) => {
            if (res === 'FORCE_UPDATE_REMOTE') {
              this._forceUpload();
            }
          });
        return 'HANDLED_ERROR';
      } else if (error instanceof LockPresentError) {
        this._snackService.open({
          // TODO translate
          msg: T.F.SYNC.S.ERROR_DATA_IS_CURRENTLY_WRITTEN,
          type: 'ERROR',
          actionFn: async () => this._forceUpload(),
          actionStr: T.F.SYNC.S.BTN_FORCE_OVERWRITE,
        });
        return 'HANDLED_ERROR';
      } else if (
        error instanceof DecryptNoPasswordError ||
        error instanceof DecryptError
      ) {
        this._handleDecryptionError();
        return 'HANDLED_ERROR';
      } else if (error instanceof CanNotMigrateMajorDownError) {
        alert(this._translateService.instant(T.F.SYNC.A.REMOTE_MODEL_VERSION_NEWER));
        return 'HANDLED_ERROR';
      } else if (
        (error as { message?: string })?.message === 'Sync already in progress'
      ) {
        // Silently ignore concurrent sync attempts
        SyncLog.log('Sync already in progress, skipping concurrent sync attempt');
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

  private async _forceUpload(): Promise<void> {
    if (!this._c(this._translateService.instant(T.F.SYNC.C.FORCE_UPLOAD))) {
      return;
    }
    try {
      await this._pfapiService.pf.uploadAll(true);
    } catch (e) {
      const errStr = getSyncErrorStr(e);
      this._snackService.open({
        // msg: T.F.SYNC.S.UNKNOWN_ERROR,
        msg: errStr,
        type: 'ERROR',
        translateParams: {
          err: errStr,
        },
      });
    }
  }

  async configuredAuthForSyncProviderIfNecessary(
    providerId: SyncProviderId,
  ): Promise<{ wasConfigured: boolean }> {
    const provider = await this._pfapiService.pf.getSyncProviderById(providerId);

    if (!provider) {
      return { wasConfigured: false };
    }

    if (!provider.getAuthHelper) {
      return { wasConfigured: false };
    }

    if (await provider.isReady()) {
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
          await this._pfapiService.pf.setPrivateCfgForSyncProvider(provider.id, {
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
      SyncLog.err(error);
      this._snackService.open({
        // TODO don't limit snack to dropbox
        msg: T.F.DROPBOX.S.UNABLE_TO_GENERATE_PKCE_CHALLENGE,
        type: 'ERROR',
      });
      return { wasConfigured: false };
    }
    return { wasConfigured: false };
  }

  private _handleDecryptionError(): void {
    this._matDialog
      .open(DialogHandleDecryptErrorComponent, {
        disableClose: true,
        autoFocus: false,
      })
      .afterClosed()
      .subscribe(({ isReSync, isForceUpload }) => {
        if (isReSync) {
          this.sync();
        }
        if (isForceUpload) {
          this._forceUpload();
        }
      });
  }

  private async _reInitAppAfterDataModelChange(): Promise<void> {
    SyncLog.log('Starting data re-initialization after sync...');

    try {
      await Promise.all([
        this._dataInitService.reInit(),
        this._reminderService.reloadFromDatabase(),
      ]);
      // wait an extra frame to potentially avoid follow up problems
      await promiseTimeout(100);
      SyncLog.log('Data re-initialization complete');
      // Signal that data reload is complete
    } catch (error) {
      SyncLog.err('Error during data re-initialization:', error);
      throw error;
    }
  }

  private _c(str: string): boolean {
    return confirm(this._translateService.instant(str));
  }

  private _isPermissionError(error: unknown): boolean {
    const errStr = String(error);
    return /EROFS|EACCES|EPERM|read-only file system|permission denied/i.test(errStr);
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
}

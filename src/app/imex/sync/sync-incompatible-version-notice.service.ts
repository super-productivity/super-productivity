import { inject, Injectable } from '@angular/core';
import { SnackService } from '../../core/snack/snack.service';
import {
  ClientUpdateRequiredSPError,
  SyncDataCorruptedError,
} from '../../op-log/core/errors/sync-errors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { T } from '../../t.const';

export type SyncIncompatibleVersionError =
  | SyncDataCorruptedError
  | ClientUpdateRequiredSPError;

export const isSyncIncompatibleVersionError = (
  error: unknown,
): error is SyncIncompatibleVersionError =>
  error instanceof SyncDataCorruptedError || error instanceof ClientUpdateRequiredSPError;

/**
 * Notices for a sync this app version cannot complete as it is. Neither offers
 * a force upload or signs out: the remote is healthy but newer than this build
 * (#8764), or the server requires a newer app version
 * (docs/sync-and-op-log/client-version-floor.md). Pending ops stay pending.
 */
@Injectable({ providedIn: 'root' })
export class SyncIncompatibleVersionNoticeService {
  private _providerManager = inject(SyncProviderManager);
  private _snackService = inject(SnackService);
  private _hasShownUpdateRequired = false;

  show(error: SyncIncompatibleVersionError): void {
    this._providerManager.setSyncStatus('ERROR');
    if (error instanceof ClientUpdateRequiredSPError) {
      // Every sync fails the same way until the app is updated: say it once
      // per session, like the other VERSION_TOO_OLD notices.
      if (
        !this._hasShownUpdateRequired &&
        !this._snackService.hasPendingPersistentAction()
      ) {
        this._hasShownUpdateRequired = true;
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
          actionStr: T.PS.UPDATE_APP,
          actionFn: () =>
            window.open('https://super-productivity.com/download', '_blank'),
        });
      }
      return;
    }
    // Incompatible remote format. No force-upload: it would destroy a newer one (#8764).
    this._snackService.open({
      msg: error.isRemoteNewer
        ? T.F.SYNC.S.VERSION_TOO_OLD
        : T.F.SYNC.S.ERROR_SYNC_VERSION_MISMATCH,
      type: 'ERROR',
      config: { duration: 12000 },
    });
  }
}

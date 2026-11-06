import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { T } from '../../t.const';
import { devError } from '../../util/dev-error';

/** Incoming state must hold fewer than this share of the previous tasks. */
export const SHRINK_RATIO = 0.5;
/** Below this the "shrink" is noise, not a wipe. */
export const MIN_TASKS_BEFORE = 2;

export const isSuspiciousShrink = (before: number, after: number): boolean =>
  before >= MIN_TASKS_BEFORE && after < before * SHRINK_RATIO;

/**
 * Quiet banner after a remote full-state op replaced this device's data with a
 * much smaller dataset (docs/sync-and-op-log/local-recovery-points.md). Fires
 * only on that rare event and only points at the backups list; it never
 * restores anything on its own.
 */
@Injectable({ providedIn: 'root' })
export class RecoveryPointBannerService {
  private _bannerService = inject(BannerService);
  private _matDialog = inject(MatDialog);

  showIfShrunk(tasksBefore: number, tasksAfter: number): void {
    if (!isSuspiciousShrink(tasksBefore, tasksAfter)) {
      return;
    }
    this._bannerService.open({
      id: BannerId.LocalRecoveryPoint,
      ico: 'history',
      msg: T.APP.B_RECOVERY_POINT.MSG,
      translateParams: { before: tasksBefore, after: tasksAfter },
      action: {
        label: T.APP.B_RECOVERY_POINT.BROWSE,
        fn: () => {
          this._bannerService.dismiss(BannerId.LocalRecoveryPoint);
          void this._openBackupsList().catch(devError);
        },
      },
      action2: {
        label: T.APP.B_RECOVERY_POINT.DISMISS,
        fn: () => this._bannerService.dismiss(BannerId.LocalRecoveryPoint),
      },
      isHideDismissBtn: true,
    });
  }

  private async _openBackupsList(): Promise<void> {
    const { DialogBackupsListComponent } =
      await import('./dialog-backups-list/dialog-backups-list.component');
    this._matDialog.open(DialogBackupsListComponent, { restoreFocus: true });
  }
}

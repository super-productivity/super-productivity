import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { UserInputWaitStateService } from '../../imex/sync/user-input-wait-state.service';
import {
  DialogSyncImportConflictComponent,
  SyncImportConflictData,
  SyncImportConflictResolution,
} from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';

/**
 * Service to show the sync import conflict dialog when all remote operations
 * are filtered due to a local SYNC_IMPORT.
 *
 * This happens when a user imports/restores data locally, and other devices
 * have been creating changes without knowledge of that import.
 */
@Injectable({ providedIn: 'root' })
export class SyncImportConflictDialogService {
  private _matDialog = inject(MatDialog);
  private _userInputWaitState = inject(UserInputWaitStateService);

  /**
   * Shows the sync import conflict dialog and waits for user resolution.
   *
   * @param data Information about the conflict (filtered op count, import timestamp, etc.)
   * @returns The user's chosen resolution: USE_LOCAL, USE_REMOTE, or CANCEL
   */
  async showConflictDialog(
    data: SyncImportConflictData,
  ): Promise<SyncImportConflictResolution> {
    const stopWaiting = this._userInputWaitState.startWaiting('sync-import-conflict');

    try {
      const dialogRef = this._matDialog.open(DialogSyncImportConflictComponent, {
        data,
        disableClose: true,
        restoreFocus: true,
        autoFocus: false,
      });

      const result = await firstValueFrom(dialogRef.afterClosed());
      return result || 'CANCEL';
    } finally {
      stopWaiting();
    }
  }
}

import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { ConflictUiDialogRequest, ConflictUiPort } from '@sp/sync-core';
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
export class SyncImportConflictDialogService implements ConflictUiPort<SyncImportConflictResolution> {
  private _matDialog = inject(MatDialog);
  private _userInputWaitState = inject(UserInputWaitStateService);

  /**
   * Shows the sync import conflict dialog and waits for user resolution.
   *
   * @param data Information about the conflict (filtered op count, import timestamp, etc.)
   * @returns The user's chosen resolution: USE_LOCAL, USE_REMOTE, or CANCEL
   */
  async showConflictDialog(
    data: SyncImportConflictData | ConflictUiDialogRequest,
  ): Promise<SyncImportConflictResolution> {
    const dialogData = isSyncImportConflictData(data)
      ? data
      : toSyncImportConflictData(data);
    const stopWaiting = this._userInputWaitState.startWaiting('sync-import-conflict');

    try {
      const dialogRef = this._matDialog.open(DialogSyncImportConflictComponent, {
        data: dialogData,
        disableClose: true,
        restoreFocus: true,
      });

      const result = await firstValueFrom(dialogRef.afterClosed());
      return result || 'CANCEL';
    } finally {
      stopWaiting();
    }
  }
}

const isSyncImportConflictData = (
  data: SyncImportConflictData | ConflictUiDialogRequest,
): data is SyncImportConflictData =>
  'filteredOpCount' in data && 'localImportTimestamp' in data;

const toSyncImportConflictData = (
  request: ConflictUiDialogRequest,
): SyncImportConflictData => {
  if (request.conflictType !== 'sync-import') {
    throw new Error(`Unsupported conflict dialog type: ${request.conflictType}`);
  }

  const scenario = request.scenario;
  if (scenario !== 'INCOMING_IMPORT' && scenario !== 'LOCAL_IMPORT_FILTERS_REMOTE') {
    throw new Error(`Unsupported sync import conflict scenario: ${String(scenario)}`);
  }

  const filteredOpCount = request.counts?.filteredOpCount;
  if (typeof filteredOpCount !== 'number') {
    throw new Error('Sync import conflict requires counts.filteredOpCount');
  }

  const localImportTimestamp = request.timestamps?.localImportTimestamp;
  if (typeof localImportTimestamp !== 'number') {
    throw new Error('Sync import conflict requires timestamps.localImportTimestamp');
  }

  return {
    filteredOpCount,
    localImportTimestamp,
    syncImportReason: request.reason as SyncImportConflictData['syncImportReason'],
    scenario,
  };
};

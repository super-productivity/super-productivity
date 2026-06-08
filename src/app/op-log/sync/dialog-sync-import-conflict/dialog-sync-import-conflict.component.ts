import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';
import type { SyncImportReason } from '../../core/operation.types';
import { confirmDialog } from '../../../util/native-dialogs';

export interface SyncImportConflictData {
  filteredOpCount: number;
  localImportTimestamp: number;
  syncImportReason?: SyncImportReason;
  scenario: 'INCOMING_IMPORT' | 'LOCAL_IMPORT_FILTERS_REMOTE';
  /**
   * True when this client has never completed a sync. Its only local state is
   * pre-first-sync startup data (e.g. example tasks), so "USE_LOCAL" would overwrite
   * a populated remote with throwaway data — a destructive choice that warrants an
   * explicit extra confirmation. See the fresh-client first-sync data-loss-trap plan.
   */
  isNeverSynced?: boolean;
}

export type SyncImportConflictResolution = 'USE_LOCAL' | 'USE_REMOTE' | 'CANCEL';

@Component({
  selector: 'dialog-sync-import-conflict',
  templateUrl: './dialog-sync-import-conflict.component.html',
  styleUrls: ['./dialog-sync-import-conflict.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    LocaleDatePipe,
    ShortTimePipe,
  ],
})
export class DialogSyncImportConflictComponent {
  private _matDialogRef =
    inject<MatDialogRef<DialogSyncImportConflictComponent>>(MatDialogRef);
  private _translateService = inject(TranslateService);
  data = inject<SyncImportConflictData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  private static readonly _REASON_KEYS: Record<string, string> = {
    PASSWORD_CHANGED: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_PASSWORD_CHANGED,
    FILE_IMPORT: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_FILE_IMPORT,
    BACKUP_RESTORE: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_BACKUP_RESTORE,
    FORCE_UPLOAD: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_FORCE_UPLOAD,
    SERVER_MIGRATION: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_SERVER_MIGRATION,
    REPAIR: T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_REPAIR,
  };

  get reasonKey(): string {
    const reason = this.data.syncImportReason;
    return (
      (reason && DialogSyncImportConflictComponent._REASON_KEYS[reason]) ||
      T.F.SYNC.D_SYNC_IMPORT_CONFLICT.REASON_UNKNOWN
    );
  }

  get messageKey(): string {
    if (this.data.scenario === 'INCOMING_IMPORT') {
      return this.data.filteredOpCount > 0
        ? T.F.SYNC.D_SYNC_IMPORT_CONFLICT.MSG_INCOMING
        : T.F.SYNC.D_SYNC_IMPORT_CONFLICT.MSG_INCOMING_NO_OPS;
    }
    return T.F.SYNC.D_SYNC_IMPORT_CONFLICT.MSG_LOCAL_FILTERS;
  }

  get isIncomingImport(): boolean {
    return this.data.scenario === 'INCOMING_IMPORT';
  }

  get isNeverSynced(): boolean {
    return !!this.data.isNeverSynced;
  }

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  close(result?: SyncImportConflictResolution): void {
    // Guard the destructive choice on a never-synced client: USE_LOCAL here would
    // overwrite the populated remote with this device's throwaway startup data.
    // Require an explicit confirmation so it can't be triggered by a misclick.
    if (result === 'USE_LOCAL' && this.isNeverSynced) {
      const confirmed = confirmDialog(
        this._translateService.instant(
          T.F.SYNC.D_SYNC_IMPORT_CONFLICT.FIRST_SYNC_USE_LOCAL_CONFIRM,
        ),
      );
      if (!confirmed) {
        return;
      }
    }
    // Guard the destructive choice when it discards local work: accepting the
    // server import (USE_REMOTE) replaces this device's state and drops pending
    // local changes. The dialog frames the server as "recommended", so require
    // an explicit confirmation rather than letting a misclick silently wipe data
    // the user can't tell is newer than the server's. (#8107)
    if (
      result === 'USE_REMOTE' &&
      this.isIncomingImport &&
      this.data.filteredOpCount > 0
    ) {
      const confirmed = confirmDialog(
        this._translateService.instant(
          T.F.SYNC.D_SYNC_IMPORT_CONFLICT.USE_REMOTE_CONFIRM,
          { count: this.data.filteredOpCount },
        ),
      );
      if (!confirmed) {
        return;
      }
    }
    this._matDialogRef.close(result || 'CANCEL');
  }
}

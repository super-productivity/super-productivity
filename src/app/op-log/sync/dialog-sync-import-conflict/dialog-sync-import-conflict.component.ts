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
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';
import type { SyncImportReason } from '../../core/operation.types';

export interface SyncImportConflictData {
  filteredOpCount: number;
  localImportTimestamp: number;
  syncImportReason?: SyncImportReason;
  scenario: 'INCOMING_IMPORT' | 'LOCAL_IMPORT_FILTERS_REMOTE';
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

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  close(result?: SyncImportConflictResolution): void {
    this._matDialogRef.close(result || 'CANCEL');
  }
}

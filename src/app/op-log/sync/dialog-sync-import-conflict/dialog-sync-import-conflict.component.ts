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

export interface SyncImportConflictData {
  filteredOpCount: number;
  localImportTimestamp: number;
  localImportClientId: string;
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

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  close(result?: SyncImportConflictResolution): void {
    this._matDialogRef.close(result || 'CANCEL');
  }
}

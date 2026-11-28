import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

export interface DialogSyncFinishedData {
  taskCount: number;
}

/** "Sync is on": the last step of signing in (1e/2d, mockups v3). */
@Component({
  selector: 'dialog-sync-finished',
  templateUrl: './dialog-sync-finished.component.html',
  styleUrls: ['./dialog-sync-finished.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogSyncFinishedComponent {
  readonly data = inject<DialogSyncFinishedData>(MAT_DIALOG_DATA);
  readonly T = T;
}

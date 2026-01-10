import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { BoardEditComponent } from '../board-edit/board-edit.component';
import { BoardCfg } from '../boards.model';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

@Component({
  selector: 'dialog-board-edit',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    BoardEditComponent,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
  templateUrl: './dialog-board-edit.component.html',
  styleUrl: './dialog-board-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogBoardEditComponent {
  private _matDialogRef = inject<MatDialogRef<DialogBoardEditComponent>>(MatDialogRef);
  private _matDialog = inject(MatDialog);

  data = inject<{
    board: BoardCfg;
  }>(MAT_DIALOG_DATA);
  boarEditCmp = viewChild('boarEditCmp', { read: BoardEditComponent });

  close(): void {
    this._matDialogRef.close();
  }

  protected readonly T = T;

  removeBoard(): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          cancelTxt: T.G.CANCEL,
          okTxt: T.G.DELETE,
          message: T.F.BOARDS.V.CONFIRM_DELETE,
        },
      })
      .afterClosed()
      .subscribe((isConfirm: boolean) => {
        if (isConfirm) {
          this.boarEditCmp()?.removeBoard();
          this.close();
        }
      });
  }

  save(): void {
    this.boarEditCmp()?.save();
    this.close();
  }
}

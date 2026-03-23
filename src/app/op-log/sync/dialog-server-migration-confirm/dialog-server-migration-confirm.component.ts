import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

@Component({
  selector: 'dialog-server-migration-confirm',
  templateUrl: './dialog-server-migration-confirm.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogServerMigrationConfirmComponent {
  private _matDialogRef =
    inject<MatDialogRef<DialogServerMigrationConfirmComponent>>(MatDialogRef);

  T: typeof T = T;

  constructor() {
    this._matDialogRef.disableClose = true;
  }

  close(confirmed: boolean): void {
    this._matDialogRef.close(confirmed);
  }
}

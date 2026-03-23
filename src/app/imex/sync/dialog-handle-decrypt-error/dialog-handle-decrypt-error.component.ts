import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SyncConfigService } from '../sync-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncLog } from '../../../core/log';

@Component({
  selector: 'dialog-handle-decrypt-error',
  templateUrl: './dialog-handle-decrypt-error.component.html',
  styleUrls: ['./dialog-handle-decrypt-error.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogHandleDecryptErrorComponent {
  private _syncConfigService = inject(SyncConfigService);
  private _snackService = inject(SnackService);

  private _matDialogRef =
    inject<MatDialogRef<DialogHandleDecryptErrorComponent>>(MatDialogRef);

  T: typeof T = T;
  passwordVal: string = '';

  async updatePWAndForceUpload(): Promise<void> {
    try {
      await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
      this.passwordVal = '';
      this._matDialogRef.close({ isForceUpload: true });
    } catch (error) {
      SyncLog.err('Failed to save encryption password for force upload', error);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.PERSIST_FAILED,
      });
    }
  }

  async updatePwAndResync(): Promise<void> {
    try {
      await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
      this.passwordVal = '';
      this._matDialogRef.close({ isReSync: true });
    } catch (error) {
      SyncLog.err('Failed to save encryption password for resync', error);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.PERSIST_FAILED,
      });
    }
  }

  cancel(): void {
    this.passwordVal = '';
    this._matDialogRef.close({});
  }
}

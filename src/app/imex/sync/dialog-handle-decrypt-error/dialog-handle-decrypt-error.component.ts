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

/**
 * Shown when remote data cannot be decrypted. It deliberately offers no way to
 * overwrite the server (#9256): a failed decrypt cannot tell a wrong password
 * from a corrupt op or one under another key, and after a kept decrypted prefix
 * this device may hold only part of the data. Replacing the server stays a
 * deliberate action in Settings (Force Overwrite / Change Password).
 */
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

  async updatePwAndResync(): Promise<void> {
    // The template's formEl.valid gate is vacuous (the input has no validators),
    // so guard here: an empty submit would persist encryptKey '' with
    // isEncryptionEnabled true — fail-closed but a pointless broken state.
    if (!this.passwordVal) {
      return;
    }
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

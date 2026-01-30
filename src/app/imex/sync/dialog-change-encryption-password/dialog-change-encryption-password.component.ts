import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatFormField, MatLabel, MatError } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EncryptionPasswordChangeService } from '../encryption-password-change.service';
import { EncryptionDisableService } from '../encryption-disable.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import { FileBasedEncryptionService } from '../file-based-encryption.service';

export interface ChangeEncryptionPasswordResult {
  success: boolean;
  encryptionRemoved?: boolean;
}

export interface ChangeEncryptionPasswordDialogData {
  mode?: 'full' | 'disable-only';
  /**
   * Type of sync provider. Determines which disable method to call.
   * - 'supersync': Uses disableEncryption() (deletes server data + uploads)
   * - 'file-based': Uses disableEncryptionForFileBased() (just uploads unencrypted)
   */
  providerType?: 'supersync' | 'file-based';
}

@Component({
  selector: 'dialog-change-encryption-password',
  templateUrl: './dialog-change-encryption-password.component.html',
  styleUrls: ['./dialog-change-encryption-password.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatProgressSpinner,
    MatDivider,
  ],
})
export class DialogChangeEncryptionPasswordComponent {
  private _encryptionPasswordChangeService = inject(EncryptionPasswordChangeService);
  private _fileBasedEncryptionService = inject(FileBasedEncryptionService);
  private _encryptionDisableService = inject(EncryptionDisableService);
  private _snackService = inject(SnackService);
  private _matDialogRef =
    inject<
      MatDialogRef<
        DialogChangeEncryptionPasswordComponent,
        ChangeEncryptionPasswordResult
      >
    >(MatDialogRef);
  private _data = inject<ChangeEncryptionPasswordDialogData | null>(MAT_DIALOG_DATA, {
    optional: true,
  });

  T: typeof T = T;
  newPassword = '';
  confirmPassword = '';
  isLoading = signal(false);
  isRemovingEncryption = signal(false);
  mode: 'full' | 'disable-only' = this._data?.mode || 'full';
  providerType: 'supersync' | 'file-based' = this._data?.providerType || 'supersync';
  textKeys: Record<string, string> =
    this.providerType === 'file-based'
      ? T.F.SYNC.FORM.FILE_BASED
      : T.F.SYNC.FORM.SUPER_SYNC;

  get passwordsMatch(): boolean {
    return this.newPassword === this.confirmPassword;
  }

  get isValid(): boolean {
    return this.newPassword.length >= 8 && this.passwordsMatch;
  }

  async confirm(): Promise<void> {
    if (!this.isValid || this.isLoading()) {
      return;
    }

    this.isLoading.set(true);

    try {
      if (this.providerType === 'file-based') {
        await this._fileBasedEncryptionService.changePassword(this.newPassword);
      } else {
        // Always allow unsynced ops since password change does a clean slate + overwrite anyway
        await this._encryptionPasswordChangeService.changePassword(this.newPassword, {
          allowUnsyncedOps: true,
        });
      }
      this._snackService.open({
        type: 'SUCCESS',
        msg: this.textKeys.CHANGE_PASSWORD_SUCCESS,
      });
      this._matDialogRef.close({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to change password: ${message}`,
      });
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this._matDialogRef.close({ success: false });
  }

  async removeEncryption(): Promise<void> {
    if (this.isLoading() || this.isRemovingEncryption()) {
      return;
    }

    this.isRemovingEncryption.set(true);

    try {
      // Call appropriate disable method based on provider type
      if (this.providerType === 'file-based') {
        await this._encryptionDisableService.disableEncryptionForFileBased();
      } else {
        await this._encryptionDisableService.disableEncryption();
      }
      this._snackService.open({
        type: 'SUCCESS',
        msg: this.textKeys.DISABLE_ENCRYPTION_SUCCESS,
      });
      this._matDialogRef.close({ success: true, encryptionRemoved: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to disable encryption: ${message}`,
      });
      this.isRemovingEncryption.set(false);
    }
  }
}

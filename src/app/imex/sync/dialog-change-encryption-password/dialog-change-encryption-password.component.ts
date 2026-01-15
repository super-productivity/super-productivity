import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
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
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

export interface ChangeEncryptionPasswordResult {
  success: boolean;
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
  ],
})
export class DialogChangeEncryptionPasswordComponent {
  private _encryptionPasswordChangeService = inject(EncryptionPasswordChangeService);
  private _snackService = inject(SnackService);
  private _matDialogRef =
    inject<
      MatDialogRef<
        DialogChangeEncryptionPasswordComponent,
        ChangeEncryptionPasswordResult
      >
    >(MatDialogRef);

  T: typeof T = T;
  newPassword = '';
  confirmPassword = '';
  isLoading = signal(false);

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
      await this._encryptionPasswordChangeService.changePassword(this.newPassword);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.FORM.SUPER_SYNC.CHANGE_PASSWORD_SUCCESS,
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
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EncryptionEnableService } from '../encryption-enable.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { isFileBasedProvider } from '../../../op-log/sync/operation-sync.util';
import { FileBasedEncryptionService } from '../file-based-encryption.service';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

export interface EnableEncryptionDialogData {
  encryptKey?: string;
  providerType?: 'supersync' | 'file-based';
}

export interface EnableEncryptionResult {
  success: boolean;
}

@Component({
  selector: 'dialog-enable-encryption',
  templateUrl: './dialog-enable-encryption.component.html',
  styleUrls: ['./dialog-enable-encryption.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatProgressSpinner,
    FormsModule,
    MatFormField,
    MatLabel,
    MatInput,
  ],
})
export class DialogEnableEncryptionComponent {
  private _encryptionEnableService = inject(EncryptionEnableService);
  private _fileBasedEncryptionService = inject(FileBasedEncryptionService);
  private _snackService = inject(SnackService);
  private _providerManager = inject(SyncProviderManager);
  private _data = inject<EnableEncryptionDialogData | null>(MAT_DIALOG_DATA, {
    optional: true,
  });
  private _matDialogRef =
    inject<MatDialogRef<DialogEnableEncryptionComponent, EnableEncryptionResult>>(
      MatDialogRef,
    );

  T: typeof T = T;
  isLoading = signal(false);
  canProceed = signal(true);
  errorReason = signal<string | null>(null);
  providerType: 'supersync' | 'file-based' = this._data?.providerType || 'supersync';
  textKeys: Record<string, string> =
    this.providerType === 'file-based'
      ? T.F.SYNC.FORM.FILE_BASED
      : T.F.SYNC.FORM.SUPER_SYNC;

  // Password fields for the dialog
  password = '';
  confirmPassword = '';

  // Minimum password length requirement
  readonly MIN_PASSWORD_LENGTH = 8;

  constructor() {
    this._checkPreconditions();
  }

  get isPasswordValid(): boolean {
    return (
      this.password.length >= this.MIN_PASSWORD_LENGTH &&
      this.password === this.confirmPassword
    );
  }

  get passwordError(): string | null {
    if (this.password && this.password.length < this.MIN_PASSWORD_LENGTH) {
      return this.textKeys.PASSWORD_MIN_LENGTH;
    }
    if (this.confirmPassword && this.password !== this.confirmPassword) {
      return this.textKeys.PASSWORDS_DONT_MATCH;
    }
    return null;
  }

  private _checkPreconditions(): void {
    const provider = this._providerManager.getActiveProvider();

    if (!provider) {
      this.canProceed.set(false);
      this.errorReason.set(this.textKeys.ENABLE_ENCRYPTION_NOT_READY);
      return;
    }

    if (this.providerType === 'supersync') {
      if (provider.id !== SyncProviderId.SuperSync) {
        this.canProceed.set(false);
        this.errorReason.set(this.textKeys.ENABLE_ENCRYPTION_SUPERSYNC_ONLY);
        return;
      }
    } else if (!isFileBasedProvider(provider)) {
      this.canProceed.set(false);
      this.errorReason.set(this.textKeys.ENABLE_ENCRYPTION_FILE_BASED_ONLY);
      return;
    }
  }

  async confirm(): Promise<void> {
    if (this.isLoading() || !this.canProceed() || !this.isPasswordValid) {
      return;
    }

    this.isLoading.set(true);

    try {
      if (this.providerType === 'file-based') {
        await this._fileBasedEncryptionService.enableEncryption(this.password);
      } else {
        await this._encryptionEnableService.enableEncryption(this.password);
      }
      this._snackService.open({
        type: 'SUCCESS',
        msg: this.textKeys.ENABLE_ENCRYPTION_SUCCESS,
      });
      this._matDialogRef.close({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to enable encryption: ${message}`,
      });
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this._matDialogRef.close({ success: false });
  }
}

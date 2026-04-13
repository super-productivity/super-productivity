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
import { SuperSyncEncryptionToggleService } from '../supersync-encryption-toggle.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { isFileBasedProvider } from '../../../op-log/sync/operation-sync.util';
import { FileBasedEncryptionService } from '../file-based-encryption.service';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIconButton } from '@angular/material/button';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { PasswordStrengthComponent } from '../../../ui/password-strength/password-strength.component';

export interface EnableEncryptionDialogData {
  encryptKey?: string;
  providerType?: 'supersync' | 'file-based';
  initialSetup?: boolean;
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
    MatSuffix,
    MatIconButton,
    PasswordStrengthComponent,
  ],
})
export class DialogEnableEncryptionComponent {
  private _encryptionToggleService = inject(SuperSyncEncryptionToggleService);
  private _fileBasedEncryptionService = inject(FileBasedEncryptionService);
  private _snackService = inject(SnackService);
  private _providerManager = inject(SyncProviderManager);
  private _syncWrapperService = inject(SyncWrapperService);
  private _globalConfigService = inject(GlobalConfigService);
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
  showPassword = signal(false);
  initialSetup: boolean = this._data?.initialSetup || false;
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
    if (!this.initialSetup) {
      this._checkPreconditions();
    }
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
        await this._syncWrapperService.runWithSyncBlocked(() =>
          this._fileBasedEncryptionService.enableEncryption(this.password),
        );
      } else {
        await this._syncWrapperService.runWithSyncBlocked(() =>
          this._encryptionToggleService.enableEncryption(this.password),
        );
      }
      this.password = '';
      this.confirmPassword = '';
      this._snackService.open({
        type: 'SUCCESS',
        msg: this.textKeys.ENABLE_ENCRYPTION_SUCCESS,
      });
      this._matDialogRef.close({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.ENABLE_ENCRYPTION_FAILED,
        translateParams: { message },
      });
      this.isLoading.set(false);
    }
  }

  disableSuperSync(): void {
    this._globalConfigService.updateSection('sync', { isEnabled: false });
    this._matDialogRef.close({ success: false });
  }

  cancel(): void {
    this._matDialogRef.close({ success: false });
  }
}

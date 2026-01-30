import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
  MatDialog,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SyncConfigService } from '../sync-config.service';
import { EncryptionPasswordChangeService } from '../encryption-password-change.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SyncLog } from '../../../core/log';

export interface EnterEncryptionPasswordResult {
  password?: string;
  forceOverwrite?: boolean;
}

@Component({
  selector: 'dialog-enter-encryption-password',
  templateUrl: './dialog-enter-encryption-password.component.html',
  styleUrls: ['./dialog-enter-encryption-password.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
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
export class DialogEnterEncryptionPasswordComponent {
  private _syncConfigService = inject(SyncConfigService);
  private _encryptionPasswordChangeService = inject(EncryptionPasswordChangeService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);
  private _providerManager = inject(SyncProviderManager);
  private _matDialogRef =
    inject<
      MatDialogRef<DialogEnterEncryptionPasswordComponent, EnterEncryptionPasswordResult>
    >(MatDialogRef);

  T: typeof T = T;
  passwordVal: string = '';
  isLoading = signal(false);
  isSuperSync = signal(false);

  constructor() {
    this.isSuperSync.set(
      this._providerManager.getActiveProvider()?.id === SyncProviderId.SuperSync,
    );
  }

  async saveAndSync(): Promise<void> {
    if (!this.passwordVal || this.isLoading()) {
      return;
    }
    this.isLoading.set(true);
    try {
      await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
      this._matDialogRef.close({ password: this.passwordVal });
    } catch (error) {
      SyncLog.err('Failed to save encryption password', error);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.PERSIST_FAILED,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  async forceOverwrite(): Promise<void> {
    if (!this.passwordVal || this.isLoading()) {
      return;
    }

    const confirmed = await this._matDialog
      .open(DialogConfirmComponent, {
        data: {
          title: T.F.SYNC.D_ENTER_PASSWORD.FORCE_OVERWRITE_TITLE,
          message: T.F.SYNC.D_ENTER_PASSWORD.FORCE_OVERWRITE_CONFIRM,
          okTxt: T.F.SYNC.D_ENTER_PASSWORD.BTN_FORCE_OVERWRITE,
        },
      })
      .afterClosed()
      .toPromise();

    if (!confirmed) {
      return;
    }

    this.isLoading.set(true);
    try {
      await this._encryptionPasswordChangeService.changePassword(this.passwordVal, {
        allowUnsyncedOps: true,
      });
      this._matDialogRef.close({ forceOverwrite: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to overwrite server data: ${message}`,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    if (this.isLoading()) {
      return;
    }
    this._matDialogRef.close({});
  }
}

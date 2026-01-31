import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EncryptionDisableService } from '../encryption-disable.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';

export interface DisableEncryptionResult {
  success: boolean;
}

@Component({
  selector: 'dialog-disable-encryption',
  templateUrl: './dialog-disable-encryption.component.html',
  styleUrls: ['./dialog-disable-encryption.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatProgressSpinner,
  ],
})
export class DialogDisableEncryptionComponent {
  private _encryptionDisableService = inject(EncryptionDisableService);
  private _snackService = inject(SnackService);
  private _providerManager = inject(SyncProviderManager);
  private _matDialogRef =
    inject<MatDialogRef<DialogDisableEncryptionComponent, DisableEncryptionResult>>(
      MatDialogRef,
    );

  T: typeof T = T;
  isLoading = signal(false);
  canProceed = signal(true);
  errorReason = signal<string | null>(null);

  constructor() {
    this._checkPreconditions();
  }

  private _checkPreconditions(): void {
    const provider = this._providerManager.getActiveProvider();

    if (!provider) {
      this.canProceed.set(false);
      this.errorReason.set(T.F.SYNC.FORM.SUPER_SYNC.DISABLE_ENCRYPTION_NOT_READY);
      return;
    }

    if (provider.id !== SyncProviderId.SuperSync) {
      this.canProceed.set(false);
      this.errorReason.set(T.F.SYNC.FORM.SUPER_SYNC.DISABLE_ENCRYPTION_SUPERSYNC_ONLY);
      return;
    }
  }

  async confirm(): Promise<void> {
    if (this.isLoading() || !this.canProceed()) {
      return;
    }

    this.isLoading.set(true);

    try {
      await this._encryptionDisableService.disableEncryption();
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.FORM.SUPER_SYNC.DISABLE_ENCRYPTION_SUCCESS,
      });
      this._matDialogRef.close({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to disable encryption: ${message}`,
      });
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this._matDialogRef.close({ success: false });
  }
}

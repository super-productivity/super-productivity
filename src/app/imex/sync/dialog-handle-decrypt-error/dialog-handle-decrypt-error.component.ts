import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
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
import { confirmDialog } from '../../../util/native-dialogs';
import { SyncLocalStateService } from '../../../op-log/sync/sync-local-state.service';

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
  private _translateService = inject(TranslateService);
  private _syncLocalStateService = inject(SyncLocalStateService);

  private _matDialogRef =
    inject<MatDialogRef<DialogHandleDecryptErrorComponent>>(MatDialogRef);

  T: typeof T = T;
  passwordVal: string = '';
  isForceUploadPending = signal(false);

  async updatePWAndForceUpload(): Promise<void> {
    // The guard below awaits, so a second click could otherwise start a second
    // pass and open two confirms — i.e. two clean slates. A signal, not a plain
    // field, because the button's [disabled] binding reads it under OnPush.
    if (this.isForceUploadPending()) {
      return;
    }
    this.isForceUploadPending.set(true);
    try {
      await this._forceUploadFlow();
    } catch (error) {
      // Reading local state can fail (e.g. the archive DB read behind the
      // guard). Without this the rejection would be swallowed by the click
      // handler and the user would see nothing happen at all.
      SyncLog.err('Failed to evaluate the force-upload guard', error);
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.SYNC.S.OVERWRITE_SERVER_FAILED,
        translateParams: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } finally {
      this.isForceUploadPending.set(false);
    }
  }

  private async _forceUploadFlow(): Promise<void> {
    // #9256: this dialog is shown to a client that failed to DOWNLOAD, so the
    // one offered alternative to retrying the password destroys the server copy
    // via a clean-slate SYNC_IMPORT. Refuse when there is nothing here to put
    // in its place — the user is trying to recover data, not discard it.
    if (await this._syncLocalStateService.hasNothingWorthUploading()) {
      this._syncLocalStateService.warnNothingWorthUploading();
      return;
    }
    if (!confirmDialog(this._translateService.instant(T.F.SYNC.C.DECRYPT_OVERWRITE))) {
      return;
    }
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

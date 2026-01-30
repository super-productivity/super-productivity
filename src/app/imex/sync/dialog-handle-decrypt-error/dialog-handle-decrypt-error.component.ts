import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SyncConfigService } from '../sync-config.service';

@Component({
  selector: 'dialog-handle-decrypt-error',
  templateUrl: './dialog-handle-decrypt-error.component.html',
  styleUrls: ['./dialog-handle-decrypt-error.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
export class DialogHandleDecryptErrorComponent {
  private _syncConfigService = inject(SyncConfigService);

  private _matDialogRef =
    inject<MatDialogRef<DialogHandleDecryptErrorComponent>>(MatDialogRef);

  T: typeof T = T;
  passwordVal: string = '';

  async updatePWAndForceUpload(): Promise<void> {
    await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
    this._matDialogRef.close({ isForceUpload: true });
  }

  async updatePwAndResync(): Promise<void> {
    await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
    this._matDialogRef.close({ isReSync: true });
  }

  cancel(): void {
    this._matDialogRef.close({});
  }
}

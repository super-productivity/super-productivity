import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

export interface ImportEncryptionWarningData {
  currentEncryptionEnabled: boolean;
  importedEncryptionEnabled: boolean;
}

export interface ImportEncryptionWarningResult {
  confirmed: boolean;
}

/**
 * Dialog component to warn users when importing a backup that has different
 * encryption settings than their current sync configuration.
 *
 * This dialog is shown BEFORE the import proceeds to give users a chance to
 * understand the consequences:
 * - All server data will be deleted
 * - Sync history will be lost
 * - All devices will need to resync
 */
@Component({
  selector: 'dialog-import-encryption-warning',
  templateUrl: './dialog-import-encryption-warning.component.html',
  styleUrls: ['./dialog-import-encryption-warning.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogImportEncryptionWarningComponent {
  private _matDialogRef =
    inject<
      MatDialogRef<DialogImportEncryptionWarningComponent, ImportEncryptionWarningResult>
    >(MatDialogRef);
  private _data = inject<ImportEncryptionWarningData>(MAT_DIALOG_DATA);

  T: typeof T = T;

  get currentEncryptionEnabled(): boolean {
    return this._data.currentEncryptionEnabled;
  }

  get importedEncryptionEnabled(): boolean {
    return this._data.importedEncryptionEnabled;
  }

  get isEnablingEncryption(): boolean {
    return !this._data.currentEncryptionEnabled && this._data.importedEncryptionEnabled;
  }

  get isDisablingEncryption(): boolean {
    return this._data.currentEncryptionEnabled && !this._data.importedEncryptionEnabled;
  }

  confirm(): void {
    this._matDialogRef.close({ confirmed: true });
  }

  cancel(): void {
    this._matDialogRef.close({ confirmed: false });
  }
}

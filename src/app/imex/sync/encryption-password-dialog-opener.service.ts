import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  DialogChangeEncryptionPasswordComponent,
  ChangeEncryptionPasswordResult,
} from './dialog-change-encryption-password/dialog-change-encryption-password.component';

/**
 * Singleton service to open the encryption password change dialog.
 * Used by the sync form config which doesn't have direct access to injector.
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordDialogOpenerService {
  private _matDialog = inject(MatDialog);

  openChangePasswordDialog(): Promise<ChangeEncryptionPasswordResult | undefined> {
    const dialogRef = this._matDialog.open(DialogChangeEncryptionPasswordComponent, {
      width: '400px',
      disableClose: true,
    });

    return dialogRef.afterClosed().toPromise();
  }
}

/**
 * Module-level reference to the dialog opener service.
 * Initialized by EncryptionPasswordDialogOpenerInitService.
 */
let dialogOpenerInstance: EncryptionPasswordDialogOpenerService | null = null;

/**
 * Sets the dialog opener instance. Called during app initialization.
 */
export const setDialogOpenerInstance = (
  instance: EncryptionPasswordDialogOpenerService,
): void => {
  dialogOpenerInstance = instance;
};

/**
 * Opens the encryption password change dialog.
 * Can be called from form config onClick handlers.
 */
export const openEncryptionPasswordChangeDialog = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openChangePasswordDialog();
};

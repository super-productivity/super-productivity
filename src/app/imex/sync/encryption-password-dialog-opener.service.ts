import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  DialogChangeEncryptionPasswordComponent,
  ChangeEncryptionPasswordResult,
  ChangeEncryptionPasswordDialogData,
} from './dialog-change-encryption-password/dialog-change-encryption-password.component';
import {
  DialogEnableEncryptionComponent,
  EnableEncryptionDialogData,
  EnableEncryptionResult,
} from './dialog-enable-encryption/dialog-enable-encryption.component';

/**
 * Singleton service to open the encryption password change dialog.
 * Used by the sync form config which doesn't have direct access to injector.
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordDialogOpenerService {
  private _matDialog = inject(MatDialog);

  /**
   * Closes all open dialogs. Useful after disabling encryption
   * to close the parent settings dialog.
   */
  closeAllDialogs(): void {
    this._matDialog.closeAll();
  }

  openChangePasswordDialog(
    mode: 'full' | 'disable-only' = 'full',
    providerType: 'supersync' | 'file-based' = 'supersync',
  ): Promise<ChangeEncryptionPasswordResult | undefined> {
    const dialogRef = this._matDialog.open(DialogChangeEncryptionPasswordComponent, {
      width: mode === 'disable-only' ? '450px' : '400px',
      disableClose: true,
      data: { mode, providerType } as ChangeEncryptionPasswordDialogData,
    });

    return dialogRef.afterClosed().toPromise();
  }

  /**
   * Opens the unified change password dialog in disable-only mode.
   * @deprecated Use openChangePasswordDialog('disable-only') instead
   */
  openDisableEncryptionDialog(
    providerType: 'supersync' | 'file-based' = 'supersync',
  ): Promise<ChangeEncryptionPasswordResult | undefined> {
    return this.openChangePasswordDialog('disable-only', providerType);
  }

  /**
   * Opens the disable encryption dialog for file-based providers.
   */
  openDisableEncryptionDialogForFileBased(): Promise<
    ChangeEncryptionPasswordResult | undefined
  > {
    return this.openChangePasswordDialog('disable-only', 'file-based');
  }

  openChangePasswordDialogForFileBased(): Promise<
    ChangeEncryptionPasswordResult | undefined
  > {
    return this.openChangePasswordDialog('full', 'file-based');
  }

  openEnableEncryptionDialog(): Promise<EnableEncryptionResult | undefined> {
    const dialogRef = this._matDialog.open(DialogEnableEncryptionComponent, {
      width: '450px',
      disableClose: true,
      data: { providerType: 'supersync' } as EnableEncryptionDialogData,
    });

    return dialogRef.afterClosed().toPromise();
  }

  openEnableEncryptionDialogForFileBased(): Promise<EnableEncryptionResult | undefined> {
    const dialogRef = this._matDialog.open(DialogEnableEncryptionComponent, {
      width: '450px',
      disableClose: true,
      data: { providerType: 'file-based' } as EnableEncryptionDialogData,
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

/**
 * Opens the encryption password change dialog for file-based providers.
 */
export const openEncryptionPasswordChangeDialogForFileBased = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openChangePasswordDialogForFileBased();
};

/**
 * Opens the disable encryption confirmation dialog.
 * Can be called from form config onChange handlers.
 */
export const openDisableEncryptionDialog = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openDisableEncryptionDialog();
};

/**
 * Opens the enable encryption confirmation dialog.
 * Can be called from form config onChange handlers.
 */
export const openEnableEncryptionDialog = (): Promise<
  EnableEncryptionResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openEnableEncryptionDialog();
};

/**
 * Opens the enable encryption dialog for file-based providers.
 */
export const openEnableEncryptionDialogForFileBased = (): Promise<
  EnableEncryptionResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openEnableEncryptionDialogForFileBased();
};

/**
 * Opens the disable encryption dialog for file-based providers.
 * Can be called from form config onClick handlers.
 */
export const openDisableEncryptionDialogForFileBased = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return Promise.resolve(undefined);
  }
  return dialogOpenerInstance.openDisableEncryptionDialogForFileBased();
};

/**
 * Closes all open dialogs. Useful after disabling encryption
 * to close the parent settings dialog.
 */
export const closeAllDialogs = (): void => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return;
  }
  dialogOpenerInstance.closeAllDialogs();
};

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
import { firstValueFrom } from 'rxjs';

// Module-level reference, set by the service constructor
let dialogOpenerInstance: EncryptionPasswordDialogOpenerService | null = null;

const setInstance = (instance: EncryptionPasswordDialogOpenerService): void => {
  dialogOpenerInstance = instance;
};

const callOpener = <T>(
  fn: (opener: EncryptionPasswordDialogOpenerService) => T,
): T | undefined => {
  if (!dialogOpenerInstance) {
    console.error('EncryptionPasswordDialogOpenerService not initialized');
    return undefined;
  }
  return fn(dialogOpenerInstance);
};

/**
 * Singleton service to open the encryption password change dialog.
 * Used by the sync form config which doesn't have direct access to injector.
 *
 * The constructor self-registers the module-level reference so that
 * exported functions work from static form config handlers.
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordDialogOpenerService {
  private _matDialog = inject(MatDialog);

  constructor() {
    // Self-register so module-level functions can delegate to this instance
    setInstance(this);
  }

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

    return firstValueFrom(dialogRef.afterClosed());
  }

  openEnableEncryptionDialog(
    providerType: 'supersync' | 'file-based' = 'supersync',
  ): Promise<EnableEncryptionResult | undefined> {
    const dialogRef = this._matDialog.open(DialogEnableEncryptionComponent, {
      width: '450px',
      disableClose: true,
      data: { providerType } as EnableEncryptionDialogData,
    });

    return firstValueFrom(dialogRef.afterClosed());
  }
}

export const openEncryptionPasswordChangeDialog = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> => callOpener((o) => o.openChangePasswordDialog()) ?? Promise.resolve(undefined);

export const openEncryptionPasswordChangeDialogForFileBased = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> =>
  callOpener((o) => o.openChangePasswordDialog('full', 'file-based')) ??
  Promise.resolve(undefined);

export const openEnableEncryptionDialog = (): Promise<
  EnableEncryptionResult | undefined
> => callOpener((o) => o.openEnableEncryptionDialog()) ?? Promise.resolve(undefined);

export const openEnableEncryptionDialogForFileBased = (): Promise<
  EnableEncryptionResult | undefined
> =>
  callOpener((o) => o.openEnableEncryptionDialog('file-based')) ??
  Promise.resolve(undefined);

export const openDisableEncryptionDialogForFileBased = (): Promise<
  ChangeEncryptionPasswordResult | undefined
> =>
  callOpener((o) => o.openChangePasswordDialog('disable-only', 'file-based')) ??
  Promise.resolve(undefined);

export const closeAllDialogs = (): void => {
  callOpener((o) => o.closeAllDialogs());
};

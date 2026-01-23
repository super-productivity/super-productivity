import { inject, Injectable } from '@angular/core';
import {
  EncryptionPasswordDialogOpenerService,
  setDialogOpenerInstance,
} from './encryption-password-dialog-opener.service';

/**
 * Initialization service to set up the dialog opener instance.
 * This service should be injected in the app component or root module
 * to ensure the dialog opener is available for static form config functions.
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordDialogOpenerInitService {
  private _dialogOpener = inject(EncryptionPasswordDialogOpenerService);

  constructor() {
    // Initialize the module-level reference so that exported functions work
    setDialogOpenerInstance(this._dialogOpener);
  }
}

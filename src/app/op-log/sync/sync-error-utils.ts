/**
 * Utility functions for handling common sync errors.
 */
import { Injector } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { alertDialog } from '../../util/native-dialogs';

export const getSyncErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const maybeError = error as { code?: unknown; errorCode?: unknown };
  if (typeof maybeError.errorCode === 'string') {
    return maybeError.errorCode;
  }
  if (typeof maybeError.code === 'string') {
    return maybeError.code;
  }
  return undefined;
};

const getSyncErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
};

/**
 * Alerts the user, in their language, when the sync server refused an upload
 * because the account is over its storage quota.
 *
 * @returns true if the error was a storage quota error (and the alert shown)
 */
export const handleStorageQuotaError = (error: unknown, injector: Injector): boolean => {
  if (isStorageQuotaError(error)) {
    // TranslateService is resolved here rather than injected by each caller:
    // only this rare path needs it, and the upload services are built in many
    // contexts that have no reason to provide it.
    alertDialog(injector.get(TranslateService).instant(T.F.SYNC.A.SERVER_STORAGE_FULL));
    return true;
  }
  return false;
};

export const isStorageQuotaError = (error: unknown): boolean => {
  const errorCode = getSyncErrorCode(error);
  if (errorCode === 'STORAGE_QUOTA_EXCEEDED') {
    return true;
  }

  const message = getSyncErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes('STORAGE_QUOTA_EXCEEDED') ||
    message.includes('Storage quota exceeded')
  );
};

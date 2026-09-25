/**
 * Utility functions for handling common sync errors.
 */
import { alertDialog } from '../../util/native-dialogs';

const STORAGE_QUOTA_ALERT =
  'Sync storage is full! Your data is NOT syncing to the server. ' +
  'Please archive old tasks or upgrade your plan to continue syncing.';

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

export const handleStorageQuotaError = (error: unknown): boolean => {
  if (isStorageQuotaError(error)) {
    alertDialog(STORAGE_QUOTA_ALERT);
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

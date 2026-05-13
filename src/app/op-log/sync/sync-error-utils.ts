/**
 * Utility functions for handling common sync errors.
 */
import { isRetryableUploadError } from '@sp/sync-providers';
import { alertDialog } from '../../util/native-dialogs';

const STORAGE_QUOTA_ALERT =
  'Sync storage is full! Your data is NOT syncing to the server. ' +
  'Please archive old tasks or upgrade your plan to continue syncing.';

export const handleStorageQuotaError = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  if (
    message.includes('STORAGE_QUOTA_EXCEEDED') ||
    message.includes('Storage quota exceeded')
  ) {
    alertDialog(STORAGE_QUOTA_ALERT);
    return true;
  }
  return false;
};

export const isStorageQuotaError = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return (
    message.includes('STORAGE_QUOTA_EXCEEDED') ||
    message.includes('Storage quota exceeded')
  );
};

export const isTransientNetworkError = isRetryableUploadError;

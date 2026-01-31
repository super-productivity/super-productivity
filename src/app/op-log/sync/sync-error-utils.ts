/**
 * Utility functions for handling common sync errors.
 */
import { alertDialog } from '../../util/native-dialogs';

/**
 * Storage quota exceeded error message shown to users.
 */
const STORAGE_QUOTA_ALERT =
  'Sync storage is full! Your data is NOT syncing to the server. ' +
  'Please archive old tasks or upgrade your plan to continue syncing.';

/**
 * Checks if an error message indicates storage quota was exceeded
 * and shows an alert to the user if so.
 *
 * @param message - Error message to check
 * @returns true if storage quota was exceeded, false otherwise
 */
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

/**
 * Checks if an error message indicates storage quota was exceeded
 * without showing an alert. Use when you want to detect but not alert.
 *
 * @param message - Error message to check
 * @returns true if storage quota was exceeded, false otherwise
 */
export const isStorageQuotaError = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return (
    message.includes('STORAGE_QUOTA_EXCEEDED') ||
    message.includes('Storage quota exceeded')
  );
};

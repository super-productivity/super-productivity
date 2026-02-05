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

/**
 * Regex patterns that identify transient network/server errors.
 * These errors are temporary and should be retried.
 */
const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  // Network/fetch errors - use word boundaries to avoid false positives
  /\bfailed to fetch\b/,
  /\bnetwork\s*(error|request|failure)?\b/, // "network error", "network request", "network"
  /\btimeout\b/,
  /\beconnrefused\b/,
  /\benotfound\b/,
  /\bdns\b/,
  /\bcors\b/,
  /\bnet::/,
  /\boffline\b/,
  /\baborted\b/,
  /\bconnection\s*(refused|reset|closed)\b/,
  /\bsocket\s*(hang up|closed)\b/,
  // Server transient errors
  /\bserver\s*busy\b/,
  /\bplease\s*retry\b/,
  /\btransaction\s*rolled\s*back\b/,
  /\binternal\s*server\s*error\b/,
  // HTTP status codes - match as words to avoid matching in other contexts
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\bservice\s*unavailable\b/,
  /\bgateway\s*timeout\b/,
];

/**
 * Checks if an error message indicates a transient network error that should be retried.
 *
 * Transient errors include:
 * - Network errors (failed to fetch, timeout, connection issues)
 * - Server internal errors (transaction timeout, server busy)
 *
 * Permanent rejections are typically validation errors (invalid payload,
 * duplicate operation, conflict, etc.) that won't succeed on retry.
 *
 * @param error - Error message string or Error object to check
 * @returns true if the error is transient and should be retried, false otherwise
 */
export const isTransientNetworkError = (error: string | Error | undefined): boolean => {
  if (!error) return false;

  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();

  // Also check error name for AbortError (fetch timeout)
  if (typeof error !== 'string' && error.name === 'AbortError') {
    return true;
  }

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(lowerMessage));
};

/**
 * Error message constants for operation log persistence operations.
 *
 * Centralizes error messages to enable:
 * - Consistent error handling across services
 * - Easy error detection in catch blocks
 * - Prevention of typos in error message strings
 * - Better maintainability when error messages need updates
 */

// ============================================================================
// Duplicate Operation Errors (Issue #6213)
// ============================================================================

/**
 * Error thrown when attempting to append a duplicate operation to the log.
 * Usually indicates a race condition where multiple syncs tried to write the same ops.
 * @see https://github.com/johannesjo/super-productivity/issues/6213
 */
export const DUPLICATE_OPERATION_ERROR_MSG =
  '[OpLogStore] Duplicate operation detected (likely race condition). See #6213.';

// ============================================================================
// Initialization Errors
// ============================================================================

/**
 * Error thrown when attempting to use OperationLogStore before initialization.
 */
export const OPERATION_LOG_STORE_NOT_INITIALIZED =
  'OperationLogStore not initialized. Ensure init() is called.';

/**
 * Error thrown when attempting to use ArchiveStoreService before initialization.
 */
export const ARCHIVE_STORE_NOT_INITIALIZED =
  'ArchiveStoreService not initialized. Ensure _ensureInit() is called.';

// ============================================================================
// IndexedDB Open Errors (Issue #6255)
// ============================================================================

/**
 * Error thrown when IndexedDB fails to open after all retry attempts.
 * @see https://github.com/johannesjo/super-productivity/issues/6255
 */
export const IDB_OPEN_ERROR_MSG =
  '[OpLogStore] Failed to open IndexedDB after multiple retries. See #6255.';

/**
 * Pattern to detect "backing store" errors from the browser.
 * These errors indicate storage-level issues (disk I/O, file locks, corruption).
 * Used for heuristic error detection to show platform-specific guidance.
 */
export const IDB_BACKING_STORE_PATTERN = 'backing store';

// ============================================================================
// Connection Closing Errors (Issue #6643)
// ============================================================================

/**
 * Detects IndexedDB "connection is closing" errors.
 *
 * On iOS/Capacitor, the OS can close IndexedDB connections when the app goes
 * to background or the OS reclaims resources. This leaves cached IDBDatabase
 * references stale, causing all subsequent operations to fail with:
 *   "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."
 *
 * @see https://github.com/johannesjo/super-productivity/issues/6643
 */
export const isConnectionClosingError = (e: unknown): boolean => {
  if (e instanceof DOMException) {
    const msg = e.message.toLowerCase();
    return msg.includes('connection is closing') || msg.includes('database is closing');
  }
  return false;
};

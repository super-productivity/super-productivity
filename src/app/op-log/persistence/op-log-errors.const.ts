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

/**
 * Partial match for duplicate operation errors (for backward compatibility and testing).
 * Use this in catch blocks and tests that need to detect duplicate operation errors.
 */
export const DUPLICATE_OPERATION_ERROR_PATTERN = 'Duplicate operation detected';

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

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
 * Base message for the downgrade barrier. Says "further retries skipped" rather
 * than "no retry ran", because attempts CAN precede it: a transient failure may
 * burn an attempt, then another process commits the upgrade during the backoff,
 * and the next attempt hits the barrier. `IDB_OPEN_ERROR_MSG` must not be
 * reused here either: it claims a full retry budget, and the wrapper's `message`
 * is the string that reaches `HANDLED_ERROR_PROP_STR`, `getErrorTxt` and the
 * exported log history — i.e. exactly what a user pastes into a bug report.
 * Correcting only the `Log.err` prefixes would leave the false claim in the
 * copy most likely to be read.
 *
 * @see https://github.com/super-productivity/super-productivity/issues/9187
 */
export const IDB_OPEN_VERSION_BARRIER_MSG =
  'Failed to open IndexedDB: rejected by the downgrade barrier, further retries skipped. See #9187.';

/**
 * Pattern to detect "backing store" errors from the browser.
 * These errors indicate storage-level issues (disk I/O, file locks, corruption).
 * Used for heuristic error detection to show platform-specific guidance.
 */
export const IDB_BACKING_STORE_PATTERN = 'backing store';

/**
 * Heuristic: is this IndexedDB open error likely caused by a file lock held
 * by a previous process/session?
 *
 * Used to gate the long (~31s) retry window on errors where waiting might
 * actually help. Non-lock errors should fail fast: every op-log read/write
 * awaits `_ensureInit()`, so a 31s retry on a non-lock error blocks the
 * entire op-log subsystem for 31s before the hydrator's alert dialog
 * (see `OperationLogHydratorService._showIndexedDBOpenError`) can reach
 * the user.
 *
 * Signals that suggest a lock:
 * - `InvalidStateError`: Chrome throws this when LevelDB's LOCK file is held.
 * - "backing store" in the message: backing-store errors on Linux / Electron
 *   are commonly caused by a stale LevelDB lock from a crashed or prior
 *   session (see issue #7191).
 *
 * `DOMException` is checked explicitly in addition to `Error` because in some
 * Electron / older runtimes a `DOMException` does not satisfy
 * `instanceof Error`, and IndexedDB failures surface as `DOMException`s.
 * Mirrors the pattern in `isConnectionClosingError` below.
 *
 * @see https://github.com/super-productivity/super-productivity/issues/7191
 */
export const isLockRelatedIdbOpenError = (err: unknown): boolean => {
  if (err instanceof DOMException || err instanceof Error) {
    if (err.name === 'InvalidStateError') {
      return true;
    }
    return err.message.toLowerCase().includes(IDB_BACKING_STORE_PATTERN);
  }
  if (typeof err === 'string') {
    return err.toLowerCase().includes(IDB_BACKING_STORE_PATTERN);
  }
  return false;
};

/**
 * Is this open error the downgrade barrier firing? The browser throws
 * `VersionError` when the requested `DB_VERSION` is lower than the version
 * already on disk, i.e. an older app build is opening a database that a newer
 * build upgraded. `DB_VERSION` 8-10 exist purely as such barriers (see
 * `db-keys.const.ts`), so this is a supported, deliberate rejection — not
 * storage damage.
 *
 * Two consequences, both handled by callers:
 * - Retrying is pointless: the version numbers cannot change while the app
 *   runs, so every attempt fails identically. The open loops break out
 *   immediately instead of burning the ~7s non-lock budget on a white screen.
 * - The recovery advice must differ: the generic dialog blames disk space and
 *   corruption and suggests clearing storage, which here would destroy intact
 *   data and still not let the old build open it.
 *
 * `DOMException` is checked alongside `Error` for the same reason as in
 * `isLockRelatedIdbOpenError` above.
 *
 * Pass the ORIGINAL browser error. An already-wrapped `IndexedDBOpenError`
 * overrides `name`, so it returns `false` here — read `.isVersionError` on the
 * wrapper instead, or the caller silently falls back to the generic
 * clear-your-storage dialog.
 *
 * @see https://github.com/super-productivity/super-productivity/issues/9187
 */
export const isIdbVersionError = (err: unknown): boolean =>
  (err instanceof DOMException || err instanceof Error) && err.name === 'VersionError';

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

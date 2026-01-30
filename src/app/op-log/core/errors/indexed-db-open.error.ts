import {
  IDB_OPEN_ERROR_MSG,
  IDB_BACKING_STORE_PATTERN,
} from '../../persistence/op-log-errors.const';

/**
 * Error thrown when IndexedDB fails to open after all retry attempts.
 * Contains additional context about whether this is a "backing store" error,
 * which indicates storage-level issues that may have platform-specific solutions.
 *
 * @see https://github.com/johannesjo/super-productivity/issues/6255
 */
export class IndexedDBOpenError extends Error {
  override name = 'IndexedDBOpenError';

  /**
   * True if the error message contains "backing store", indicating a
   * storage-level issue (disk I/O, file locks, corruption).
   */
  readonly isBackingStoreError: boolean;

  /**
   * The original error that caused IndexedDB to fail.
   */
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super(IDB_OPEN_ERROR_MSG);
    this.originalError = originalError;
    this.isBackingStoreError = IndexedDBOpenError._checkBackingStoreError(originalError);
  }

  private static _checkBackingStoreError(err: unknown): boolean {
    if (err instanceof Error) {
      return err.message.toLowerCase().includes(IDB_BACKING_STORE_PATTERN);
    }
    if (typeof err === 'string') {
      return err.toLowerCase().includes(IDB_BACKING_STORE_PATTERN);
    }
    return false;
  }
}

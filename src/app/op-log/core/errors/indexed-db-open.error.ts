import {
  IDB_OPEN_ERROR_MSG,
  IDB_OPEN_VERSION_BARRIER_MSG,
  IDB_BACKING_STORE_PATTERN,
  isIdbVersionError,
} from '../../persistence/op-log-errors.const';
import { HANDLED_ERROR_PROP_STR } from '../../../app.constants';

/**
 * Error thrown when IndexedDB fails to open after all retry attempts.
 *
 * Carries the `HANDLED_ERROR_PROP_STR` marker so the GlobalErrorHandler skips
 * the "please report on GitHub" dialog. The hydrator catches this error and
 * shows a tailored recovery dialog; runtime callers currently let it
 * propagate, so users see only a console log entry — preferable to asking
 * them to file what is usually a known transient platform issue (e.g. WebKit
 * bug 273827 on iOS).
 *
 * @see https://github.com/johannesjo/super-productivity/issues/6255
 * @see https://github.com/super-productivity/super-productivity/issues/7415
 */
export class IndexedDBOpenError extends Error {
  override name = 'IndexedDBOpenError';

  /** True if the original error message contains "backing store" (Chromium LevelDB signal). */
  readonly isBackingStoreError: boolean;

  /**
   * True if an older app build tried to open a database a newer build already
   * upgraded (the `DB_VERSION` downgrade barrier). The data is intact; only
   * this build is too old to read it.
   *
   * @see https://github.com/super-productivity/super-productivity/issues/9187
   */
  readonly isVersionError: boolean;

  /** The original error that caused IndexedDB to fail. */
  readonly originalError: unknown;

  /**
   * Set to the constructed message so `getErrorTxt`'s short-circuit on this
   * field still surfaces the original error detail rather than the bare
   * wrapper string.
   */
  readonly [HANDLED_ERROR_PROP_STR]: string;

  constructor(originalError: unknown) {
    super(IndexedDBOpenError._buildMessage(originalError));
    this[HANDLED_ERROR_PROP_STR] = this.message;
    this.originalError = originalError;
    this.isBackingStoreError = IndexedDBOpenError._checkBackingStoreError(originalError);
    this.isVersionError = isIdbVersionError(originalError);
  }

  /**
   * Includes the original error's name and message so bug reports can
   * distinguish Chromium LevelDB locks, WebKit's "Connection to Indexed
   * Database server lost", quota errors, etc.
   *
   * The base string is chosen from the same classification the constructor
   * records, so every consumer of the wrapper — console, `HANDLED_ERROR_PROP_STR`,
   * exported logs — describes the barrier consistently. Classifying here rather
   * than at each `Log.err` call site keeps that to one decision point.
   */
  private static _buildMessage(originalError: unknown): string {
    const base = isIdbVersionError(originalError)
      ? IDB_OPEN_VERSION_BARRIER_MSG
      : IDB_OPEN_ERROR_MSG;
    const detail = IndexedDBOpenError._formatOriginal(originalError);
    return detail ? `${base} | original: ${detail}` : base;
  }

  private static _formatOriginal(err: unknown): string {
    if (err instanceof Error || err instanceof DOMException) {
      return `${err.name}: ${err.message}`;
    }
    if (typeof err === 'string') {
      return err;
    }
    return '';
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

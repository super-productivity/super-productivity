import { IndexedDBOpenError } from './indexed-db-open.error';
import {
  IDB_OPEN_ERROR_MSG,
  IDB_OPEN_VERSION_BARRIER_MSG,
} from '../../persistence/op-log-errors.const';
import { HANDLED_ERROR_PROP_STR } from '../../../app.constants';

describe('IndexedDBOpenError', () => {
  describe('constructor', () => {
    it('should start the message with IDB_OPEN_ERROR_MSG and append the original detail', () => {
      const originalError = new Error('Original error');
      const error = new IndexedDBOpenError(originalError);

      expect(error.message.startsWith(IDB_OPEN_ERROR_MSG)).toBe(true);
      expect(error.message).toContain('Error: Original error');
      expect(error.name).toBe('IndexedDBOpenError');
    });

    it('should use bare IDB_OPEN_ERROR_MSG when there is no usable original detail', () => {
      expect(new IndexedDBOpenError(null).message).toBe(IDB_OPEN_ERROR_MSG);
      expect(new IndexedDBOpenError(undefined).message).toBe(IDB_OPEN_ERROR_MSG);
      expect(new IndexedDBOpenError('').message).toBe(IDB_OPEN_ERROR_MSG);
    });

    it('should include the DOMException name and message in the wrapper message', () => {
      const dom = new DOMException(
        'Connection to Indexed Database server lost. Refresh the page to try again',
        'UnknownError',
      );
      const error = new IndexedDBOpenError(dom);

      expect(error.message).toContain('UnknownError');
      expect(error.message).toContain('Connection to Indexed Database server lost');
    });

    it('should preserve original error', () => {
      const originalError = new Error('Original error message');
      const error = new IndexedDBOpenError(originalError);

      expect(error.originalError).toBe(originalError);
    });

    it('should handle string as original error', () => {
      const error = new IndexedDBOpenError('String error');

      expect(error.originalError).toBe('String error');
      expect(error.message).toContain('String error');
    });

    it('should handle null as original error', () => {
      const error = new IndexedDBOpenError(null);

      expect(error.originalError).toBeNull();
    });
  });

  describe('handled-error marker', () => {
    it('should carry HANDLED_ERROR_PROP_STR so GlobalErrorHandler skips the GitHub-issue dialog', () => {
      const error = new IndexedDBOpenError(new Error('boom'));

      expect(Object.prototype.hasOwnProperty.call(error, HANDLED_ERROR_PROP_STR)).toBe(
        true,
      );
    });

    it('should set the marker to the same constructed message as .message so getErrorTxt returns the full original detail', () => {
      const error = new IndexedDBOpenError(
        new DOMException('Connection to Indexed Database server lost', 'UnknownError'),
      );
      const marker = (error as unknown as Record<string, unknown>)[
        HANDLED_ERROR_PROP_STR
      ];

      expect(marker).toBe(error.message);
      expect(marker).toContain(IDB_OPEN_ERROR_MSG);
      expect(marker).toContain('UnknownError');
      expect(marker).toContain('Connection to Indexed Database server lost');
    });
  });

  describe('isBackingStoreError detection', () => {
    it('should detect backing store error in Error message', () => {
      const originalError = new Error(
        'Internal error opening backing store for indexedDB.open',
      );
      const error = new IndexedDBOpenError(originalError);

      expect(error.isBackingStoreError).toBe(true);
    });

    it('should detect backing store error case-insensitively', () => {
      const originalError = new Error('Internal error opening BACKING STORE');
      const error = new IndexedDBOpenError(originalError);

      expect(error.isBackingStoreError).toBe(true);
    });

    it('should detect backing store error in string', () => {
      const error = new IndexedDBOpenError(
        'Internal error opening backing store for indexedDB.open',
      );

      expect(error.isBackingStoreError).toBe(true);
    });

    it('should return false for non-backing-store errors', () => {
      const originalError = new Error('QuotaExceededError');
      const error = new IndexedDBOpenError(originalError);

      expect(error.isBackingStoreError).toBe(false);
    });

    it('should return false for null original error', () => {
      const error = new IndexedDBOpenError(null);

      expect(error.isBackingStoreError).toBe(false);
    });

    it('should return false for undefined original error', () => {
      const error = new IndexedDBOpenError(undefined);

      expect(error.isBackingStoreError).toBe(false);
    });

    it('should return false for object without message', () => {
      const error = new IndexedDBOpenError({ code: 'UNKNOWN' });

      expect(error.isBackingStoreError).toBe(false);
    });
  });

  describe('isVersionError (#9187)', () => {
    it('should be true for a downgrade-barrier VersionError', () => {
      const error = new IndexedDBOpenError(
        new DOMException(
          'The requested version (7) is less than the existing version (10).',
          'VersionError',
        ),
      );

      expect(error.isVersionError).toBe(true);
      // NOTE: deliberately no `isBackingStoreError` assertion here. It is false
      // with or without this change (the message has no "backing store"), so it
      // would pass against the unfixed code — a vacuous assertion.
    });

    // The wrapper's own message — not just the Log.err prefix — is what reaches
    // HANDLED_ERROR_PROP_STR, getErrorTxt and the exported log history, i.e.
    // what a user pastes into a bug report. Claiming retries there would send
    // #9187 triage looking for a 7s window that never happened.
    it('should not claim retries in the message when no retry ran', () => {
      const error = new IndexedDBOpenError(
        new DOMException(
          'The requested version (7) is less than the existing version (10).',
          'VersionError',
        ),
      );

      expect(error.message).toContain(IDB_OPEN_VERSION_BARRIER_MSG);
      expect(error.message).not.toContain('after multiple retries');
      expect(error.message).toContain('The requested version (7) is less than');
      // ...and the marker must carry the same corrected text.
      expect((error as unknown as Record<string, unknown>)[HANDLED_ERROR_PROP_STR]).toBe(
        error.message,
      );
    });

    it('should keep the retry wording for failures that really did retry', () => {
      const error = new IndexedDBOpenError(new Error('QuotaExceededError'));

      expect(error.message).toContain(IDB_OPEN_ERROR_MSG);
      expect(error.message).not.toContain(IDB_OPEN_VERSION_BARRIER_MSG);
    });

    it('should be false for other IndexedDB open failures', () => {
      expect(new IndexedDBOpenError(new Error('QuotaExceededError')).isVersionError).toBe(
        false,
      );
      expect(
        new IndexedDBOpenError(new DOMException('nope', 'InvalidStateError'))
          .isVersionError,
      ).toBe(false);
      expect(new IndexedDBOpenError(undefined).isVersionError).toBe(false);
      // A message that merely mentions the words must not trigger it.
      expect(
        new IndexedDBOpenError(new Error('VersionError happened somewhere'))
          .isVersionError,
      ).toBe(false);
    });
  });

  describe('inheritance', () => {
    it('should be an instance of Error', () => {
      const error = new IndexedDBOpenError(new Error('test'));

      expect(error instanceof Error).toBe(true);
      expect(error instanceof IndexedDBOpenError).toBe(true);
    });

    it('should have correct stack trace', () => {
      const error = new IndexedDBOpenError(new Error('test'));

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('IndexedDBOpenError');
    });
  });
});

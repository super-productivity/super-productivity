import { IndexedDBOpenError } from './indexed-db-open.error';
import { IDB_OPEN_ERROR_MSG } from '../../persistence/op-log-errors.const';

describe('IndexedDBOpenError', () => {
  describe('constructor', () => {
    it('should create error with correct message', () => {
      const originalError = new Error('Original error');
      const error = new IndexedDBOpenError(originalError);

      expect(error.message).toBe(IDB_OPEN_ERROR_MSG);
      expect(error.name).toBe('IndexedDBOpenError');
    });

    it('should preserve original error', () => {
      const originalError = new Error('Original error message');
      const error = new IndexedDBOpenError(originalError);

      expect(error.originalError).toBe(originalError);
    });

    it('should handle string as original error', () => {
      const error = new IndexedDBOpenError('String error');

      expect(error.originalError).toBe('String error');
    });

    it('should handle null as original error', () => {
      const error = new IndexedDBOpenError(null);

      expect(error.originalError).toBeNull();
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

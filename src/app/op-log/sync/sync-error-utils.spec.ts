import { isStorageQuotaError } from './sync-error-utils';

describe('sync-error-utils', () => {
  describe('isStorageQuotaError', () => {
    it('should return true for storage quota errors', () => {
      expect(isStorageQuotaError('STORAGE_QUOTA_EXCEEDED')).toBe(true);
      expect(isStorageQuotaError('Storage quota exceeded for this account')).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isStorageQuotaError(undefined)).toBe(false);
      expect(isStorageQuotaError('Random error')).toBe(false);
      expect(isStorageQuotaError('Network error')).toBe(false);
    });
  });
});

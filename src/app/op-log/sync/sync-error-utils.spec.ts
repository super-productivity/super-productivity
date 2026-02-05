import { isTransientNetworkError, isStorageQuotaError } from './sync-error-utils';

describe('sync-error-utils', () => {
  describe('isTransientNetworkError', () => {
    describe('should return true for transient network errors', () => {
      it('failed to fetch', () => {
        expect(isTransientNetworkError('Failed to fetch')).toBe(true);
        expect(isTransientNetworkError('failed to fetch resources')).toBe(true);
      });

      it('timeout errors', () => {
        expect(isTransientNetworkError('Request timeout')).toBe(true);
        expect(isTransientNetworkError('Timeout exceeded')).toBe(true);
      });

      it('network error keywords', () => {
        expect(isTransientNetworkError('Network error occurred')).toBe(true);
        expect(isTransientNetworkError('network request failed')).toBe(true);
        expect(isTransientNetworkError('Network failure')).toBe(true);
      });

      it('connection errors', () => {
        expect(isTransientNetworkError('ECONNREFUSED')).toBe(true);
        expect(isTransientNetworkError('ENOTFOUND')).toBe(true);
        expect(isTransientNetworkError('Connection refused by server')).toBe(true);
        expect(isTransientNetworkError('Connection reset by peer')).toBe(true);
        expect(isTransientNetworkError('Connection closed unexpectedly')).toBe(true);
      });

      it('socket errors', () => {
        expect(isTransientNetworkError('Socket hang up')).toBe(true);
        expect(isTransientNetworkError('socket closed')).toBe(true);
      });

      it('CORS errors', () => {
        expect(isTransientNetworkError('CORS policy blocked')).toBe(true);
      });

      it('offline status', () => {
        expect(isTransientNetworkError('Client is offline')).toBe(true);
        expect(isTransientNetworkError('Device offline')).toBe(true);
      });

      it('aborted requests', () => {
        expect(isTransientNetworkError('Request aborted')).toBe(true);
        expect(isTransientNetworkError('Fetch aborted by user')).toBe(true);
      });

      it('server transient errors', () => {
        expect(isTransientNetworkError('Server busy, please retry')).toBe(true);
        expect(isTransientNetworkError('Please retry later')).toBe(true);
        expect(isTransientNetworkError('Transaction rolled back')).toBe(true);
        expect(isTransientNetworkError('Internal server error')).toBe(true);
      });

      it('HTTP 5xx status codes', () => {
        expect(isTransientNetworkError('HTTP 500 Internal Server Error')).toBe(true);
        expect(isTransientNetworkError('Error 502 Bad Gateway')).toBe(true);
        expect(isTransientNetworkError('503 Service Unavailable')).toBe(true);
        expect(isTransientNetworkError('504 Gateway Timeout')).toBe(true);
        expect(isTransientNetworkError('Service unavailable')).toBe(true);
        expect(isTransientNetworkError('Gateway timeout')).toBe(true);
      });

      it('Chrome net:: errors', () => {
        expect(isTransientNetworkError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
        expect(isTransientNetworkError('net::ERR_CONNECTION_REFUSED')).toBe(true);
      });

      it('DNS errors', () => {
        expect(isTransientNetworkError('DNS lookup failed')).toBe(true);
        expect(isTransientNetworkError('dns resolution failed')).toBe(true);
      });

      it('AbortError from Error object', () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        expect(isTransientNetworkError(abortError)).toBe(true);
      });
    });

    describe('should return false for permanent errors', () => {
      it('undefined or empty error', () => {
        expect(isTransientNetworkError(undefined)).toBe(false);
        expect(isTransientNetworkError('')).toBe(false);
      });

      it('validation errors', () => {
        expect(isTransientNetworkError('Invalid payload: missing required field')).toBe(
          false,
        );
        expect(isTransientNetworkError('Schema validation failed')).toBe(false);
        expect(isTransientNetworkError('Duplicate operation ID')).toBe(false);
      });

      it('conflict errors', () => {
        expect(isTransientNetworkError('Conflict: operation already exists')).toBe(false);
        expect(isTransientNetworkError('Version conflict detected')).toBe(false);
      });

      it('authentication errors', () => {
        expect(isTransientNetworkError('Unauthorized: invalid token')).toBe(false);
        expect(isTransientNetworkError('Authentication failed')).toBe(false);
        expect(isTransientNetworkError('Access denied')).toBe(false);
      });

      it('HTTP 4xx status codes', () => {
        expect(isTransientNetworkError('400 Bad Request')).toBe(false);
        expect(isTransientNetworkError('401 Unauthorized')).toBe(false);
        expect(isTransientNetworkError('403 Forbidden')).toBe(false);
        expect(isTransientNetworkError('404 Not Found')).toBe(false);
      });

      it('generic errors without network keywords', () => {
        expect(isTransientNetworkError('Unknown error')).toBe(false);
        expect(isTransientNetworkError('Something went wrong')).toBe(false);
        expect(isTransientNetworkError('Operation failed')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('case insensitive matching', () => {
        expect(isTransientNetworkError('TIMEOUT')).toBe(true);
        expect(isTransientNetworkError('Network ERROR')).toBe(true);
        expect(isTransientNetworkError('FAILED TO FETCH')).toBe(true);
      });
    });
  });

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

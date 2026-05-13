import { describe, expect, it } from 'vitest';
import { isRetryableUploadError } from '../src/http';

describe('isRetryableUploadError', () => {
  describe('returns true for retryable errors', () => {
    it('failed to fetch', () => {
      expect(isRetryableUploadError('Failed to fetch')).toBe(true);
      expect(isRetryableUploadError('failed to fetch resources')).toBe(true);
    });

    it('timeout errors', () => {
      expect(isRetryableUploadError('Request timeout')).toBe(true);
      expect(isRetryableUploadError('Timeout exceeded')).toBe(true);
    });

    it('network error keywords', () => {
      expect(isRetryableUploadError('Network error occurred')).toBe(true);
      expect(isRetryableUploadError('network request failed')).toBe(true);
      expect(isRetryableUploadError('Network failure')).toBe(true);
      expect(
        isRetryableUploadError(
          'Unable to connect to SuperSync server. Check your internet connection.',
        ),
      ).toBe(true);
    });

    it('connection errors', () => {
      expect(isRetryableUploadError('ECONNREFUSED')).toBe(true);
      expect(isRetryableUploadError('ENOTFOUND')).toBe(true);
      expect(isRetryableUploadError('Connection refused by server')).toBe(true);
      expect(isRetryableUploadError('Connection reset by peer')).toBe(true);
      expect(isRetryableUploadError('Connection closed unexpectedly')).toBe(true);
    });

    it('socket errors', () => {
      expect(isRetryableUploadError('Socket hang up')).toBe(true);
      expect(isRetryableUploadError('socket closed')).toBe(true);
    });

    it('CORS errors', () => {
      expect(isRetryableUploadError('CORS policy blocked')).toBe(true);
    });

    it('offline status', () => {
      expect(isRetryableUploadError('Client is offline')).toBe(true);
      expect(isRetryableUploadError('Device offline')).toBe(true);
    });

    it('aborted requests', () => {
      expect(isRetryableUploadError('Request aborted')).toBe(true);
      expect(isRetryableUploadError('Fetch aborted by user')).toBe(true);
    });

    it('server transient errors', () => {
      expect(isRetryableUploadError('Server busy, please retry')).toBe(true);
      expect(isRetryableUploadError('Please retry later')).toBe(true);
      expect(isRetryableUploadError('Transaction rolled back')).toBe(true);
      expect(isRetryableUploadError('Internal server error')).toBe(true);
    });

    it('rate-limit errors', () => {
      expect(isRetryableUploadError('HTTP 429 Too Many Requests')).toBe(true);
      expect(isRetryableUploadError('Rate limit exceeded, retry in 5 minutes')).toBe(
        true,
      );
      expect(
        isRetryableUploadError(
          'HTTP 429 Too Many Requests \u2014 Too Many Requests \u2014 retry in 5 minutes',
        ),
      ).toBe(true);
    });

    it('HTTP 5xx status codes', () => {
      expect(isRetryableUploadError('HTTP 500 Internal Server Error')).toBe(true);
      expect(isRetryableUploadError('Error 502 Bad Gateway')).toBe(true);
      expect(isRetryableUploadError('503 Service Unavailable')).toBe(true);
      expect(isRetryableUploadError('504 Gateway Timeout')).toBe(true);
      expect(isRetryableUploadError('Service unavailable')).toBe(true);
      expect(isRetryableUploadError('Gateway timeout')).toBe(true);
    });

    it('Chrome net:: errors', () => {
      expect(isRetryableUploadError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
      expect(isRetryableUploadError('net::ERR_CONNECTION_REFUSED')).toBe(true);
    });

    it('DNS errors', () => {
      expect(isRetryableUploadError('DNS lookup failed')).toBe(true);
      expect(isRetryableUploadError('dns resolution failed')).toBe(true);
    });

    it('AbortError from Error object', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      expect(isRetryableUploadError(abortError)).toBe(true);
    });
  });

  describe('returns false for permanent errors', () => {
    it('undefined or empty error', () => {
      expect(isRetryableUploadError(undefined)).toBe(false);
      expect(isRetryableUploadError('')).toBe(false);
    });

    it('validation errors', () => {
      expect(isRetryableUploadError('Invalid payload: missing required field')).toBe(
        false,
      );
      expect(isRetryableUploadError('Schema validation failed')).toBe(false);
      expect(isRetryableUploadError('Duplicate operation ID')).toBe(false);
    });

    it('conflict errors', () => {
      expect(isRetryableUploadError('Conflict: operation already exists')).toBe(false);
      expect(isRetryableUploadError('Version conflict detected')).toBe(false);
    });

    it('authentication errors', () => {
      expect(isRetryableUploadError('Unauthorized: invalid token')).toBe(false);
      expect(isRetryableUploadError('Authentication failed')).toBe(false);
      expect(isRetryableUploadError('Access denied')).toBe(false);
    });

    it('HTTP 4xx status codes', () => {
      expect(isRetryableUploadError('400 Bad Request')).toBe(false);
      expect(isRetryableUploadError('401 Unauthorized')).toBe(false);
      expect(isRetryableUploadError('403 Forbidden')).toBe(false);
      expect(isRetryableUploadError('404 Not Found')).toBe(false);
    });

    it('generic errors without network keywords', () => {
      expect(isRetryableUploadError('Unknown error')).toBe(false);
      expect(isRetryableUploadError('Something went wrong')).toBe(false);
      expect(isRetryableUploadError('Operation failed')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('case insensitive matching', () => {
      expect(isRetryableUploadError('TIMEOUT')).toBe(true);
      expect(isRetryableUploadError('Network ERROR')).toBe(true);
      expect(isRetryableUploadError('FAILED TO FETCH')).toBe(true);
    });
  });
});

import {
  isTransientNetworkError,
  executeNativeRequestWithRetry,
  NativeRequestConfig,
} from './native-http-retry';
import { HttpResponse } from '@capacitor/core';

describe('isTransientNetworkError', () => {
  describe('iOS error.code detection (NSURLErrorDomain)', () => {
    it('should return true for NSURLErrorDomain code', () => {
      const error = Object.assign(new Error('Some localized message'), {
        code: 'NSURLErrorDomain',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('should return true for NSURLErrorDomain even with non-English message', () => {
      const error = Object.assign(
        new Error('Die Netzwerkverbindung wurde unterbrochen.'),
        { code: 'NSURLErrorDomain' },
      );
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('should return true for NSURLErrorDomain with empty message', () => {
      const error = Object.assign(new Error(''), { code: 'NSURLErrorDomain' });
      expect(isTransientNetworkError(error)).toBe(true);
    });
  });

  describe('Android error.code detection', () => {
    it('should return true for SocketTimeoutException', () => {
      const error = Object.assign(new Error('timeout'), {
        code: 'SocketTimeoutException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('should return true for UnknownHostException', () => {
      const error = Object.assign(new Error('host not found'), {
        code: 'UnknownHostException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('should return true for ConnectException', () => {
      const error = Object.assign(new Error('connection refused'), {
        code: 'ConnectException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });
  });

  describe('Fallback string matching', () => {
    it('should return true for "network connection was lost"', () => {
      expect(isTransientNetworkError(new Error('The network connection was lost.'))).toBe(
        true,
      );
    });

    it('should return true for "timed out"', () => {
      expect(isTransientNetworkError(new Error('The request timed out.'))).toBe(true);
    });

    it('should return true for "internet connection appears to be offline"', () => {
      expect(
        isTransientNetworkError(
          new Error('The Internet connection appears to be offline.'),
        ),
      ).toBe(true);
    });

    it('should return true for "not connected to the internet"', () => {
      expect(isTransientNetworkError(new Error('not connected to the internet'))).toBe(
        true,
      );
    });

    it('should return true for "hostname could not be found"', () => {
      expect(
        isTransientNetworkError(
          new Error('A server with the specified hostname could not be found.'),
        ),
      ).toBe(true);
    });

    it('should return true for "cannot find host"', () => {
      expect(isTransientNetworkError(new Error('cannot find host'))).toBe(true);
    });

    it('should return true for "could not connect to the server"', () => {
      expect(isTransientNetworkError(new Error('Could not connect to the server.'))).toBe(
        true,
      );
    });

    it('should return true for "cannot connect to host"', () => {
      expect(isTransientNetworkError(new Error('cannot connect to host'))).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isTransientNetworkError(new Error('THE NETWORK CONNECTION WAS LOST'))).toBe(
        true,
      );
    });

    it('should return true for non-Error string with transient message', () => {
      expect(isTransientNetworkError('network connection was lost')).toBe(true);
    });
  });

  describe('Negative cases', () => {
    it('should return false for auth errors', () => {
      expect(isTransientNetworkError(new Error('Unauthorized'))).toBe(false);
    });

    it('should return false for arbitrary errors', () => {
      expect(isTransientNetworkError(new Error('Something unexpected happened'))).toBe(
        false,
      );
    });

    it('should return false for HTTP status errors', () => {
      expect(isTransientNetworkError(new Error('HTTP 409 Conflict'))).toBe(false);
    });

    it('should return false for non-Error string without transient message', () => {
      expect(isTransientNetworkError('some other string')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isTransientNetworkError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isTransientNetworkError(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isTransientNetworkError('')).toBe(false);
    });

    it('should return false for unrecognized error.code', () => {
      const error = Object.assign(new Error('some error'), {
        code: 'SomeOtherDomain',
      });
      expect(isTransientNetworkError(error)).toBe(false);
    });
  });
});

describe('executeNativeRequestWithRetry', () => {
  let mockRequestFn: jasmine.Spy<(opts: NativeRequestConfig) => Promise<HttpResponse>>;
  let delayCallArgs: number[];
  const noopDelay = async (ms: number): Promise<void> => {
    delayCallArgs.push(ms);
  };

  const baseConfig: NativeRequestConfig = {
    url: 'https://example.com/api',
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
    data: 'test-data',
  };

  const successResponse: HttpResponse = {
    status: 200,
    headers: {},
    data: 'ok',
    url: 'https://example.com/api',
  };

  beforeEach(() => {
    mockRequestFn = jasmine.createSpy('requestFn');
    delayCallArgs = [];
  });

  it('should return response on first success', async () => {
    mockRequestFn.and.returnValue(Promise.resolve(successResponse));

    const result = await executeNativeRequestWithRetry(
      baseConfig,
      'Test',
      mockRequestFn,
      noopDelay,
    );

    expect(result).toBe(successResponse);
    expect(mockRequestFn).toHaveBeenCalledTimes(1);
    expect(delayCallArgs).toEqual([]);
  });

  it('should retry on transient error and succeed', async () => {
    const transientError = Object.assign(new Error('connection lost'), {
      code: 'NSURLErrorDomain',
    });

    mockRequestFn.and.returnValues(
      Promise.reject(transientError),
      Promise.resolve(successResponse),
    );

    const result = await executeNativeRequestWithRetry(
      baseConfig,
      'Test',
      mockRequestFn,
      noopDelay,
    );

    expect(result).toBe(successResponse);
    expect(mockRequestFn).toHaveBeenCalledTimes(2);
    expect(delayCallArgs).toEqual([1000]);
  });

  it('should retry twice and succeed on third attempt', async () => {
    const transientError = Object.assign(new Error('timeout'), {
      code: 'SocketTimeoutException',
    });

    mockRequestFn.and.returnValues(
      Promise.reject(transientError),
      Promise.reject(transientError),
      Promise.resolve(successResponse),
    );

    const result = await executeNativeRequestWithRetry(
      baseConfig,
      'Test',
      mockRequestFn,
      noopDelay,
    );

    expect(result).toBe(successResponse);
    expect(mockRequestFn).toHaveBeenCalledTimes(3);
    expect(delayCallArgs).toEqual([1000, 2000]);
  });

  it('should throw after exhausting all retries for transient errors', async () => {
    const transientError = Object.assign(new Error('network lost'), {
      code: 'NSURLErrorDomain',
    });

    mockRequestFn.and.returnValues(
      Promise.reject(transientError),
      Promise.reject(transientError),
      Promise.reject(transientError),
    );

    await expectAsync(
      executeNativeRequestWithRetry(baseConfig, 'Test', mockRequestFn, noopDelay),
    ).toBeRejectedWith(transientError);
    expect(mockRequestFn).toHaveBeenCalledTimes(3);
    expect(delayCallArgs).toEqual([1000, 2000]);
  });

  it('should immediately throw non-transient errors without retrying', async () => {
    const nonTransientError = new Error('Unauthorized');

    mockRequestFn.and.returnValue(Promise.reject(nonTransientError));

    await expectAsync(
      executeNativeRequestWithRetry(baseConfig, 'Test', mockRequestFn, noopDelay),
    ).toBeRejectedWith(nonTransientError);

    expect(mockRequestFn).toHaveBeenCalledTimes(1);
    expect(delayCallArgs).toEqual([]);
  });

  it('should pass correct config to the request function', async () => {
    mockRequestFn.and.returnValue(Promise.resolve(successResponse));

    const config: NativeRequestConfig = {
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
      data: 'payload',
      responseType: 'json',
      connectTimeout: 5000,
      readTimeout: 60000,
    };

    await executeNativeRequestWithRetry(config, 'Test', mockRequestFn, noopDelay);

    expect(mockRequestFn).toHaveBeenCalledWith({
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
      data: 'payload',
      responseType: 'json',
      connectTimeout: 5000,
      readTimeout: 60000,
    });
  });

  it('should use default responseType, connectTimeout, and readTimeout', async () => {
    mockRequestFn.and.returnValue(Promise.resolve(successResponse));

    await executeNativeRequestWithRetry(baseConfig, 'Test', mockRequestFn, noopDelay);

    expect(mockRequestFn).toHaveBeenCalledWith(
      jasmine.objectContaining({
        responseType: 'text',
        connectTimeout: 30000,
        readTimeout: 120000,
      }),
    );
  });
});

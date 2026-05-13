import { describe, expect, it, vi } from 'vitest';
import {
  executeNativeRequestWithRetry,
  isTransientNetworkError,
  type NativeHttpExecutor,
  type NativeHttpRequestConfig,
  type NativeHttpResponse,
} from '../src/http';
import type { SyncLogger } from '@sp/sync-core';

const successResponse: NativeHttpResponse = {
  status: 200,
  headers: {},
  data: 'ok',
  url: 'https://example.com/api',
};

const baseConfig: NativeHttpRequestConfig = {
  url: 'https://example.com/api',
  method: 'POST',
  headers: { Authorization: 'Bearer test' },
  data: 'test-data',
};

const noopLogger = (): SyncLogger => ({
  log: vi.fn(),
  error: vi.fn(),
  err: vi.fn(),
  normal: vi.fn(),
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  critical: vi.fn(),
  debug: vi.fn(),
});

describe('isTransientNetworkError', () => {
  describe('iOS error.code detection (NSURLErrorDomain)', () => {
    it('returns true for NSURLErrorDomain code', () => {
      const error = Object.assign(new Error('Some localized message'), {
        code: 'NSURLErrorDomain',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('returns true for NSURLErrorDomain even with non-English message', () => {
      const error = Object.assign(
        new Error('Die Netzwerkverbindung wurde unterbrochen.'),
        { code: 'NSURLErrorDomain' },
      );
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('returns true for NSURLErrorDomain with empty message', () => {
      const error = Object.assign(new Error(''), { code: 'NSURLErrorDomain' });
      expect(isTransientNetworkError(error)).toBe(true);
    });
  });

  describe('Android error.code detection', () => {
    it('returns true for SocketTimeoutException', () => {
      const error = Object.assign(new Error('timeout'), {
        code: 'SocketTimeoutException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('returns true for UnknownHostException', () => {
      const error = Object.assign(new Error('host not found'), {
        code: 'UnknownHostException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });

    it('returns true for ConnectException', () => {
      const error = Object.assign(new Error('connection refused'), {
        code: 'ConnectException',
      });
      expect(isTransientNetworkError(error)).toBe(true);
    });
  });

  describe('Fallback string matching', () => {
    it('returns true for "network connection was lost"', () => {
      expect(isTransientNetworkError(new Error('The network connection was lost.'))).toBe(
        true,
      );
    });

    it('returns true for "timed out"', () => {
      expect(isTransientNetworkError(new Error('The request timed out.'))).toBe(true);
    });

    it('returns true for "internet connection appears to be offline"', () => {
      expect(
        isTransientNetworkError(
          new Error('The Internet connection appears to be offline.'),
        ),
      ).toBe(true);
    });

    it('returns true for "not connected to the internet"', () => {
      expect(isTransientNetworkError(new Error('not connected to the internet'))).toBe(
        true,
      );
    });

    it('returns true for "hostname could not be found"', () => {
      expect(
        isTransientNetworkError(
          new Error('A server with the specified hostname could not be found.'),
        ),
      ).toBe(true);
    });

    it('returns true for "cannot find host"', () => {
      expect(isTransientNetworkError(new Error('cannot find host'))).toBe(true);
    });

    it('returns true for "could not connect to the server"', () => {
      expect(isTransientNetworkError(new Error('Could not connect to the server.'))).toBe(
        true,
      );
    });

    it('returns true for "cannot connect to host"', () => {
      expect(isTransientNetworkError(new Error('cannot connect to host'))).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isTransientNetworkError(new Error('THE NETWORK CONNECTION WAS LOST'))).toBe(
        true,
      );
    });

    it('returns true for non-Error string with transient message', () => {
      expect(isTransientNetworkError('network connection was lost')).toBe(true);
    });
  });

  describe('Negative cases', () => {
    it('returns false for auth errors', () => {
      expect(isTransientNetworkError(new Error('Unauthorized'))).toBe(false);
    });

    it('returns false for arbitrary errors', () => {
      expect(isTransientNetworkError(new Error('Something unexpected happened'))).toBe(
        false,
      );
    });

    it('returns false for HTTP status errors', () => {
      expect(isTransientNetworkError(new Error('HTTP 409 Conflict'))).toBe(false);
    });

    it('returns false for non-Error string without transient message', () => {
      expect(isTransientNetworkError('some other string')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isTransientNetworkError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTransientNetworkError(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isTransientNetworkError('')).toBe(false);
    });

    it('returns false for unrecognized error.code', () => {
      const error = Object.assign(new Error('some error'), { code: 'SomeOtherDomain' });
      expect(isTransientNetworkError(error)).toBe(false);
    });
  });
});

describe('executeNativeRequestWithRetry', () => {
  const collectDelays = (): {
    delays: number[];
    delay: (ms: number) => Promise<void>;
  } => {
    const delays: number[] = [];
    return {
      delays,
      delay: async (ms) => {
        delays.push(ms);
      },
    };
  };

  it('returns response on first success', async () => {
    const executor = vi.fn<NativeHttpExecutor>().mockResolvedValue(successResponse);
    const { delays, delay } = collectDelays();

    const result = await executeNativeRequestWithRetry(baseConfig, {
      executor,
      label: 'Test',
      delay,
    });

    expect(result).toBe(successResponse);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries on transient error and succeeds', async () => {
    const transientError = Object.assign(new Error('connection lost'), {
      code: 'NSURLErrorDomain',
    });
    const executor = vi
      .fn<NativeHttpExecutor>()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(successResponse);
    const { delays, delay } = collectDelays();

    const result = await executeNativeRequestWithRetry(baseConfig, {
      executor,
      label: 'Test',
      delay,
    });

    expect(result).toBe(successResponse);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]);
  });

  it('retries twice and succeeds on third attempt', async () => {
    const transientError = Object.assign(new Error('timeout'), {
      code: 'SocketTimeoutException',
    });
    const executor = vi
      .fn<NativeHttpExecutor>()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(successResponse);
    const { delays, delay } = collectDelays();

    const result = await executeNativeRequestWithRetry(baseConfig, {
      executor,
      label: 'Test',
      delay,
    });

    expect(result).toBe(successResponse);
    expect(executor).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('throws after exhausting all retries for transient errors', async () => {
    const transientError = Object.assign(new Error('network lost'), {
      code: 'NSURLErrorDomain',
    });
    const executor = vi.fn<NativeHttpExecutor>().mockRejectedValue(transientError);
    const { delays, delay } = collectDelays();

    await expect(
      executeNativeRequestWithRetry(baseConfig, { executor, label: 'Test', delay }),
    ).rejects.toBe(transientError);
    expect(executor).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('immediately throws non-transient errors without retrying', async () => {
    const nonTransientError = new Error('Unauthorized');
    const executor = vi.fn<NativeHttpExecutor>().mockRejectedValue(nonTransientError);
    const { delays, delay } = collectDelays();

    await expect(
      executeNativeRequestWithRetry(baseConfig, { executor, label: 'Test', delay }),
    ).rejects.toBe(nonTransientError);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('passes correct config to the executor', async () => {
    const executor = vi.fn<NativeHttpExecutor>().mockResolvedValue(successResponse);
    const { delay } = collectDelays();
    const config: NativeHttpRequestConfig = {
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
      data: 'payload',
      responseType: 'json',
      connectTimeout: 5000,
      readTimeout: 60000,
    };

    await executeNativeRequestWithRetry(config, { executor, label: 'Test', delay });

    expect(executor).toHaveBeenCalledWith({
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
      data: 'payload',
      responseType: 'json',
      connectTimeout: 5000,
      readTimeout: 60000,
    });
  });

  it('uses default responseType, connectTimeout, and readTimeout', async () => {
    const executor = vi.fn<NativeHttpExecutor>().mockResolvedValue(successResponse);
    const { delay } = collectDelays();

    await executeNativeRequestWithRetry(baseConfig, { executor, label: 'Test', delay });

    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: 'text',
        connectTimeout: 30000,
        readTimeout: 120000,
      }),
    );
  });

  it('logs a warn entry with safe meta on each retry', async () => {
    const transientError = Object.assign(new Error('connection lost'), {
      code: 'NSURLErrorDomain',
    });
    const executor = vi
      .fn<NativeHttpExecutor>()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(successResponse);
    const { delay } = collectDelays();
    const logger = noopLogger();

    await executeNativeRequestWithRetry(baseConfig, {
      executor,
      label: 'Test',
      logger,
      delay,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain('Test transient network error');
    expect(meta).toMatchObject({
      url: baseConfig.url,
      attempt: 1,
      maxRetries: 2,
      delayMs: 1000,
      errorName: 'Error',
      errorCode: 'NSURLErrorDomain',
    });
  });

  it('does not retry when maxRetries is 0', async () => {
    const transientError = Object.assign(new Error('connection lost'), {
      code: 'NSURLErrorDomain',
    });
    const executor = vi.fn<NativeHttpExecutor>().mockRejectedValue(transientError);
    const { delays, delay } = collectDelays();

    await expect(
      executeNativeRequestWithRetry(baseConfig, {
        executor,
        label: 'Test',
        delay,
        maxRetries: 0,
      }),
    ).rejects.toBe(transientError);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('runs with a default noop logger when none is provided', async () => {
    const transientError = Object.assign(new Error('timeout'), {
      code: 'SocketTimeoutException',
    });
    const executor = vi
      .fn<NativeHttpExecutor>()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(successResponse);
    const { delay } = collectDelays();

    await expect(
      executeNativeRequestWithRetry(baseConfig, { executor, delay }),
    ).resolves.toBe(successResponse);
  });
});

import { getSyncErrorStr } from './get-sync-error-str';
import { HANDLED_ERROR_PROP_STR } from '../../app.constants';

describe('getSyncErrorStr', () => {
  it('should return string errors directly', () => {
    expect(getSyncErrorStr('sync failed')).toBe('sync failed');
  });

  it('should handle null', () => {
    expect(getSyncErrorStr(null)).toBe('Unknown sync error');
  });

  it('should handle undefined', () => {
    expect(getSyncErrorStr(undefined)).toBe('Unknown sync error');
  });

  it('should extract message from Error instances', () => {
    const err = new Error('sync error message');
    expect(getSyncErrorStr(err)).toBe('sync error message');
  });

  it('should handle HANDLED_ERROR_PROP_STR', () => {
    const err = { [HANDLED_ERROR_PROP_STR]: 'handled sync error' };
    expect(getSyncErrorStr(err)).toBe('handled sync error');
  });

  it('should extract response.data string (Axios pattern)', () => {
    const err = { response: { data: 'server error response' } };
    expect(getSyncErrorStr(err)).toBe('server error response');
  });

  it('should extract response.data.message (nested API error)', () => {
    const err = { response: { data: { message: 'API error message' } } };
    expect(getSyncErrorStr(err)).toBe('API error message');
  });

  it('should extract name property', () => {
    const err = { name: 'SyncError' };
    expect(getSyncErrorStr(err)).toBe('SyncError');
  });

  it('should extract statusText for HTTP errors', () => {
    const err = { statusText: 'Service Unavailable' };
    expect(getSyncErrorStr(err)).toBe('Service Unavailable');
  });

  it('should never return [object Object]', () => {
    const plainObject = { foo: 'bar' };
    const result = getSyncErrorStr(plainObject);
    expect(result).not.toBe('[object Object]');
  });

  it('should JSON.stringify objects without standard error properties', () => {
    const err = { code: 'NETWORK_ERROR', retry: true };
    const result = getSyncErrorStr(err);
    expect(result).toContain('code');
    expect(result).toContain('NETWORK_ERROR');
  });

  it('should handle empty objects', () => {
    const result = getSyncErrorStr({});
    expect(result).toBe('Unknown sync error (unable to extract message)');
  });

  it('should prioritize HANDLED_ERROR_PROP_STR over message', () => {
    const err = {
      [HANDLED_ERROR_PROP_STR]: 'handled',
      message: 'regular message',
    };
    expect(getSyncErrorStr(err)).toBe('handled');
  });

  it('should truncate long error messages', () => {
    const longMessage = 'x'.repeat(500);
    const err = { message: longMessage };
    const result = getSyncErrorStr(err);
    expect(result.length).toBeLessThanOrEqual(403); // 400 + '...'
  });

  it('should handle objects with custom toString', () => {
    const err = {
      toString: () => 'custom sync error',
    };
    expect(getSyncErrorStr(err)).toBe('custom sync error');
  });

  it('should prefer message over response.data', () => {
    const err = {
      message: 'direct message',
      response: { data: 'response data' },
    };
    expect(getSyncErrorStr(err)).toBe('direct message');
  });

  it('should handle circular reference objects gracefully', () => {
    const err: any = { message: null, data: {} };
    err.data.self = err; // circular reference
    const result = getSyncErrorStr(err);
    expect(result).not.toBe('[object Object]');
    expect(result).toBe('Unknown sync error (unable to extract message)');
  });

  it('should handle arrays', () => {
    const result = getSyncErrorStr(['sync error 1', 'sync error 2']);
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('sync error');
  });

  it('should handle numbers', () => {
    expect(getSyncErrorStr(503)).toBe('503');
  });

  it('should handle objects where toString throws', () => {
    const err = {
      toString: () => {
        throw new Error('toString failed');
      },
    };
    const result = getSyncErrorStr(err);
    expect(result).not.toBe('[object Object]');
  });

  it('should handle empty string message', () => {
    const err = { message: '' };
    const result = getSyncErrorStr(err);
    // Empty message falls through to JSON.stringify
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('message');
  });

  it('should handle WebDAV-style errors', () => {
    const err = {
      status: 423,
      statusText: 'Locked',
      response: { data: 'Resource is locked by another process' },
    };
    expect(getSyncErrorStr(err)).toBe('Resource is locked by another process');
  });

  it('should handle Dropbox-style API errors', () => {
    const err = {
      error: {
        error_summary: 'path/not_found/...',
        error: { tag: 'path', path: { tag: 'not_found' } },
      },
    };
    const result = getSyncErrorStr(err);
    expect(result).not.toBe('[object Object]');
  });
});

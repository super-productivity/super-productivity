import { getErrorTxt } from './get-error-text';
import { HANDLED_ERROR_PROP_STR } from '../app.constants';

describe('getErrorTxt', () => {
  it('should return string errors directly', () => {
    expect(getErrorTxt('simple error')).toBe('simple error');
  });

  it('should handle null', () => {
    expect(getErrorTxt(null)).toBe('Unknown error (null/undefined)');
  });

  it('should handle undefined', () => {
    expect(getErrorTxt(undefined)).toBe('Unknown error (null/undefined)');
  });

  it('should extract message from Error instances', () => {
    const err = new Error('test error message');
    expect(getErrorTxt(err)).toBe('test error message');
  });

  it('should extract message from plain objects with message property', () => {
    expect(getErrorTxt({ message: 'object error' })).toBe('object error');
  });

  it('should handle HANDLED_ERROR_PROP_STR', () => {
    const err = { [HANDLED_ERROR_PROP_STR]: 'handled error message' };
    expect(getErrorTxt(err)).toBe('handled error message');
  });

  it('should extract nested error.message (HttpErrorResponse pattern)', () => {
    const err = { error: { message: 'nested error message' } };
    expect(getErrorTxt(err)).toBe('nested error message');
  });

  it('should extract error.name when message is not available', () => {
    const err = { error: { name: 'ValidationError' } };
    expect(getErrorTxt(err)).toBe('ValidationError');
  });

  it('should extract deeply nested error.error.message', () => {
    const err = { error: { error: { message: 'deep nested message' } } };
    expect(getErrorTxt(err)).toBe('deep nested message');
  });

  it('should extract name property when message is not available', () => {
    const err = { name: 'CustomError' };
    expect(getErrorTxt(err)).toBe('CustomError');
  });

  it('should extract statusText for HTTP errors', () => {
    const err = { statusText: 'Not Found' };
    expect(getErrorTxt(err)).toBe('Not Found');
  });

  it('should never return [object Object]', () => {
    const plainObject = { foo: 'bar' };
    const result = getErrorTxt(plainObject);
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('foo');
  });

  it('should JSON.stringify objects without standard error properties', () => {
    const err = { code: 500, details: 'server error' };
    const result = getErrorTxt(err);
    expect(result).toContain('code');
    expect(result).toContain('500');
  });

  it('should handle empty objects', () => {
    const result = getErrorTxt({});
    expect(result).toBe('Unknown error (unable to extract message)');
  });

  it('should prioritize HANDLED_ERROR_PROP_STR over message', () => {
    const err = {
      [HANDLED_ERROR_PROP_STR]: 'handled',
      message: 'regular message',
    };
    expect(getErrorTxt(err)).toBe('handled');
  });

  it('should handle TypeError instances', () => {
    const err = new TypeError('Cannot read property of undefined');
    expect(getErrorTxt(err)).toBe('Cannot read property of undefined');
  });

  it('should handle objects with custom toString that does not return [object Object]', () => {
    const err = {
      toString: () => 'custom error string',
    };
    expect(getErrorTxt(err)).toBe('custom error string');
  });

  it('should truncate long JSON strings', () => {
    const longValue = 'x'.repeat(300);
    const err = { data: longValue };
    const result = getErrorTxt(err);
    expect(result.length).toBeLessThanOrEqual(203); // 200 + '...'
  });

  it('should handle circular reference objects gracefully', () => {
    const err: any = { message: null, data: {} };
    err.data.self = err; // circular reference
    const result = getErrorTxt(err);
    // Should not throw and should not return [object Object]
    expect(result).not.toBe('[object Object]');
    expect(result).toBe('Unknown error (unable to extract message)');
  });

  it('should handle arrays', () => {
    const result = getErrorTxt(['error1', 'error2']);
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('error1');
  });

  it('should handle numbers', () => {
    expect(getErrorTxt(404)).toBe('404');
  });

  it('should handle booleans', () => {
    expect(getErrorTxt(false)).toBe('false');
  });

  it('should handle objects where toString throws', () => {
    const err = {
      toString: () => {
        throw new Error('toString failed');
      },
    };
    const result = getErrorTxt(err);
    expect(result).not.toBe('[object Object]');
  });

  it('should handle empty string message', () => {
    const err = { message: '' };
    const result = getErrorTxt(err);
    // Empty message falls through to JSON.stringify
    expect(result).not.toBe('[object Object]');
    expect(result).toContain('message');
  });

  it('should handle RangeError instances', () => {
    const err = new RangeError('Maximum call stack size exceeded');
    expect(getErrorTxt(err)).toBe('Maximum call stack size exceeded');
  });

  it('should handle SyntaxError instances', () => {
    const err = new SyntaxError('Unexpected token');
    expect(getErrorTxt(err)).toBe('Unexpected token');
  });

  it('should handle DOMException-like objects', () => {
    const err = { name: 'NotFoundError', message: 'Node was not found' };
    expect(getErrorTxt(err)).toBe('Node was not found');
  });

  it('should handle HTTP response error objects', () => {
    const err = {
      status: 500,
      statusText: 'Internal Server Error',
      error: { message: 'Database connection failed' },
    };
    expect(getErrorTxt(err)).toBe('Database connection failed');
  });

  it('should handle Axios-style error with response.data.error', () => {
    const err = {
      response: {
        status: 401,
        data: { error: 'Unauthorized access' },
      },
    };
    const result = getErrorTxt(err);
    // Should JSON.stringify since no direct message property
    expect(result).toContain('Unauthorized');
  });
});

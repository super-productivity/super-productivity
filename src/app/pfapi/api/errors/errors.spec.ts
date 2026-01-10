import {
  DataValidationFailedError,
  DecompressError,
  extractErrorMessage,
  HttpNotOkAPIError,
} from './errors';

describe('HttpNotOkAPIError', () => {
  it('should successfully strip script tags (fix "kt toast" issue)', () => {
    const response = new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
    // Simulating a body where "kt toast" is inside a script tag
    const body = `
      <html>
        <head>
          <script>
            var kt = { toast: { show: function() {} } };
            kt.toast.show('Some ignored message');
          </script>
        </head>
        <body>
          <h1>Actual Error</h1>
        </body>
      </html>
    `;

    const error = new HttpNotOkAPIError(response, body);
    // The content inside <script> should now be removed
    expect(error.message).not.toContain('kt');
    expect(error.message).toContain('Actual Error');
  });
});

describe('DataValidationFailedError', () => {
  let consoleLogSpy: jasmine.Spy;
  let consoleErrorSpy: jasmine.Spy;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log');
    consoleErrorSpy = spyOn(console, 'error');
  });

  it('should handle validation result with errors property', () => {
    const validationResult = {
      errors: [
        { path: 'test.path', expected: 'string', value: 123 },
        { path: 'another.path', expected: 'boolean', value: 'not a boolean' },
      ],
    };

    const error = new DataValidationFailedError(validationResult as any);

    expect(error.name).toBe('DataValidationFailedError');
    expect(error.message).toContain('test.path');
    expect(error.message).toContain('another.path');
    expect(error.additionalLog).toBeDefined();
    expect(error.additionalLog).toContain('test.path');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[pf]',
      'validation result: ',
      validationResult,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[pf]',
      jasmine.stringContaining('validation errors_:'),
    );
  });

  it('should include error paths in message with count for many errors', () => {
    const validationResult = {
      errors: [
        { path: 'path.one', expected: 'string', value: 1 },
        { path: 'path.two', expected: 'string', value: 2 },
        { path: 'path.three', expected: 'string', value: 3 },
        { path: 'path.four', expected: 'string', value: 4 },
        { path: 'path.five', expected: 'string', value: 5 },
      ],
    };

    const error = new DataValidationFailedError(validationResult as any);

    expect(error.message).toContain('path.one');
    expect(error.message).toContain('path.two');
    expect(error.message).toContain('path.three');
    expect(error.message).toContain('(+2 more)');
    expect(error.message).not.toContain('path.four');
  });

  it('should truncate long error strings to 400 characters', () => {
    const longError = { message: 'x'.repeat(500) };
    const validationResult = {
      errors: Array(50).fill(longError),
    };

    const error = new DataValidationFailedError(validationResult as any);

    expect(error.additionalLog).toBeDefined();
    expect(error.additionalLog!.length).toBe(400);
  });

  it('should handle validation result without errors property', () => {
    const validationResult = {
      success: false,
      message: 'Validation failed',
    };

    const error = new DataValidationFailedError(validationResult as any);

    expect(error.name).toBe('DataValidationFailedError');
    expect(error.message).toBe('Data validation failed');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[pf]',
      'validation result: ',
      validationResult,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[pf]',
      jasmine.stringContaining('validation result_:'),
    );
  });

  it('should catch and log errors when stringifying fails', () => {
    const circularRef: any = { prop: null };
    circularRef.prop = circularRef;
    const validationResult = {
      errors: circularRef,
    };

    const error = new DataValidationFailedError(validationResult as any);

    expect(error.name).toBe('DataValidationFailedError');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[pf]',
      'Failed to stringify validation errors:',
      jasmine.any(Error),
    );
  });

  it('should not throw when validation result causes stringify error', () => {
    const validationResult = {
      get errors() {
        throw new Error('Cannot access errors');
      },
    };

    expect(() => new DataValidationFailedError(validationResult as any)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[pf]',
      'Failed to stringify validation errors:',
      jasmine.any(Error),
    );
  });
});

describe('extractErrorMessage', () => {
  it('should return string directly', () => {
    expect(extractErrorMessage('my error')).toBe('my error');
  });

  it('should return null for empty string', () => {
    expect(extractErrorMessage('')).toBeNull();
  });

  it('should return null for null', () => {
    expect(extractErrorMessage(null)).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(extractErrorMessage(undefined)).toBeNull();
  });

  it('should extract message from Error', () => {
    expect(extractErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('should extract message from nested cause (DecompressionStream pattern)', () => {
    const innerError = new Error('incorrect header check');
    const outerError = new TypeError('', { cause: innerError });
    expect(extractErrorMessage(outerError)).toBe('incorrect header check');
  });

  it('should extract zlib error code and make it readable', () => {
    const error = Object.assign(new Error(''), { code: 'Z_DATA_ERROR' });
    expect(extractErrorMessage(error)).toBe('Compression error: data error');
  });

  it('should extract zlib buffer error code', () => {
    const error = Object.assign(new Error(''), { code: 'Z_BUF_ERROR' });
    expect(extractErrorMessage(error)).toBe('Compression error: buf error');
  });

  it('should extract non-zlib error code as-is', () => {
    const error = Object.assign(new Error(''), { code: 'ENOENT' });
    expect(extractErrorMessage(error)).toBe('ENOENT');
  });

  it('should prefer cause message over error code', () => {
    const innerError = new Error('specific cause message');
    const outerError = Object.assign(new TypeError('', { cause: innerError }), {
      code: 'Z_DATA_ERROR',
    });
    expect(extractErrorMessage(outerError)).toBe('specific cause message');
  });

  it('should fall back to error message when no cause', () => {
    expect(extractErrorMessage(new TypeError('type error message'))).toBe(
      'type error message',
    );
  });

  it('should extract message from plain object with message property', () => {
    expect(extractErrorMessage({ message: 'object message' })).toBe('object message');
  });

  it('should return null for object with empty message', () => {
    expect(extractErrorMessage({ message: '' })).toBeNull();
  });

  it('should return null for object without message', () => {
    expect(extractErrorMessage({ foo: 'bar' })).toBeNull();
  });

  it('should return null for number', () => {
    expect(extractErrorMessage(42)).toBeNull();
  });
});

describe('DecompressError', () => {
  beforeEach(() => {
    spyOn(console, 'log');
  });

  it('should have meaningful message from string argument', () => {
    const error = new DecompressError('decompression failed');
    expect(error.name).toBe('DecompressError');
    expect(error.message).toBe('decompression failed');
  });

  it('should extract message from Error with cause (DecompressionStream pattern)', () => {
    const innerError = new Error('incorrect header check');
    const outerError = new TypeError('', { cause: innerError });
    const error = new DecompressError(outerError);

    expect(error.name).toBe('DecompressError');
    expect(error.message).toBe('incorrect header check');
  });

  it('should extract message from Error with zlib code', () => {
    const zlibError = Object.assign(new Error(''), { code: 'Z_DATA_ERROR' });
    const error = new DecompressError(zlibError);

    expect(error.name).toBe('DecompressError');
    expect(error.message).toBe('Compression error: data error');
  });

  it('should use fallback message when error has no extractable message', () => {
    const emptyError = new Error('');
    const error = new DecompressError(emptyError);

    expect(error.name).toBe('DecompressError');
    expect(error.message).toBe('Unknown error');
  });

  it('should not produce minified class name as message', () => {
    // This is the key test - simulates what happens in production builds
    const emptyMessageError = new TypeError('');
    const error = new DecompressError(emptyMessageError);

    // The message should NOT be the minified class name (e.g., "MA")
    // It should be a meaningful fallback
    expect(error.message).not.toMatch(/^[A-Z]{1,3}$/);
    expect(error.message.length).toBeGreaterThan(3);
  });
});

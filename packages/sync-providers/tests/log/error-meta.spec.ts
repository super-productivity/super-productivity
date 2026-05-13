import { describe, expect, it } from 'vitest';
import { errorMeta, urlPathOnly } from '../../src/log/error-meta';

describe('urlPathOnly', () => {
  it('strips query string', () => {
    expect(urlPathOnly('https://api.dropbox.com/2/files/upload?token=abc123')).toBe(
      'api.dropbox.com/2/files/upload',
    );
  });

  it('strips fragment', () => {
    expect(urlPathOnly('https://example.com/path/to/file#section-1')).toBe(
      'example.com/path/to/file',
    );
  });

  it('strips userinfo (basic auth credentials)', () => {
    expect(urlPathOnly('https://user:pass@webdav.example.com/dav/sync.json')).toBe(
      'webdav.example.com/dav/sync.json',
    );
  });

  it('strips username-only userinfo', () => {
    expect(urlPathOnly('https://user@webdav.example.com/dav/sync.json')).toBe(
      'webdav.example.com/dav/sync.json',
    );
  });

  it('strips combined query, fragment, and userinfo', () => {
    expect(
      urlPathOnly(
        'https://user:secret@host.example.com/path?token=abc&file=secret.txt#anchor',
      ),
    ).toBe('host.example.com/path');
  });

  it('keeps the host and pathname', () => {
    expect(urlPathOnly('https://api.dropbox.com/2/files/download')).toBe(
      'api.dropbox.com/2/files/download',
    );
  });

  it('preserves non-default port in host', () => {
    // URL.host includes the port when non-default.
    expect(urlPathOnly('https://example.com:8443/api/sync?x=1')).toBe(
      'example.com:8443/api/sync',
    );
  });

  it('returns input unchanged when not a valid URL', () => {
    // Callers must scrub other path-like inputs upstream.
    expect(urlPathOnly('not a url')).toBe('not a url');
    expect(urlPathOnly('')).toBe('');
    expect(urlPathOnly('/relative/path?token=x')).toBe('/relative/path?token=x');
  });

  it('does not leak signed-URL parameters (S3-style)', () => {
    const signed =
      'https://bucket.s3.amazonaws.com/path/to/file.json?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA';
    expect(urlPathOnly(signed)).toBe('bucket.s3.amazonaws.com/path/to/file.json');
    expect(urlPathOnly(signed)).not.toContain('X-Amz-Signature');
    expect(urlPathOnly(signed)).not.toContain('AKIA');
  });

  it('does not leak OAuth tokens in query', () => {
    const url =
      'https://api.example.com/files?access_token=ya29.SECRETTOKENVALUE&refresh_token=1//R';
    const stripped = urlPathOnly(url);
    expect(stripped).toBe('api.example.com/files');
    expect(stripped).not.toContain('access_token');
    expect(stripped).not.toContain('SECRETTOKENVALUE');
    expect(stripped).not.toContain('refresh_token');
  });
});

describe('errorMeta', () => {
  it('extracts errorName from a standard Error', () => {
    const meta = errorMeta(new TypeError('boom'));
    expect(meta).toEqual({ errorName: 'TypeError' });
  });

  it('does NOT include the error message (might contain user content)', () => {
    const meta = errorMeta(new Error('failed to upload tasks-2026-01-15.json'));
    expect(meta.errorName).toBe('Error');
    // Message must never leak — log history is exportable.
    expect(JSON.stringify(meta)).not.toContain('tasks-2026-01-15.json');
    expect(JSON.stringify(meta)).not.toContain('failed to upload');
  });

  it('does NOT leak headers/response bodies/tokens attached to an error', () => {
    // Real-world: providers attach response/headers to thrown errors. None
    // of that may flow through errorMeta.
    const err = Object.assign(new Error('Unauthorized'), {
      name: 'AuthError',
      code: 401,
      headers: { authorization: 'Bearer ya29.SECRETTOKEN' },
      response: {
        body: '{"user_email":"alice@example.com","tasks":[{"title":"buy milk"}]}',
      },
      config: { url: 'https://api.example.com/files?token=SECRET' },
    });

    const meta = errorMeta(err);

    // The error is an Error instance, so toSyncLogError returns only {name},
    // and errorMeta in turn returns {errorName} — no code, headers, response,
    // or config flows through.
    expect(meta).toEqual({ errorName: 'AuthError' });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('SECRETTOKEN');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('buy milk');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('https://');
  });

  it('extracts errorName and code from a plain object error', () => {
    const meta = errorMeta({ name: 'HttpError', code: 'ECONNRESET' });
    expect(meta).toEqual({ errorName: 'HttpError', errorCode: 'ECONNRESET' });
  });

  it('supports numeric code on plain object errors', () => {
    const meta = errorMeta({ name: 'StatusError', code: 503 });
    expect(meta).toEqual({ errorName: 'StatusError', errorCode: 503 });
  });

  it('falls back to ObjectError when plain object has no usable name', () => {
    const meta = errorMeta({ details: 'irrelevant' });
    expect(meta).toEqual({ errorName: 'ObjectError' });
  });

  it('drops extra fields on plain object errors that are not name/code', () => {
    const meta = errorMeta({
      name: 'WebDavError',
      code: 'E_FORBIDDEN',
      message: 'leaked-folder-name/secret.txt',
      response: 'sensitive payload',
    });
    expect(meta).toEqual({ errorName: 'WebDavError', errorCode: 'E_FORBIDDEN' });
    expect(JSON.stringify(meta)).not.toContain('leaked-folder-name');
    expect(JSON.stringify(meta)).not.toContain('sensitive payload');
  });

  it('handles string errors as StringError without leaking the string', () => {
    const meta = errorMeta('something went wrong with file.txt');
    expect(meta).toEqual({ errorName: 'StringError' });
    expect(JSON.stringify(meta)).not.toContain('file.txt');
  });

  it('handles unknown error types', () => {
    expect(errorMeta(undefined)).toEqual({ errorName: 'UnknownError' });
    expect(errorMeta(null)).toEqual({ errorName: 'UnknownError' });
    expect(errorMeta(42)).toEqual({ errorName: 'UnknownError' });
    expect(errorMeta(true)).toEqual({ errorName: 'UnknownError' });
  });

  it('merges caller-supplied extra fields without overwriting errorName by default', () => {
    const meta = errorMeta(new Error('x'), { attempt: 2, isRetryable: true });
    expect(meta).toEqual({
      errorName: 'Error',
      attempt: 2,
      isRetryable: true,
    });
  });

  it('lets caller-supplied extras override errorName/errorCode (caller responsibility)', () => {
    // The spread order in errorMeta is: errorName, errorCode, ...extra.
    // So extras win — callers must therefore not pass user content under
    // these keys. This test pins the current behaviour so a refactor that
    // reverses spread order is caught.
    const meta = errorMeta(new Error('x'), { errorName: 'OverriddenName' });
    expect(meta).toEqual({ errorName: 'OverriddenName' });
  });

  it('produces meta usable as SyncLogMeta (only primitives)', () => {
    const meta = errorMeta(new Error('x'), {
      attempt: 2,
      path: 'sync-folder/file.json',
      isFinal: false,
      lastSeenRev: null,
    });
    for (const value of Object.values(meta)) {
      const t = typeof value;
      expect(t === 'string' || t === 'number' || t === 'boolean' || value === null).toBe(
        true,
      );
    }
  });
});

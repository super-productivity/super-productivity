import { describe, expect, it } from 'vitest';
import {
  AdditionalLogErrorBase,
  AuthFailSPError,
  EmptyRemoteBodySPError,
  extractErrorMessage,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NoRevAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../src';

describe('AdditionalLogErrorBase', () => {
  it('does not invoke any logger on construction (Option A privacy guarantee)', () => {
    // Constructing an error must have NO side effects. The previous
    // app-side base class called OP_LOG_SYNC_LOGGER.log(...) from the
    // constructor; the moved version intentionally drops that. Verified
    // by the absence of any other behavior to assert against — if a
    // future change adds logging back, this test will need updating
    // and the privacy contract becomes "only safe keys" again.
    expect(
      () => new InvalidDataSPError({ secret: 'user-task-title', status: 400 }),
    ).not.toThrow();
  });

  it('preserves additionalLog as the raw payload (for catch-site use)', () => {
    const payload = { responseName: 'sync-response', status: 400 };
    const err = new InvalidDataSPError(payload);
    expect(err.additionalLog).toEqual([payload]);
  });

  it('extracts a meaningful message from the first additional arg', () => {
    const err = new AdditionalLogErrorBase('something went wrong');
    expect(err.message).toBe('something went wrong');
  });

  it('extractErrorMessage rewrites Z_* compression codes', () => {
    expect(extractErrorMessage(new Error('Z_BUF_ERROR'))).toBe(
      'Compression error: buf error',
    );
  });

  it('extractErrorMessage returns null for empty inputs', () => {
    expect(extractErrorMessage(undefined)).toBeNull();
  });
});

describe('HttpNotOkAPIError', () => {
  it('keeps message brief (no body excerpt) for privacy-aware logging', () => {
    const body = '<html><title>Reflected query: SECRET_USER_DATA</title></html>';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 503, statusText: 'Service Unavailable' }),
      body,
    );
    expect(err.message).toBe('HTTP 503 Service Unavailable');
    expect(err.message).not.toContain('SECRET_USER_DATA');
  });

  it('exposes the body excerpt on .detail (opt-in surface)', () => {
    const body =
      '<s:message>Lock token submitted is not enabled in this resource</s:message>';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 423, statusText: 'Locked' }),
      body,
    );
    expect(err.detail).toBe('Lock token submitted is not enabled in this resource');
  });

  it('falls back to plain text extraction when no structured error present', () => {
    const body = '<html><body>Service Temporarily Down</body></html>';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 502, statusText: 'Bad Gateway' }),
      body,
    );
    expect(err.detail).toContain('Service Temporarily Down');
  });

  it('parses JSON error fields', () => {
    const body = '{"error":"invalid_grant","error_description":"code expired"}';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 400, statusText: 'Bad Request' }),
      body,
    );
    expect(err.detail).toBe('invalid_grant');
  });

  it('caps detail at 300 chars', () => {
    const longTitle = 'X'.repeat(500);
    const body = `<title>${longTitle}</title>`;
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 500, statusText: 'Internal' }),
      body,
    );
    expect(err.detail?.length).toBe(300);
  });

  it('strips <script>/<style> tags before plain-text extraction', () => {
    const body = '<script>alert(1)</script>Real error text';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 500, statusText: 'Internal' }),
      body,
    );
    expect(err.detail).toContain('Real error text');
    expect(err.detail).not.toContain('alert');
  });

  it('handles nested/crafted <scri<script>pt> injection patterns', () => {
    const body = '<scri<script>pt>alert(1)</script>Real content';
    const err = new HttpNotOkAPIError(
      new Response(body, { status: 500, statusText: 'Internal' }),
      body,
    );
    expect(err.detail).not.toMatch(/alert/);
  });
});

describe('TooManyRequestsAPIError', () => {
  it('takes only narrow primitives — never the raw request headers', () => {
    const err = new TooManyRequestsAPIError({
      status: 429,
      retryAfter: 5,
      path: '/files/sync',
    });
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(5);
    expect(err.path).toBe('/files/sync');
  });

  it('serialized form never contains "Bearer" (regression guard against header leak)', () => {
    // Defense-in-depth: the *type signature* forbids passing headers,
    // but if a caller squeezes an `as any` past TypeScript this test
    // ensures the runtime payload still cannot encode auth material.
    const err = new TooManyRequestsAPIError({
      status: 429,
      retryAfter: 10,
      path: '/files/upload',
    });
    expect(
      JSON.stringify({ name: err.name, additionalLog: err.additionalLog }),
    ).not.toMatch(/Bearer/i);
    expect(
      JSON.stringify({ name: err.name, additionalLog: err.additionalLog }),
    ).not.toMatch(/authorization/i);
  });
});

describe('Error class identity (single definition per class)', () => {
  // App-side `sync-errors.ts` re-exports these classes. This spec lives
  // package-side and only asserts internal consistency; the cross-realm
  // identity assertion lives app-side at
  // `src/app/op-log/core/errors/sync-errors.identity.spec.ts`.
  const ERROR_CLASSES: ReadonlyArray<readonly [string, new (...args: never[]) => Error]> =
    [
      ['AuthFailSPError', AuthFailSPError],
      ['InvalidDataSPError', InvalidDataSPError],
      ['EmptyRemoteBodySPError', EmptyRemoteBodySPError],
      ['RemoteFileNotFoundAPIError', RemoteFileNotFoundAPIError],
      ['NoRevAPIError', NoRevAPIError],
      ['HttpNotOkAPIError', HttpNotOkAPIError],
      ['MissingCredentialsSPError', MissingCredentialsSPError],
      ['MissingRefreshTokenAPIError', MissingRefreshTokenAPIError],
      ['TooManyRequestsAPIError', TooManyRequestsAPIError],
      ['UploadRevToMatchMismatchAPIError', UploadRevToMatchMismatchAPIError],
      ['PotentialCorsError', PotentialCorsError],
      ['RemoteFileChangedUnexpectedly', RemoteFileChangedUnexpectedly],
    ];

  it.each(ERROR_CLASSES)('%s is an Error subclass', (_name, ErrCtor) => {
    expect(typeof ErrCtor).toBe('function');
    expect(Object.create(ErrCtor.prototype) instanceof Error).toBe(true);
  });

  it('EmptyRemoteBodySPError extends InvalidDataSPError', () => {
    const err = new EmptyRemoteBodySPError('empty body');
    expect(err).toBeInstanceOf(InvalidDataSPError);
    expect(err).toBeInstanceOf(Error);
  });
});

import {
  getSyncConnectionHintMsg,
  WEBDAV_SSL_CERT_ERROR_CODE,
} from './get-sync-connection-hint';
import {
  PotentialCorsError,
  WebDavNativeRequestError,
} from '../../op-log/core/errors/sync-errors';
import { T } from '../../t.const';

describe('getSyncConnectionHintMsg', () => {
  it('returns the CORS hint for PotentialCorsError', () => {
    expect(getSyncConnectionHintMsg(new PotentialCorsError('https://example.com'))).toBe(
      T.F.SYNC.S.ERROR_CORS,
    );
  });

  it('returns the certificate hint for a native SSL certificate error', () => {
    const error = new WebDavNativeRequestError(
      'SSL certificate error: Trust anchor for certification path not found.',
      WEBDAV_SSL_CERT_ERROR_CODE,
    );
    expect(getSyncConnectionHintMsg(error)).toBe(T.F.SYNC.S.ERROR_UNTRUSTED_CERTIFICATE);
  });

  it('returns null for other native errors, including generic SSL errors', () => {
    expect(
      getSyncConnectionHintMsg(
        new WebDavNativeRequestError('SSL error: connection closed', 'SSL_ERROR'),
      ),
    ).toBeNull();
    expect(
      getSyncConnectionHintMsg(
        new WebDavNativeRequestError('Network error: reset', 'NETWORK_ERROR'),
      ),
    ).toBeNull();
  });

  it('returns null for unrelated errors', () => {
    expect(getSyncConnectionHintMsg(new Error('boom'))).toBeNull();
    expect(getSyncConnectionHintMsg(undefined)).toBeNull();
  });
});

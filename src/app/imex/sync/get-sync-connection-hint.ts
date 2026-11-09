import {
  PotentialCorsError,
  WebDavNativeRequestError,
} from '../../op-log/core/errors/sync-errors';
import { T } from '../../t.const';

/**
 * Error code the Android `WebDavHttp` plugin rejects with when the server
 * certificate is untrusted or does not match the host name (#2855). Must match
 * `WebDavHttpPlugin.kt` `handleError`.
 */
export const WEBDAV_SSL_CERT_ERROR_CODE = 'SSL_CERT_ERROR';

/**
 * Translation key of an actionable hint for connection errors that need the
 * user to fix their server or device setup, or `null` for any other error.
 */
export const getSyncConnectionHintMsg = (error: unknown): string | null => {
  if (error instanceof PotentialCorsError) {
    return T.F.SYNC.S.ERROR_CORS;
  }
  if (
    error instanceof WebDavNativeRequestError &&
    error.code === WEBDAV_SSL_CERT_ERROR_CODE
  ) {
    return T.F.SYNC.S.ERROR_UNTRUSTED_CERTIFICATE;
  }
  return null;
};

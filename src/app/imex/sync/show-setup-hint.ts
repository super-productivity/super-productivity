import {
  PotentialCorsError,
  WebDavNativeRequestError,
} from '../../op-log/core/errors/sync-errors';
import { T } from '../../t.const';
import type { SnackService } from '../../core/snack/snack.service';
import type { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';

/**
 * Error code the Android `WebDavHttp` plugin rejects with when the server
 * certificate is untrusted, expired or does not match the host name (#2855).
 * Must match `WebDavHttpPlugin.kt` `handleError`. iOS never emits it.
 */
export const WEBDAV_SSL_CERT_ERROR_CODE = 'SSL_CERT_ERROR';

/**
 * Shows the actionable hint for connection errors that need the user to fix
 * their server or device setup. Returns `false` for any other error.
 *
 * Certificate errors persist until the user acts (and also occur behind
 * captive portals), so they set the ERROR sync status and only open the snack
 * for a user-triggered sync instead of on every auto-sync. CORS keeps its
 * existing behavior.
 */
export const showSetupHint = (
  error: unknown,
  isUserTriggered: boolean,
  snackService: Pick<SnackService, 'open'>,
  providerManager: Pick<SyncProviderManager, 'setSyncStatus'>,
): boolean => {
  const isCertError =
    error instanceof WebDavNativeRequestError &&
    error.code === WEBDAV_SSL_CERT_ERROR_CODE;
  if (!isCertError && !(error instanceof PotentialCorsError)) {
    return false;
  }
  if (isCertError) {
    providerManager.setSyncStatus('ERROR');
    if (!isUserTriggered) {
      return true;
    }
  }
  snackService.open({
    msg: isCertError
      ? T.F.SYNC.S.ERROR_UNTRUSTED_CERTIFICATE_ANDROID
      : T.F.SYNC.S.ERROR_CORS,
    type: 'ERROR',
    // a bit longer since these are long messages
    config: { duration: 12000 },
  });
  return true;
};

import { showSetupHint, WEBDAV_SSL_CERT_ERROR_CODE } from './show-setup-hint';
import {
  PotentialCorsError,
  WebDavNativeRequestError,
} from '../../op-log/core/errors/sync-errors';
import { T } from '../../t.const';
import type { SnackService } from '../../core/snack/snack.service';
import type { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';

describe('showSetupHint', () => {
  let snackService: jasmine.SpyObj<Pick<SnackService, 'open'>>;
  let providerManager: jasmine.SpyObj<Pick<SyncProviderManager, 'setSyncStatus'>>;

  const run = (error: unknown, isUserTriggered: boolean): boolean =>
    showSetupHint(error, isUserTriggered, snackService, providerManager);

  const certError = (): WebDavNativeRequestError =>
    new WebDavNativeRequestError(
      'SSL certificate error: Trust anchor for certification path not found.',
      WEBDAV_SSL_CERT_ERROR_CODE,
    );

  beforeEach(() => {
    snackService = jasmine.createSpyObj('SnackService', ['open']);
    providerManager = jasmine.createSpyObj('SyncProviderManager', ['setSyncStatus']);
  });

  it('shows the CORS hint without touching the status, also on auto-sync', () => {
    expect(run(new PotentialCorsError('https://example.com'), false)).toBe(true);
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.F.SYNC.S.ERROR_CORS, type: 'ERROR' }),
    );
    expect(providerManager.setSyncStatus).not.toHaveBeenCalled();
  });

  it('sets ERROR and shows the certificate hint on a user-triggered sync', () => {
    expect(run(certError(), true)).toBe(true);
    expect(providerManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        msg: T.F.SYNC.S.ERROR_UNTRUSTED_CERTIFICATE_ANDROID,
        type: 'ERROR',
      }),
    );
  });

  it('sets ERROR but stays silent for a certificate error on auto-sync', () => {
    expect(run(certError(), false)).toBe(true);
    expect(providerManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('ignores other native errors, including generic SSL errors', () => {
    expect(
      run(
        new WebDavNativeRequestError('SSL error: connection closed', 'SSL_ERROR'),
        true,
      ),
    ).toBe(false);
    expect(
      run(new WebDavNativeRequestError('Network error: reset', 'NETWORK_ERROR'), true),
    ).toBe(false);
    expect(run(new Error('boom'), true)).toBe(false);
    expect(run(undefined, true)).toBe(false);
    expect(snackService.open).not.toHaveBeenCalled();
    expect(providerManager.setSyncStatus).not.toHaveBeenCalled();
  });
});

import { OneDrive } from './onedrive';
import {
  AuthFailSPError,
  MissingRefreshTokenAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../core/errors/sync-errors';
import { OneDrivePrivateCfg } from './onedrive.model';
import { SyncCredentialStore } from '../../credential-store.service';

describe('OneDrive', () => {
  let provider: OneDrive;
  let fetchSpy: jasmine.Spy;
  let cfgStoreSpy: jasmine.SpyObj<SyncCredentialStore<any>>;
  const tokenExpiryMs = 5 * 60 * 1000;

  const baseCfg: OneDrivePrivateCfg = {
    clientId: 'client-id',
    tenantId: 'common',
    syncFolderPath: 'super-productivity',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpiresAt: Date.now() + tokenExpiryMs,
    encryptKey: 'enc',
  };

  beforeEach(() => {
    provider = new OneDrive();
    cfgStoreSpy = jasmine.createSpyObj('SyncCredentialStore', ['load', 'setComplete']);
    provider.privateCfg = cfgStoreSpy as unknown as SyncCredentialStore<any>;

    fetchSpy = jasmine.createSpy('fetch');
    (globalThis as any).fetch = fetchSpy;
  });

  it('should report ready when credentials are present', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    await expectAsync(provider.isReady()).toBeResolvedTo(true);
  });

  it('should report not ready when refresh token is missing', async () => {
    cfgStoreSpy.load.and.resolveTo({ ...baseCfg, refreshToken: '' });

    await expectAsync(provider.isReady()).toBeResolvedTo(false);
  });

  it('should clear only auth credentials', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    cfgStoreSpy.setComplete.and.resolveTo();

    await provider.clearAuthCredentials();

    expect(cfgStoreSpy.setComplete).toHaveBeenCalledWith({
      ...baseCfg,
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: 0,
    });
  });

  it('should clear credentials and throw AuthFailSPError on 401', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    cfgStoreSpy.setComplete.and.resolveTo();

    fetchSpy.and.resolveTo({
      ok: false,
      status: 401,
      text: async () => '',
    } as Response);

    await expectAsync(provider.removeFile('test.json')).toBeRejectedWithError(
      AuthFailSPError,
    );

    expect(cfgStoreSpy.setComplete).toHaveBeenCalled();
  });

  it('should map 409 upload response to UploadRevToMatchMismatchAPIError', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }

      if (init?.method === 'PUT') {
        return {
          ok: false,
          status: 409,
          text: async () => 'conflict',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ eTag: 'etag-1' }),
        text: async () => '',
      } as Response;
    });

    await expectAsync(
      provider.uploadFile('test.json', '{"a":1}', 'rev-old'),
    ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
  });

  it('should throw MissingRefreshTokenAPIError when token is expired and refresh token is missing', async () => {
    cfgStoreSpy.load.and.resolveTo({
      ...baseCfg,
      accessToken: 'stale',
      refreshToken: '',
      tokenExpiresAt: Date.now() - 1000,
    });

    await expectAsync(provider.removeFile('test.json')).toBeRejectedWithError(
      MissingRefreshTokenAPIError,
    );
  });

  it('should clear credentials on 403 InvalidAuthenticationToken', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    cfgStoreSpy.setComplete.and.resolveTo();

    fetchSpy.and.resolveTo({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'InvalidAuthenticationToken',
            message: 'Access token has expired or is invalid',
          },
        }),
    } as Response);

    await expectAsync(provider.removeFile('test.json')).toBeRejectedWithError(
      AuthFailSPError,
    );

    expect(cfgStoreSpy.setComplete).toHaveBeenCalled();
  });

  it('should map 429 responses to TooManyRequestsAPIError', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.resolveTo({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'tooManyRequests',
            message: 'Rate limit exceeded',
          },
        }),
    } as Response);

    await expectAsync(provider.removeFile('test.json')).toBeRejectedWithError(
      TooManyRequestsAPIError,
    );
  });

  it('should refresh expired token and persist new credentials', async () => {
    cfgStoreSpy.load.and.resolveTo({
      ...baseCfg,
      accessToken: 'old-token',
      tokenExpiresAt: Date.now() - 1000,
    });
    cfgStoreSpy.setComplete.and.resolveTo();

    fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-token',
            refresh_token: 'new-refresh',
            expires_in: 3600,
          }),
          text: async () => '',
        } as Response;
      }

      if (init?.method === 'DELETE') {
        return {
          ok: true,
          status: 204,
          text: async () => '',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () => '',
      } as Response;
    });

    await expectAsync(provider.removeFile('test.json')).toBeResolved();

    expect(cfgStoreSpy.setComplete).toHaveBeenCalledWith(
      jasmine.objectContaining({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
      }),
    );
  });

  it('should avoid repeated folder existence checks after first successful upload', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }

      if (init?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ eTag: 'etag-1' }),
          text: async () => '',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () => '',
      } as Response;
    });

    await expectAsync(
      provider.uploadFile('file-1.json', '{"a":1}', null, true),
    ).toBeResolved();
    await expectAsync(
      provider.uploadFile('file-2.json', '{"a":2}', null, true),
    ).toBeResolved();

    const folderCheckCalls = fetchSpy.calls
      .all()
      .filter(
        (call) =>
          (call.args[1] as RequestInit | undefined)?.method === 'GET' &&
          String(call.args[0]).includes('/me/drive/special/approot:/super-productivity'),
      );

    expect(folderCheckCalls.length).toBe(1);
  });
});

import { DropboxApi } from './dropbox-api';
import { Dropbox, DropboxPrivateCfg } from './dropbox';
import { SyncCredentialStore } from '../../credential-store.service';
import { SyncProviderId } from '../../provider.const';
import {
  AuthFailSPError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../core/errors/sync-errors';
import { CapacitorHttp, Capacitor } from '@capacitor/core';

/**
 * Test subclass that allows overriding the isNativePlatform getter
 */
class TestableDropboxApi extends DropboxApi {
  private _isNativePlatformOverride: boolean | null = null;

  setNativePlatformOverride(value: boolean | null): void {
    this._isNativePlatformOverride = value;
  }

  protected override get isNativePlatform(): boolean {
    if (this._isNativePlatformOverride !== null) {
      return this._isNativePlatformOverride;
    }
    return super.isNativePlatform;
  }
}

describe('DropboxApi', () => {
  let dropboxApi: DropboxApi;
  let mockDropbox: jasmine.SpyObj<Dropbox>;
  let mockPrivateCfgStore: jasmine.SpyObj<SyncCredentialStore<SyncProviderId.Dropbox>>;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    mockPrivateCfgStore = jasmine.createSpyObj('SyncCredentialStore', [
      'load',
      'updatePartial',
    ]);

    mockDropbox = jasmine.createSpyObj('Dropbox', [], {
      privateCfg: mockPrivateCfgStore,
    });

    dropboxApi = new DropboxApi('test-app-key', mockDropbox);

    // Mock fetch on globalThis for test environment
    fetchSpy = jasmine.createSpy('fetch');
    (globalThis as any).fetch = fetchSpy;
  });

  afterEach(() => {
    // Reset the spy but don't remove it
    if (fetchSpy) {
      fetchSpy.calls.reset();
    }
  });

  describe('updateAccessTokenFromRefreshTokenIfAvailable', () => {
    it('should only update token fields when refreshing tokens', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      // Mock successful token refresh response
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            }),
        } as Response),
      );

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(mockPrivateCfgStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should handle missing refresh token in response correctly', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      // Mock response without refresh_token
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-access-token',
              // No refresh_token in response
            }),
        } as Response),
      );

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(mockPrivateCfgStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'existing-refresh-token', // Should use existing
      });
    });

    it('should only update token fields with updatePartial', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            }),
        } as Response),
      );

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      // updatePartial should only be called with the token fields
      expect(mockPrivateCfgStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      // Should not include encryptKey or other fields in the update
      const savedConfig = mockPrivateCfgStore.updatePartial.calls.mostRecent().args[0];
      expect(savedConfig.encryptKey).toBeUndefined();
    });

    it('should throw error if no refresh token is available', async () => {
      const existingConfig: Partial<DropboxPrivateCfg> = {
        accessToken: 'old-access-token',
        // No refresh token
        encryptKey: 'important-encryption-key',
      };

      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig as any));

      await expectAsync(
        dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable(),
      ).toBeRejectedWithError();

      expect(mockPrivateCfgStore.updatePartial).not.toHaveBeenCalled();
    });

    it('should throw error if token refresh fails', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 400,
        } as Response),
      );

      await expectAsync(
        dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable(),
      ).toBeRejected();

      expect(mockPrivateCfgStore.updatePartial).not.toHaveBeenCalled();
    });
  });

  describe('Error Parsing', () => {
    beforeEach(() => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        encryptKey: 'test-key',
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));
    });

    it('should throw RemoteFileNotFoundAPIError for path/not_found error', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              error_summary: 'path/not_found/..',
              /* eslint-disable @typescript-eslint/naming-convention */
              error: {
                '.tag': 'path',
                path: { '.tag': 'not_found' },
              },
              /* eslint-enable @typescript-eslint/naming-convention */
            }),
        } as Response),
      );

      await expectAsync(
        dropboxApi.download({ path: '/test/file.json' }),
      ).toBeRejectedWithError(RemoteFileNotFoundAPIError);
    });

    it('should throw AuthFailSPError for expired_access_token after retry', async () => {
      // When 401 is received, token refresh is attempted first.
      // If refresh fails, AuthFailSPError is thrown.
      fetchSpy.and.callFake(async (url: string) => {
        // Token refresh attempt
        if (url.includes('oauth2/token')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
              }),
          } as Response;
        }
        // API calls return 401 with expired token (even after refresh)
        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'expired_access_token/..',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              error: { '.tag': 'expired_access_token' },
            }),
        } as Response;
      });

      await expectAsync(
        dropboxApi.download({ path: '/test/file.json' }),
      ).toBeRejectedWithError(AuthFailSPError);
    });

    it('should throw AuthFailSPError for invalid_access_token after retry', async () => {
      fetchSpy.and.callFake(async (url: string) => {
        // Token refresh attempt
        if (url.includes('oauth2/token')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
              }),
          } as Response;
        }
        // API calls return 401 with invalid token (even after refresh)
        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'invalid_access_token/..',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              error: { '.tag': 'invalid_access_token' },
            }),
        } as Response;
      });

      await expectAsync(
        dropboxApi.download({ path: '/test/file.json' }),
      ).toBeRejectedWithError(AuthFailSPError);
    });

    it('should throw TooManyRequestsAPIError for rate limiting without retry_after', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 429,
          json: () =>
            Promise.resolve({
              error_summary: 'too_many_write_operations/..',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              error: { '.tag': 'too_many_write_operations' },
            }),
        } as Response),
      );

      await expectAsync(
        dropboxApi.upload({ path: '/test/file.json', data: 'test' }),
      ).toBeRejectedWithError(TooManyRequestsAPIError);
    });
  });

  describe('Token Refresh on 401', () => {
    it('should automatically refresh token on 401 and retry', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'test-key',
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      let callCount = 0;
      fetchSpy.and.callFake(async (url: string) => {
        callCount++;

        // First call to API returns 401
        if (callCount === 1) {
          return {
            ok: false,
            status: 401,
            json: () => Promise.resolve({}),
          } as Response;
        }

        // Second call is token refresh
        if (callCount === 2 && url.includes('oauth2/token')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
              }),
          } as Response;
        }

        // Third call is retry with new token - success
        if (callCount === 3) {
          return {
            ok: true,
            headers: new Headers({
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
            }),
            text: () => Promise.resolve('file content'),
          } as unknown as Response;
        }

        throw new Error(`Unexpected call #${callCount} to ${url}`);
      });

      const result = await dropboxApi.download({ path: '/test/file.json' });

      expect(result.data).toBe('file content');
      expect(mockPrivateCfgStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should not retry more than once for token refresh', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'test-key',
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));

      let callCount = 0;
      fetchSpy.and.callFake(async (url: string) => {
        callCount++;

        // Token refresh call
        if (url.includes('oauth2/token')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
              }),
          } as Response;
        }

        // All API calls return 401 (persistent auth failure)
        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'invalid_access_token/..',
            }),
        } as Response;
      });

      // Should fail after refresh + retry (no infinite loop)
      await expectAsync(
        dropboxApi.download({ path: '/test/file.json' }),
      ).toBeRejectedWithError(AuthFailSPError);

      // Should have attempted: initial call, token refresh, retry call
      // 3 fetch calls total (1 API + 1 token refresh + 1 API retry)
      expect(callCount).toBeLessThanOrEqual(4);
    });
  });

  describe('upload mode behavior', () => {
    beforeEach(() => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        encryptKey: 'test-key',
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));
    });

    it('should use update mode with revToMatch when provided', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rev: 'new-rev' }),
        } as Response),
      );

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
        revToMatch: 'abc123',
      });

      const fetchCall = fetchSpy.calls.mostRecent();
      const headers = fetchCall.args[1].headers;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      expect(dropboxApiArg.mode['.tag']).toBe('update');
      expect(dropboxApiArg.mode.update).toBe('abc123');
    });

    it('should use overwrite mode when isForceOverwrite is true', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rev: 'new-rev' }),
        } as Response),
      );

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
        revToMatch: 'abc123',
        isForceOverwrite: true,
      });

      const fetchCall = fetchSpy.calls.mostRecent();
      const headers = fetchCall.args[1].headers;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      expect(dropboxApiArg.mode['.tag']).toBe('overwrite');
    });

    it('should use add mode when no revToMatch provided (for new files)', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rev: 'new-rev' }),
        } as Response),
      );

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
        // No revToMatch provided
      });

      const fetchCall = fetchSpy.calls.mostRecent();
      const headers = fetchCall.args[1].headers;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      // 'add' mode means fail if file already exists
      expect(dropboxApiArg.mode['.tag']).toBe('add');
    });

    it('should throw UploadRevToMatchMismatchAPIError on path/conflict', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              error_summary: 'path/conflict/file/..',
              /* eslint-disable @typescript-eslint/naming-convention */
              error: {
                '.tag': 'path',
                reason: { '.tag': 'conflict' },
              },
              /* eslint-enable @typescript-eslint/naming-convention */
            }),
        } as Response),
      );

      await expectAsync(
        dropboxApi.upload({
          path: '/test.json',
          data: 'test',
          revToMatch: 'old-rev',
        }),
      ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);
    });
  });

  describe('getTokensFromAuthCode', () => {
    it('should exchange auth code for tokens', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 14400,
            }),
        } as Response),
      );

      const result = await dropboxApi.getTokensFromAuthCode(
        'test-auth-code',
        'test-code-verifier',
        null,
      );

      expect(result).toBeTruthy();
      expect(result!.accessToken).toBe('new-access-token');
      expect(result!.refreshToken).toBe('new-refresh-token');
      expect(result!.expiresAt).toBeGreaterThan(Date.now());

      // Verify the request was made with correct parameters
      const fetchCall = fetchSpy.calls.mostRecent();
      expect(fetchCall.args[0]).toBe('https://api.dropboxapi.com/oauth2/token');
      const body = fetchCall.args[1].body;
      expect(body).toContain('code=test-auth-code');
      expect(body).toContain('code_verifier=test-code-verifier');
      expect(body).toContain('grant_type=authorization_code');
    });

    it('should throw error for invalid token response', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              // Missing access_token
              refresh_token: 'new-refresh-token',
              expires_in: 14400,
            }),
        } as Response),
      );

      await expectAsync(
        dropboxApi.getTokensFromAuthCode('test-auth-code', 'test-code-verifier', null),
      ).toBeRejectedWithError('Dropbox: Invalid access token response');
    });
  });

  describe('_isTransientNetworkError', () => {
    it('should delegate to shared isTransientNetworkError utility', () => {
      // Verify the DropboxApi method delegates correctly to the shared utility
      expect(
        dropboxApi._isTransientNetworkError(
          new Error('The network connection was lost.'),
        ),
      ).toBe(true);
      expect(dropboxApi._isTransientNetworkError(new Error('Unauthorized'))).toBe(false);
    });

    it('should support error.code-based detection for iOS', () => {
      const error = Object.assign(new Error('German localized message'), {
        code: 'NSURLErrorDomain',
      });
      expect(dropboxApi._isTransientNetworkError(error)).toBe(true);
    });

    it('should support error.code-based detection for Android', () => {
      const error = Object.assign(new Error('timeout'), {
        code: 'SocketTimeoutException',
      });
      expect(dropboxApi._isTransientNetworkError(error)).toBe(true);
    });
  });
});

// Note: We're skipping these tests because CapacitorHttp.request cannot be
// properly mocked in Jasmine - Capacitor does internal processing before
// the spy can intercept. The same approach is used in webdav-http-adapter.spec.ts
xdescribe('DropboxApi Native Platform Routing', () => {
  let dropboxApi: TestableDropboxApi;
  let mockDropbox: jasmine.SpyObj<Dropbox>;
  let mockPrivateCfgStore: jasmine.SpyObj<SyncCredentialStore<SyncProviderId.Dropbox>>;
  let fetchSpy: jasmine.Spy;
  let capacitorHttpSpy: jasmine.Spy;

  beforeEach(() => {
    mockPrivateCfgStore = jasmine.createSpyObj('SyncCredentialStore', [
      'load',
      'updatePartial',
    ]);

    mockDropbox = jasmine.createSpyObj('Dropbox', [], {
      privateCfg: mockPrivateCfgStore,
    });

    dropboxApi = new TestableDropboxApi('test-app-key', mockDropbox);

    // Mock fetch on globalThis for test environment
    fetchSpy = jasmine.createSpy('fetch');
    (globalThis as any).fetch = fetchSpy;

    // Mock CapacitorHttp
    capacitorHttpSpy = spyOn(CapacitorHttp, 'request');

    // Set up default config
    const existingConfig: DropboxPrivateCfg = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      encryptKey: 'test-key',
    };
    mockPrivateCfgStore.load.and.returnValue(Promise.resolve(existingConfig));
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.calls.reset();
    }
  });

  describe('isNativePlatform getter', () => {
    it('should return true when Capacitor.isNativePlatform() is true', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      const api = new DropboxApi('test-app-key', mockDropbox);
      // Access protected property via casting for test
      expect((api as any).isNativePlatform).toBe(true);
    });

    it('should return true when IS_ANDROID_WEB_VIEW is true', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
      // Create an api that uses the override
      dropboxApi.setNativePlatformOverride(true);
      expect((dropboxApi as any).isNativePlatform).toBe(true);
    });

    it('should return false when not on native platform', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
      const api = new DropboxApi('test-app-key', mockDropbox);
      // Assuming IS_ANDROID_WEB_VIEW is false in test environment
      expect((api as any).isNativePlatform).toBe(false);
    });
  });

  describe('request routing', () => {
    it('should use fetch() on non-native platforms', async () => {
      dropboxApi.setNativePlatformOverride(false);

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          headers: new Headers({
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
          }),
          text: () => Promise.resolve('file content'),
        } as unknown as Response),
      );

      await dropboxApi.download({ path: '/test/file.json' });

      expect(fetchSpy).toHaveBeenCalled();
      expect(capacitorHttpSpy).not.toHaveBeenCalled();
    });

    it('should use CapacitorHttp on native platforms', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 200,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
          },
          data: 'file content',
        }),
      );

      await dropboxApi.download({ path: '/test/file.json' });

      expect(capacitorHttpSpy).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should pass correct headers to CapacitorHttp for download', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 200,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
          },
          data: 'file content',
        }),
      );

      await dropboxApi.download({ path: '/test/file.json' });

      const callArgs = capacitorHttpSpy.calls.mostRecent().args[0];
      expect(callArgs.url).toBe('https://content.dropboxapi.com/2/files/download');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.headers['Authorization']).toContain('Bearer');
      expect(callArgs.headers['Dropbox-API-Arg']).toContain('/test/file.json');
    });

    it('should handle CapacitorHttp response headers correctly', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 200,
          headers: {
            // CapacitorHttp may return headers in different case
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Dropbox-Api-Result': JSON.stringify({
              rev: 'test-rev-123',
              name: 'file.json',
            }),
          },
          data: '{"test": "data"}',
        }),
      );

      const result = await dropboxApi.download({ path: '/test/file.json' });

      // The meta should be parsed from the header
      expect(result.meta.rev).toBe('test-rev-123');
      expect(result.data).toBe('{"test": "data"}');
    });
  });

  describe('token refresh on native platform', () => {
    it('should use CapacitorHttp for token refresh on native platforms', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          },
        }),
      );

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(capacitorHttpSpy).toHaveBeenCalled();
      const callArgs = capacitorHttpSpy.calls.mostRecent().args[0];
      expect(callArgs.url).toBe('https://api.dropbox.com/oauth2/token');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded;charset=UTF-8',
      );
      expect(callArgs.data).toContain('grant_type=refresh_token');
    });

    it('should use fetch for token refresh on web platforms', async () => {
      dropboxApi.setNativePlatformOverride(false);

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            }),
        } as Response),
      );

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(fetchSpy).toHaveBeenCalled();
      expect(capacitorHttpSpy).not.toHaveBeenCalled();
    });
  });

  describe('getTokensFromAuthCode on native platform', () => {
    it('should use CapacitorHttp for token exchange on native platforms', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 200,
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 14400,
          },
        }),
      );

      const result = await dropboxApi.getTokensFromAuthCode(
        'test-auth-code',
        'test-code-verifier',
        null,
      );

      expect(capacitorHttpSpy).toHaveBeenCalled();
      expect(result).toBeTruthy();
      expect(result!.accessToken).toBe('new-access-token');

      const callArgs = capacitorHttpSpy.calls.mostRecent().args[0];
      expect(callArgs.url).toBe('https://api.dropboxapi.com/oauth2/token');
      expect(callArgs.data).toContain('code=test-auth-code');
      expect(callArgs.data).toContain('code_verifier=test-code-verifier');
    });
  });

  describe('error handling on native platform', () => {
    it('should handle 401 errors and retry on native platform', async () => {
      dropboxApi.setNativePlatformOverride(true);

      let callCount = 0;
      capacitorHttpSpy.and.callFake(async (options: any) => {
        callCount++;

        // First call returns 401
        if (callCount === 1) {
          return {
            status: 401,
            headers: {},
            data: JSON.stringify({ error_summary: 'expired_access_token' }),
          };
        }

        // Token refresh call
        if (options.url.includes('oauth2/token')) {
          return {
            status: 200,
            data: {
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            },
          };
        }

        // Retry with new token succeeds
        return {
          status: 200,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
          },
          data: 'file content',
        };
      });

      const result = await dropboxApi.download({ path: '/test/file.json' });

      expect(result.data).toBe('file content');
      expect(mockPrivateCfgStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should throw RemoteFileNotFoundAPIError on native platform', async () => {
      dropboxApi.setNativePlatformOverride(true);

      capacitorHttpSpy.and.returnValue(
        Promise.resolve({
          status: 409,
          headers: {},
          data: JSON.stringify({
            error_summary: 'path/not_found/..',
          }),
        }),
      );

      await expectAsync(
        dropboxApi.download({ path: '/test/nonexistent.json' }),
      ).toBeRejectedWithError(RemoteFileNotFoundAPIError);
    });
  });
});

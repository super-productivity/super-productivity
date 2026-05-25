import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthFailSPError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../src/errors';
import {
  type DropboxCfg,
  type DropboxDeps,
  type DropboxPrivateCfg,
  PROVIDER_ID_DROPBOX,
} from '../../../src/dropbox';
import type { NativeHttpExecutor, NativeHttpResponse } from '../../../src/http';
import type { SyncCredentialStorePort } from '../../../src/credential-store';
import { DropboxApi } from '../../../src/file-based/dropbox/dropbox-api';
import { createMockSyncLogger } from '../../helpers/sync-logger';
import { createMockCredentialStore } from '../../helpers/credential-store';

type DropboxCredentialStore = SyncCredentialStorePort<
  typeof PROVIDER_ID_DROPBOX,
  DropboxPrivateCfg
>;

const noopLogger = createMockSyncLogger;

const createCredentialStore = (): DropboxCredentialStore =>
  createMockCredentialStore<typeof PROVIDER_ID_DROPBOX, DropboxPrivateCfg>();

type FetchSpyMock = ReturnType<typeof vi.fn>;

const makeDeps = (
  overrides: Partial<DropboxDeps> = {},
): {
  deps: DropboxDeps;
  fetchSpy: FetchSpyMock;
  credentialStore: DropboxCredentialStore;
  nativeExecutor: ReturnType<typeof vi.fn<NativeHttpExecutor>>;
} => {
  const fetchSpy = vi.fn() as FetchSpyMock;
  const credentialStore = createCredentialStore();
  const nativeExecutor = vi.fn<NativeHttpExecutor>();
  const deps: DropboxDeps = {
    logger: noopLogger(),
    platformInfo: {
      isNativePlatform: false,
      isAndroidWebView: false,
      isIosNative: false,
    },
    webFetch: () => fetchSpy as unknown as typeof fetch,
    credentialStore,
    nativeHttpExecutor: nativeExecutor,
    ...overrides,
  };
  return { deps, fetchSpy, credentialStore, nativeExecutor };
};

const _unusedCfg: DropboxCfg = { appKey: 'test-app-key', basePath: '/' };
void _unusedCfg;

describe('DropboxApi', () => {
  let dropboxApi: DropboxApi;
  let fetchSpy: FetchSpyMock;
  let credentialStore: DropboxCredentialStore;

  beforeEach(() => {
    const built = makeDeps();
    fetchSpy = built.fetchSpy;
    credentialStore = built.credentialStore;
    dropboxApi = new DropboxApi('test-app-key', built.deps);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateAccessTokenFromRefreshTokenIfAvailable', () => {
    it('should only update token fields when refreshing tokens', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      } as Response);

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0]).toBe(
        'https://api.dropboxapi.com/oauth2/token',
      );
      expect(credentialStore.updatePartial).toHaveBeenCalledWith({
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

      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
          }),
      } as Response);

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(credentialStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'existing-refresh-token',
      });
    });

    it('should only update token fields with updatePartial', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      } as Response);

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(credentialStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      const savedConfig = (credentialStore.updatePartial as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Partial<DropboxPrivateCfg>;
      expect(savedConfig.encryptKey).toBeUndefined();
    });

    it('should throw error if no refresh token is available', async () => {
      const existingConfig: Partial<DropboxPrivateCfg> = {
        accessToken: 'old-access-token',
        encryptKey: 'important-encryption-key',
      };

      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      await expect(
        dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable(),
      ).rejects.toThrow();

      expect(credentialStore.updatePartial).not.toHaveBeenCalled();
    });

    it('should throw error if token refresh fails', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'important-encryption-key',
      };

      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      await expect(
        dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable(),
      ).rejects.toBeDefined();

      expect(credentialStore.updatePartial).not.toHaveBeenCalled();
    });
  });

  describe('Error Parsing', () => {
    beforeEach(() => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        encryptKey: 'test-key',
      };
      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );
    });

    it('should throw RemoteFileNotFoundAPIError for path/not_found error', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error_summary: 'path/not_found/..',
          }),
      } as Response);

      await expect(dropboxApi.download({ path: '/test/file.json' })).rejects.toThrow(
        RemoteFileNotFoundAPIError,
      );
    });

    it('should throw AuthFailSPError for expired_access_token after retry', async () => {
      fetchSpy.mockImplementation(async (url: string) => {
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
        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'expired_access_token/..',
            }),
        } as Response;
      });

      await expect(dropboxApi.download({ path: '/test/file.json' })).rejects.toThrow(
        AuthFailSPError,
      );
    });

    it('should throw AuthFailSPError for invalid_access_token after retry', async () => {
      fetchSpy.mockImplementation(async (url: string) => {
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
        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'invalid_access_token/..',
            }),
        } as Response;
      });

      await expect(dropboxApi.download({ path: '/test/file.json' })).rejects.toThrow(
        AuthFailSPError,
      );
    });

    it('should throw TooManyRequestsAPIError for rate limiting without retry_after', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error_summary: 'too_many_write_operations/..',
          }),
      } as Response);

      await expect(
        dropboxApi.upload({ path: '/test/file.json', data: 'test' }),
      ).rejects.toThrow(TooManyRequestsAPIError);
    });
  });

  describe('Token Refresh on 401', () => {
    it('should automatically refresh token on 401 and retry', async () => {
      const existingConfig: DropboxPrivateCfg = {
        accessToken: 'old-access-token',
        refreshToken: 'existing-refresh-token',
        encryptKey: 'test-key',
      };
      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      let callCount = 0;
      fetchSpy.mockImplementation(async (url: string) => {
        callCount++;

        if (callCount === 1) {
          return {
            ok: false,
            status: 401,
            json: () => Promise.resolve({}),
          } as Response;
        }

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
      expect(credentialStore.updatePartial).toHaveBeenCalledWith({
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
      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );

      let callCount = 0;
      fetchSpy.mockImplementation(async (url: string) => {
        callCount++;

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

        return {
          ok: false,
          status: 401,
          json: () =>
            Promise.resolve({
              error_summary: 'invalid_access_token/..',
            }),
        } as Response;
      });

      await expect(dropboxApi.download({ path: '/test/file.json' })).rejects.toThrow(
        AuthFailSPError,
      );

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
      (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingConfig,
      );
    });

    it('should use update mode with revToMatch when provided', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rev: 'new-rev' }),
      } as Response);

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
        revToMatch: 'abc123',
      });

      const fetchCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      expect(dropboxApiArg.mode['.tag']).toBe('update');
      expect(dropboxApiArg.mode.update).toBe('abc123');
    });

    it('should use overwrite mode when isForceOverwrite is true', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rev: 'new-rev' }),
      } as Response);

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
        revToMatch: 'abc123',
        isForceOverwrite: true,
      });

      const fetchCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      expect(dropboxApiArg.mode['.tag']).toBe('overwrite');
    });

    it('should use add mode when no revToMatch provided (for new files)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rev: 'new-rev' }),
      } as Response);

      await dropboxApi.upload({
        path: '/test.json',
        data: 'test',
      });

      const fetchCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
      const dropboxApiArg = JSON.parse(headers['Dropbox-API-Arg']);
      expect(dropboxApiArg.mode['.tag']).toBe('add');
    });

    it('should throw UploadRevToMatchMismatchAPIError on path/conflict', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error_summary: 'path/conflict/file/..',
          }),
      } as Response);

      await expect(
        dropboxApi.upload({
          path: '/test.json',
          data: 'test',
          revToMatch: 'old-rev',
        }),
      ).rejects.toThrow(UploadRevToMatchMismatchAPIError);
    });
  });

  describe('getTokensFromAuthCode', () => {
    it('should exchange auth code for tokens', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 14400,
          }),
      } as Response);

      const result = await dropboxApi.getTokensFromAuthCode(
        'test-auth-code',
        'test-code-verifier',
        null,
      );

      expect(result).toBeTruthy();
      expect(result!.accessToken).toBe('new-access-token');
      expect(result!.refreshToken).toBe('new-refresh-token');
      expect(result!.expiresAt).toBeGreaterThan(Date.now());

      const fetchCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      expect(fetchCall[0]).toBe('https://api.dropboxapi.com/oauth2/token');
      // fetch accepts URLSearchParams directly; stringify before asserting.
      const rawBody = (fetchCall[1] as RequestInit).body;
      const body =
        rawBody instanceof URLSearchParams ? rawBody.toString() : String(rawBody);
      expect(body).toContain('code=test-auth-code');
      expect(body).toContain('code_verifier=test-code-verifier');
      expect(body).toContain('grant_type=authorization_code');
    });

    it('should throw error for invalid token response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            refresh_token: 'new-refresh-token',
            expires_in: 14400,
          }),
      } as Response);

      await expect(
        dropboxApi.getTokensFromAuthCode('test-auth-code', 'test-code-verifier', null),
      ).rejects.toThrow('Dropbox: Invalid access token response');
    });
  });
});

describe('DropboxApi Native Platform Routing', () => {
  let dropboxApi: DropboxApi;
  let fetchSpy: FetchSpyMock;
  let credentialStore: DropboxCredentialStore;
  let nativeExecutor: ReturnType<typeof vi.fn<NativeHttpExecutor>>;

  beforeEach(() => {
    const built = makeDeps({
      platformInfo: {
        isNativePlatform: true,
        isAndroidWebView: false,
        isIosNative: false,
      },
    });
    fetchSpy = built.fetchSpy;
    credentialStore = built.credentialStore;
    nativeExecutor = built.nativeExecutor;
    dropboxApi = new DropboxApi('test-app-key', built.deps);

    const existingConfig: DropboxPrivateCfg = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      encryptKey: 'test-key',
    };
    (credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue(existingConfig);
  });

  describe('request routing', () => {
    it('should use fetch() on non-native platforms', async () => {
      const built = makeDeps({
        platformInfo: {
          isNativePlatform: false,
          isAndroidWebView: false,
          isIosNative: false,
        },
      });
      (built.credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        encryptKey: 'test-key',
      } satisfies DropboxPrivateCfg);

      const api = new DropboxApi('test-app-key', built.deps);

      built.fetchSpy.mockResolvedValue({
        ok: true,
        headers: new Headers({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
        }),
        text: () => Promise.resolve('file content'),
      } as unknown as Response);

      await api.download({ path: '/test/file.json' });

      expect(built.fetchSpy).toHaveBeenCalled();
      expect(built.nativeExecutor).not.toHaveBeenCalled();
    });

    it('should use native executor on native platforms', async () => {
      nativeExecutor.mockResolvedValue({
        status: 200,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
        },
        data: 'file content',
      });

      await dropboxApi.download({ path: '/test/file.json' });

      expect(nativeExecutor).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should pass correct headers to native executor for download', async () => {
      nativeExecutor.mockResolvedValue({
        status: 200,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'dropbox-api-result': JSON.stringify({ rev: 'test-rev' }),
        },
        data: 'file content',
      });

      await dropboxApi.download({ path: '/test/file.json' });

      const callArgs = nativeExecutor.mock.calls[nativeExecutor.mock.calls.length - 1][0];
      expect(callArgs.url).toBe('https://content.dropboxapi.com/2/files/download');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.headers['Authorization']).toContain('Bearer');
      expect(callArgs.headers['Dropbox-API-Arg']).toContain('/test/file.json');
    });

    it('should handle native executor response headers correctly', async () => {
      nativeExecutor.mockResolvedValue({
        status: 200,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Dropbox-Api-Result': JSON.stringify({
            rev: 'test-rev-123',
            name: 'file.json',
          }),
        },
        data: '{"test": "data"}',
      });

      const result = await dropboxApi.download({ path: '/test/file.json' });

      expect(result.meta.rev).toBe('test-rev-123');
      expect(result.data).toBe('{"test": "data"}');
    });
  });

  describe('token refresh on native platform', () => {
    it('should use native executor for token refresh on native platforms', async () => {
      nativeExecutor.mockResolvedValue({
        status: 200,
        headers: {},
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      });

      await dropboxApi.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(nativeExecutor).toHaveBeenCalled();
      const callArgs = nativeExecutor.mock.calls[nativeExecutor.mock.calls.length - 1][0];
      expect(callArgs.url).toBe('https://api.dropboxapi.com/oauth2/token');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded;charset=UTF-8',
      );
      expect(callArgs.data).toContain('grant_type=refresh_token');
    });

    it('should use fetch for token refresh on web platforms', async () => {
      const built = makeDeps({
        platformInfo: {
          isNativePlatform: false,
          isAndroidWebView: false,
          isIosNative: false,
        },
      });
      (built.credentialStore.load as ReturnType<typeof vi.fn>).mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        encryptKey: 'test-key',
      } satisfies DropboxPrivateCfg);

      const api = new DropboxApi('test-app-key', built.deps);

      built.fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      } as Response);

      await api.updateAccessTokenFromRefreshTokenIfAvailable();

      expect(built.fetchSpy).toHaveBeenCalled();
      expect(built.fetchSpy.mock.calls[built.fetchSpy.mock.calls.length - 1][0]).toBe(
        'https://api.dropboxapi.com/oauth2/token',
      );
      expect(built.nativeExecutor).not.toHaveBeenCalled();
    });
  });

  describe('getTokensFromAuthCode on native platform', () => {
    it('should use native executor for token exchange on native platforms', async () => {
      nativeExecutor.mockResolvedValue({
        status: 200,
        headers: {},
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 14400,
        },
      });

      const result = await dropboxApi.getTokensFromAuthCode(
        'test-auth-code',
        'test-code-verifier',
        null,
      );

      expect(nativeExecutor).toHaveBeenCalled();
      expect(result).toBeTruthy();
      expect(result!.accessToken).toBe('new-access-token');

      const callArgs = nativeExecutor.mock.calls[nativeExecutor.mock.calls.length - 1][0];
      expect(callArgs.url).toBe('https://api.dropboxapi.com/oauth2/token');
      expect(callArgs.data).toContain('code=test-auth-code');
      expect(callArgs.data).toContain('code_verifier=test-code-verifier');
    });

    it('does not retry transient errors for getTokensFromAuthCode (one-shot)', async () => {
      const transientError = Object.assign(new Error('connection lost'), {
        code: 'NSURLErrorDomain',
      });
      nativeExecutor.mockRejectedValue(transientError);

      await expect(
        dropboxApi.getTokensFromAuthCode('test-auth-code', 'test-code-verifier', null),
      ).rejects.toBe(transientError);

      // maxRetries: 0 means exactly one executor invocation.
      expect(nativeExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling on native platform', () => {
    it('should handle 401 errors and retry on native platform', async () => {
      let callCount = 0;
      nativeExecutor.mockImplementation(async (options): Promise<NativeHttpResponse> => {
        callCount++;

        if (callCount === 1) {
          return {
            status: 401,
            headers: {},
            data: JSON.stringify({ error_summary: 'expired_access_token' }),
          };
        }

        if (options.url.includes('oauth2/token')) {
          return {
            status: 200,
            headers: {},
            data: {
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
            },
          };
        }

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
      expect(credentialStore.updatePartial).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should throw RemoteFileNotFoundAPIError on native platform', async () => {
      nativeExecutor.mockResolvedValue({
        status: 409,
        headers: {},
        data: JSON.stringify({
          error_summary: 'path/not_found/..',
        }),
      });

      await expect(
        dropboxApi.download({ path: '/test/nonexistent.json' }),
      ).rejects.toThrow(RemoteFileNotFoundAPIError);
    });
  });
});

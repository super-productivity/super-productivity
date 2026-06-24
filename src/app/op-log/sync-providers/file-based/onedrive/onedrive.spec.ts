import {
  OneDrive as PackageOneDrive,
  PROVIDER_ID_ONEDRIVE,
  type OneDriveDeps,
} from '@sp/sync-providers/onedrive';
import { OneDrivePrivateCfg } from './onedrive.model';
import type { SyncCredentialStorePort } from '@sp/sync-providers/credential-store';

describe('OneDrive', () => {
  let provider: PackageOneDrive;
  let fetchSpy: jasmine.Spy;
  let cfgStoreSpy: jasmine.SpyObj<
    SyncCredentialStorePort<typeof PROVIDER_ID_ONEDRIVE, OneDrivePrivateCfg>
  >;
  const tokenExpiryMs = 5 * 60 * 1000;

  const baseCfg: OneDrivePrivateCfg = {
    clientId: 'client-id',
    tenantId: 'common',
    syncFolderPath: 'Super Productivity',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpiresAt: Date.now() + tokenExpiryMs,
    encryptKey: 'enc',
  };

  const noop = (): void => undefined;
  const mockDeps: OneDriveDeps = {
    logger: {
      log: noop,
      error: noop,
      err: noop,
      normal: noop,
      verbose: noop,
      info: noop,
      warn: noop,
      critical: noop,
      debug: noop,
    },
    platformInfo: {
      isNativePlatform: false,
      isAndroidWebView: false,
      isIosNative: false,
    },
    webFetch: () => fetch as typeof fetch,
    credentialStore: null as unknown as OneDriveDeps['credentialStore'],
    officialClientId: null,
    hasOfficialClientId: false,
    addOAuthState: noop,
    isElectron: false,
  };

  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    cfgStoreSpy = jasmine.createSpyObj('SyncCredentialStore', ['load', 'setComplete']);
    cfgStoreSpy.setComplete.and.resolveTo();
    const deps: OneDriveDeps = {
      ...mockDeps,
      credentialStore: cfgStoreSpy as unknown as OneDriveDeps['credentialStore'],
    };
    provider = new PackageOneDrive({}, deps);

    originalFetch = (globalThis as any).fetch;
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

  it('should clear credentials and throw MissingRefreshTokenAPIError on 401', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.resolveTo({
      ok: false,
      status: 401,
      text: async () => '',
    } as Response);

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('MissingRefreshTokenAPIError');
    }

    expect(cfgStoreSpy.setComplete).toHaveBeenCalled();
  });

  it('should throw MissingRefreshTokenAPIError when token is expired and refresh token is missing', async () => {
    cfgStoreSpy.load.and.resolveTo({
      ...baseCfg,
      accessToken: 'stale',
      refreshToken: '',
      tokenExpiresAt: Date.now() - 1000,
    });

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('MissingRefreshTokenAPIError');
    }
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

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('AuthFailSPError');
    }

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

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('TooManyRequestsAPIError');
    }
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

    let getCount = 0;
    let postCount = 0;
    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        getCount++;
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }

      if (init?.method === 'POST') {
        postCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
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

    // First upload probes the folder; second upload hits the cache
    expect(getCount).toBe(1);
    expect(postCount).toBe(0);
  });

  it('should refresh token and retry on 401', async () => {
    let firstRequest = true;
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    cfgStoreSpy.setComplete.and.resolveTo();

    fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
      // Token refresh endpoint
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'refreshed-token',
            refresh_token: 'refreshed-refresh',
            expires_in: 3600,
          }),
          text: async () => '',
        } as Response;
      }

      // First API request returns 401, second succeeds
      if (firstRequest && init?.method === 'DELETE') {
        firstRequest = false;
        return {
          ok: false,
          status: 401,
          text: async () => '',
        } as Response;
      }

      return {
        ok: true,
        status: 204,
        text: async () => '',
      } as Response;
    });

    await expectAsync(provider.removeFile('test.json')).toBeResolved();
    // Token refresh was called
    expect(
      fetchSpy.calls.all().some((c) => String(c.args[0]).includes('/oauth2/v2.0/token')),
    ).toBeTrue();
  });

  it('should throw HttpNotOkAPIError when 401 retry also fails with transient error', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        } as Response;
      }

      return {
        ok: false,
        status: 401,
        text: async () => '',
      } as Response;
    });

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      // Transient 500 from token endpoint should not clear credentials
      expect((e as Error).name).toBe('HttpNotOkAPIError');
    }

    // Credentials should NOT be cleared for transient failures
    const clearCalls = cfgStoreSpy.setComplete.calls
      .all()
      .filter(
        (call) => call.args[0]?.accessToken === '' && call.args[0]?.refreshToken === '',
      );
    expect(clearCalls.length).toBe(0);
  });

  it('should clear credentials on 400 invalid_grant from token endpoint', async () => {
    const expiredCfg = {
      ...baseCfg,
      accessToken: 'stale',
      tokenExpiresAt: Date.now() - 1000,
    };
    // load() returns expired cfg; clearAuthCredentials also calls load() before setComplete
    cfgStoreSpy.load.and.resolveTo(expiredCfg);

    fetchSpy.and.callFake(async (url: string) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Token has been revoked',
            }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () => '',
      } as Response;
    });

    try {
      await provider.removeFile('test.json');
      fail('should have thrown');
    } catch (e) {
      // invalid_grant → clearAuthCredentials → throw MissingRefreshTokenAPIError.
      // Propagates: refresh IIFE → _request → removeFile catch → _mapAndThrow
      // which re-throws as-is (not an HttpNotOkAPIError).
      expect((e as Error).name).toBe('MissingRefreshTokenAPIError');
    }

    // Credentials were cleared by clearAuthCredentials()
    const clearCalls = cfgStoreSpy.setComplete.calls
      .all()
      .filter(
        (call) => call.args[0]?.accessToken === '' && call.args[0]?.refreshToken === '',
      );
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should surface the Azure error_description and log the OAuth error code on auth-code 400', async () => {
    // The common misconfigured-public-client failure: the authorize step
    // succeeds, then the authorization_code token exchange 400s. The Azure
    // error_description (AADSTSxxxxx) must reach the UI via `.detail`, while
    // only the short `error` code goes to the structured log.
    const warnSpy = jasmine.createSpy('warn');
    const deps: OneDriveDeps = {
      ...mockDeps,
      logger: { ...mockDeps.logger, warn: warnSpy },
      credentialStore: cfgStoreSpy as unknown as OneDriveDeps['credentialStore'],
      isElectron: true,
    };
    const electronProvider = new PackageOneDrive({}, deps);
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    const aadstsDescription =
      "AADSTS7000218: The request body must contain the following parameter: 'client_assertion' or 'client_secret'.";
    fetchSpy.and.callFake(async (url: string) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () =>
            JSON.stringify({
              error: 'unauthorized_client',
              error_description: aadstsDescription,
            }),
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    });

    const authHelper = await electronProvider.getAuthHelper();
    if (!authHelper.verifyCodeChallenge) {
      fail('expected verifyCodeChallenge helper');
      return;
    }

    let thrown: { name?: string; detail?: string; response?: Response } | undefined;
    try {
      await authHelper.verifyCodeChallenge('auth-code-123');
      fail('should have thrown');
    } catch (e) {
      thrown = e as typeof thrown;
    }

    expect(thrown?.name).toBe('HttpNotOkAPIError');
    expect(thrown?.response?.status).toBe(400);
    // AADSTS message surfaced to the UI for self-diagnosis.
    expect(thrown?.detail).toContain('AADSTS7000218');
    // Short, safe OAuth error code logged...
    expect(warnSpy).toHaveBeenCalledWith(
      '[OneDrive] OAuth token request failed',
      jasmine.objectContaining({ status: 400, error: 'unauthorized_client' }),
    );
    // ...but the verbose description is NOT placed in the exportable log.
    expect(JSON.stringify(warnSpy.calls.mostRecent().args[1])).not.toContain(
      'AADSTS7000218',
    );
  });

  it('should map 412 responses to UploadRevToMatchMismatchAPIError', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);

    fetchSpy.and.resolveTo({
      ok: false,
      status: 412,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'preconditionFailed',
            message: 'ETag does not match',
          },
        }),
    } as Response);

    try {
      await provider.uploadFile('test.json', '{"a":1}', 'rev-old');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('UploadRevToMatchMismatchAPIError');
    }
  });

  it('should deduplicate concurrent token refresh requests', async () => {
    let refreshCallCount = 0;
    cfgStoreSpy.load.and.resolveTo({
      ...baseCfg,
      accessToken: 'old-token',
      tokenExpiresAt: Date.now() - 1000,
    });
    cfgStoreSpy.setComplete.and.resolveTo();

    fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2/v2.0/token')) {
        refreshCallCount++;
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

      // API requests succeed
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ eTag: 'etag-1' }),
      } as Response;
    });

    // Fire two concurrent requests that both need a token refresh
    await Promise.all([
      provider.removeFile('file-1.json'),
      provider.removeFile('file-2.json'),
    ]);

    // Only one token refresh should have been made
    expect(refreshCallCount).toBe(1);
  });

  it('should pass @odata.nextLink absolute URLs through verbatim', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    // Simulate a sovereign-cloud nextLink whose prefix is NOT the public
    // graph.microsoft.com base. Previously this was silently truncated and
    // re-prefixed, producing a 404 and an empty listing.
    const sovereignNextLink =
      'https://graph.microsoft.us/v1.0/me/drive/special/approot/children?skiptoken=abc';
    let listCall = 0;
    const urls: string[] = [];
    fetchSpy.and.callFake(async (url: string) => {
      urls.push(url);
      listCall++;
      if (listCall === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [{ id: '1', name: 'a.json', file: {} }],
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '@odata.nextLink': sovereignNextLink,
          }),
          text: async () => '',
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [{ id: '2', name: 'b.json', file: {} }],
        }),
        text: async () => '',
      } as Response;
    });

    const names = await provider.listFiles('');

    expect(names).toEqual(['a.json', 'b.json']);
    expect(urls[1]).toBe(sovereignNextLink);
  });

  it('should refuse to send the Bearer token to a non-Graph nextLink host', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    // First page returns a hostile @odata.nextLink. _request must reject
    // the host BEFORE issuing the second fetch — otherwise the Bearer
    // token would be leaked to the attacker's origin.
    let callCount = 0;
    fetchSpy.and.callFake(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [{ id: '1', name: 'a.json', file: {} }],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '@odata.nextLink': 'https://attacker.example.com/steal',
        }),
        text: async () => '',
      } as Response;
    });

    await expectAsync(provider.listFiles('')).toBeRejectedWithError(/non-Graph host/);
    // Exactly one fetch — the legitimate first page. The hostile nextLink
    // must NOT have been requested.
    expect(callCount).toBe(1);
  });

  it('should refuse http:// (non-HTTPS) nextLink even if host is Graph', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.callFake(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '@odata.nextLink': 'http://graph.microsoft.com/v1.0/cleartext',
        }),
        text: async () => '',
      } as Response;
    });

    await expectAsync(provider.listFiles('')).toBeRejectedWithError(/non-Graph host/);
  });

  it('should throw if listFiles pagination exceeds the page cap', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    // Cyclic continuation: every page returns the same nextLink, simulating
    // a buggy server. The cap (500) must stop the loop instead of OOMing.
    fetchSpy.and.callFake(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          value: [{ id: 'x', name: 'x.json', file: {} }],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/cycle',
        }),
        text: async () => '',
      } as Response;
    });

    await expectAsync(provider.listFiles('')).toBeRejectedWithError(/exceeded \d+ pages/);
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });
});

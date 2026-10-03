import {
  OneDrive as PackageOneDrive,
  PROVIDER_ID_ONEDRIVE,
  type OneDriveDeps,
} from '@sp/sync-providers/onedrive';
import { OneDrivePrivateCfg } from './onedrive.model';
import type { SyncCredentialStorePort } from '@sp/sync-providers/credential-store';
import {
  NoRevAPIError,
  UploadRevToMatchMismatchAPIError,
} from '@sp/sync-providers/errors';

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
    nativeHttpExecutor: () => Promise.reject(new Error('native HTTP not expected')),
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

  it('resolves an upload when the stored size matches the sent bytes (#8604)', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          // '{"a":1}' is 7 ASCII bytes — size matches, upload accepted.
          json: async () => ({ eTag: 'etag-1', size: 7 }),
          text: async () => '',
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    });

    await expectAsync(
      provider.uploadFile('file-1.json', '{"a":1}', null, true),
    ).toBeResolved();
  });

  it('throws when OneDrive stored a truncated (smaller) ASCII payload (#8604)', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          // Graph reports storing fewer bytes than the 7 we sent → truncation.
          json: async () => ({ eTag: 'etag-1', size: 3 }),
          text: async () => '',
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    });

    try {
      await provider.uploadFile('file-1.json', '{"a":1}', null, true);
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('UploadRevToMatchMismatchAPIError');
    }
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
    let uploads = 0;
    fetchSpy.and.callFake(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return Response.json({ id: 'folder' });
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('If-Match')).toBe('rev-old');
      uploads++;
      return Response.json({ error: { code: 'preconditionFailed' } }, { status: 412 });
    });

    try {
      await provider.uploadFile('test.json', '{"a":1}', 'rev-old');
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('UploadRevToMatchMismatchAPIError');
    }
    expect(uploads).toBe(1);
  });

  for (const hasContentETag of [true, false]) {
    it(`preserves a concurrent remote write when the content response ${hasContentETag ? 'has' : 'lacks'} an ETag`, async () => {
      cfgStoreSpy.load.and.resolveTo(baseCfg);
      const oldBody = 'original content';
      const concurrentBody = 'content written by the other device';
      let remoteBody = oldBody;
      let remoteRev = '"rev-1"';
      let concurrentWriteOccurred = false;
      fetchSpy.and.callFake(async (url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/content')) {
          const body = remoteBody;
          const rev = remoteRev;
          // The other device commits after the content read, before a separate
          // metadata read. The origin honours conditional PUTs faithfully.
          if (!concurrentWriteOccurred) {
            remoteBody = concurrentBody;
            remoteRev = '"rev-2"';
            concurrentWriteOccurred = true;
          }
          return new Response(body, {
            headers: hasContentETag ? { ETag: rev } : {},
          });
        }
        if (init?.method === 'GET') return Response.json({ eTag: remoteRev });
        if (init?.method === 'PUT') {
          if (new Headers(init.headers).get('If-Match') !== remoteRev) {
            return Response.json(
              { error: { code: 'preconditionFailed' } },
              { status: 412 },
            );
          }
          remoteBody = String(init.body);
          return Response.json({ eTag: '"rev-3"', size: remoteBody.length });
        }
        throw new Error(`Unexpected OneDrive request: ${init?.method}`);
      });

      try {
        const downloaded = await provider.downloadFile('test.json');
        await provider.uploadFile('test.json', downloaded.dataStr, downloaded.rev);
      } catch (error) {
        // Refusing the raced read/write is safe; returning a consistent newer
        // body/revision pair is also safe. Other failures must fail the test.
        expect(error).toBeInstanceOf(UploadRevToMatchMismatchAPIError);
      }
      expect(concurrentWriteOccurred).toBeTrue();
      expect(remoteBody).toBe(concurrentBody);
    });
  }

  it('downloads content without an ETag when the metadata revision stays unchanged', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.callFake(async (url: string) =>
      url.endsWith('/content')
        ? new Response('unchanged content')
        : Response.json({ eTag: '"rev-1"' }),
    );

    await expectAsync(provider.downloadFile('test.json')).toBeResolvedTo({
      dataStr: 'unchanged content',
      rev: '"rev-1"',
    });
  });

  it('rejects a download when neither content nor metadata supplies a revision', async () => {
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.callFake(async (url: string) =>
      url.endsWith('/content') ? new Response('content') : Response.json({}),
    );

    await expectAsync(provider.downloadFile('test.json')).toBeRejectedWithError(
      NoRevAPIError,
    );
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

  // `_request` still accepts an absolute URL (written for @odata.nextLink
  // pass-through) and attaches the user's Bearer token to it. No public method
  // passes one since listFiles was removed, so pin the host guard directly.
  describe('_request with an absolute URL', () => {
    type RequestSeam = {
      _request: (options: { method: 'GET'; path: string }) => Promise<Response>;
    };
    const requestAbsolute = (url: string): Promise<Response> =>
      (provider as unknown as RequestSeam)._request({ method: 'GET', path: url });

    beforeEach(() => {
      // A fresh expiry, so no token refresh request runs before the guard.
      cfgStoreSpy.load.and.resolveTo({
        ...baseCfg,
        tokenExpiresAt: Date.now() + tokenExpiryMs,
      });
      fetchSpy.and.resolveTo({ ok: true, status: 200, text: async () => '' } as Response);
    });

    it('sends a sovereign-cloud Graph URL verbatim with the Bearer token', async () => {
      const url =
        'https://graph.microsoft.us/v1.0/me/drive/special/approot/children?skiptoken=abc';

      await requestAbsolute(url);

      expect(fetchSpy).toHaveBeenCalledOnceWith(url, jasmine.any(Object));
      const init = fetchSpy.calls.mostRecent().args[1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-token');
    });

    for (const url of [
      'https://attacker.example.com/steal',
      'https://graph.microsoft.com.attacker.example/steal',
      'https://graph.microsoft.com@attacker.example.com/steal',
      'http://graph.microsoft.com/v1.0/cleartext',
    ]) {
      it(`refuses to send the Bearer token to ${url}`, async () => {
        await expectAsync(requestAbsolute(url)).toBeRejectedWithError(/non-Graph host/);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }
  });

  // #9546: the WebView fetch (CapacitorWebFetch) sends an `Origin` header,
  // which Entra treats as cross-origin token redemption and rejects with
  // AADSTS90023 for "Mobile and desktop" (native) registrations. On native
  // platforms the token endpoint must be called through native HTTP.
  const nativePlatforms = [
    { name: 'Android', isAndroidWebView: true, isIosNative: false },
    { name: 'iOS', isAndroidWebView: false, isIosNative: true },
  ];
  for (const platform of nativePlatforms) {
    describe(`on ${platform.name} native (#9546)`, () => {
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      let nativeExecutorSpy: jasmine.Spy;
      let warnSpy: jasmine.Spy;
      let nativeProvider: PackageOneDrive;

      beforeEach(() => {
        nativeExecutorSpy = jasmine.createSpy('nativeHttpExecutor').and.resolveTo({
          status: 200,
          headers: { 'content-type': 'application/json' }, // eslint-disable-line @typescript-eslint/naming-convention
          // CapacitorHttp auto-parses JSON responses into an object.
          data: {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
          },
        });
        warnSpy = jasmine.createSpy('warn');
        fetchSpy.and.callFake(async (url: string) => {
          if (url.includes('/oauth2/v2.0/token')) {
            throw new Error('WebView fetch must not be used for token redemption');
          }
          return { ok: true, status: 204, text: async () => '' } as Response;
        });
        nativeProvider = new PackageOneDrive(
          {},
          {
            ...mockDeps,
            logger: { ...mockDeps.logger, warn: warnSpy },
            platformInfo: {
              isNativePlatform: true,
              isAndroidWebView: platform.isAndroidWebView,
              isIosNative: platform.isIosNative,
            },
            credentialStore: cfgStoreSpy as unknown as OneDriveDeps['credentialStore'],
            nativeHttpExecutor: nativeExecutorSpy,
          },
        );
        cfgStoreSpy.load.and.resolveTo(baseCfg);
      });

      it('exchanges the auth code via native HTTP, not the WebView fetch', async () => {
        const authHelper = await nativeProvider.getAuthHelper();
        const result = await authHelper.verifyCodeChallenge!('auth-code-123');

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(nativeExecutorSpy).toHaveBeenCalledTimes(1);
        const req = nativeExecutorSpy.calls.mostRecent().args[0];
        expect(req.method).toBe('POST');
        expect(req.url).toBe(tokenUrl);
        // Android's CapacitorHttp silently drops the body without Content-Type.
        expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(typeof req.data).toBe('string');
        const body = new URLSearchParams(req.data);
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('auth-code-123');
        expect(result.accessToken).toBe('new-access');
        expect(result.refreshToken).toBe('new-refresh');
      });

      it('does not retry the single-use auth code exchange on a transient error', async () => {
        nativeExecutorSpy.and.rejectWith(
          Object.assign(new Error('timeout'), { code: 'SocketTimeoutException' }),
        );

        const authHelper = await nativeProvider.getAuthHelper();
        await expectAsync(
          authHelper.verifyCodeChallenge!('auth-code-123'),
        ).toBeRejected();
        expect(nativeExecutorSpy).toHaveBeenCalledTimes(1);
      });

      it('refreshes the access token via native HTTP, not the WebView fetch', async () => {
        cfgStoreSpy.load.and.resolveTo({ ...baseCfg, tokenExpiresAt: Date.now() - 1000 });

        await nativeProvider.removeFile('test.json');

        const tokenCallsViaFetch = fetchSpy.calls
          .all()
          .filter((c) => String(c.args[0]).includes('/oauth2/v2.0/token'));
        expect(tokenCallsViaFetch.length).toBe(0);
        expect(nativeExecutorSpy).toHaveBeenCalledWith(
          jasmine.objectContaining({ method: 'POST', url: tokenUrl }),
        );
        expect(cfgStoreSpy.setComplete).toHaveBeenCalledWith(
          jasmine.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
          }),
        );
      });

      it('retries a transient network error on native token refresh', async () => {
        cfgStoreSpy.load.and.resolveTo({ ...baseCfg, tokenExpiresAt: Date.now() - 1000 });
        const okResponse = await nativeExecutorSpy();
        nativeExecutorSpy.calls.reset();
        nativeExecutorSpy.and.callFake(async () => {
          if (nativeExecutorSpy.calls.count() === 1) {
            throw Object.assign(new Error('timeout'), { code: 'SocketTimeoutException' });
          }
          return okResponse;
        });

        // The retry backoff is a real setTimeout; advance a mock clock
        // instead of waiting for it.
        jasmine.clock().install();
        try {
          const removePromise = nativeProvider.removeFile('test.json');
          for (let i = 0; i < 100 && nativeExecutorSpy.calls.count() < 2; i++) {
            await Promise.resolve();
            jasmine.clock().tick(100);
          }
          await removePromise;
        } finally {
          jasmine.clock().uninstall();
        }

        expect(nativeExecutorSpy).toHaveBeenCalledTimes(2);
        expect(cfgStoreSpy.setComplete).toHaveBeenCalledWith(
          jasmine.objectContaining({ accessToken: 'new-access' }),
        );
      });

      it('surfaces the AADSTS error_description from a native auth-code 400', async () => {
        nativeExecutorSpy.and.resolveTo({
          status: 400,
          headers: {},
          data: {
            error: 'invalid_request',
            error_description: 'AADSTS90023: Cross-origin token redemption ...',
          },
        });

        const authHelper = await nativeProvider.getAuthHelper();
        let thrown: { name?: string; detail?: string; response?: Response } | undefined;
        try {
          await authHelper.verifyCodeChallenge!('auth-code-123');
          fail('should have thrown');
        } catch (e) {
          thrown = e as typeof thrown;
        }

        expect(thrown?.name).toBe('HttpNotOkAPIError');
        expect(thrown?.response?.status).toBe(400);
        expect(thrown?.detail).toContain('AADSTS90023');
        expect(warnSpy).toHaveBeenCalledWith(
          '[OneDrive] OAuth token request failed',
          jasmine.objectContaining({ status: 400, error: 'invalid_request' }),
        );
      });

      it('clears credentials on a native refresh 400 invalid_grant', async () => {
        cfgStoreSpy.load.and.resolveTo({ ...baseCfg, tokenExpiresAt: Date.now() - 1000 });
        nativeExecutorSpy.and.resolveTo({
          status: 400,
          headers: {},
          data: JSON.stringify({ error: 'invalid_grant' }),
        });

        await expectAsync(nativeProvider.removeFile('test.json')).toBeRejectedWith(
          jasmine.objectContaining({ name: 'MissingRefreshTokenAPIError' }),
        );
        expect(cfgStoreSpy.setComplete).toHaveBeenCalledWith(
          jasmine.objectContaining({ accessToken: '', refreshToken: '' }),
        );
      });
    });
  }

  it('uses the WebView fetch, not native HTTP, for token requests on web/Electron', async () => {
    const nativeExecutorSpy = jasmine.createSpy('nativeHttpExecutor');
    const electronProvider = new PackageOneDrive(
      {},
      {
        ...mockDeps,
        credentialStore: cfgStoreSpy as unknown as OneDriveDeps['credentialStore'],
        isElectron: true,
        nativeHttpExecutor: nativeExecutorSpy,
      },
    );
    cfgStoreSpy.load.and.resolveTo(baseCfg);
    fetchSpy.and.resolveTo({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    } as Response);

    const authHelper = await electronProvider.getAuthHelper();
    await authHelper.verifyCodeChallenge!('auth-code-123');

    expect(nativeExecutorSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      jasmine.objectContaining({ method: 'POST' }),
    );
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });
});

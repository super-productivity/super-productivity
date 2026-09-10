import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';
import {
  deleteOAuthTokens,
  loadOAuthTokens,
  saveOAuthTokens,
} from './plugin-oauth-token-store';
import { PluginOAuthService } from './plugin-oauth.service';
import { PluginLog } from '../../core/log';

describe('PluginOAuthBridgeService', () => {
  let service: PluginOAuthBridgeService;
  let oauthService: jasmine.SpyObj<PluginOAuthService>;

  const baseConfig: OAuthFlowConfig = {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'desktop-client-id',
    clientSecret: 'desktop-client-secret',
    scopes: ['calendar.readonly'],
  };

  beforeEach(async () => {
    await deleteOAuthTokens('test-plugin__oauth').catch(() => undefined);

    oauthService = jasmine.createSpyObj<PluginOAuthService>(
      'PluginOAuthService',
      [
        'validateOAuthConfig',
        'prepareRedirectUri',
        'buildAuthUrl',
        'waitForRedirectCode',
        'exchangeCodeForTokens',
        'storeTokens',
        'serializeTokens',
        'clearTokens',
        'hasTokens',
        'restoreTokens',
        'getValidToken',
      ],
      {
        tokenInvalidated$: new Subject<string>(),
        tokensRefreshed$: new Subject<string>(),
      },
    );

    TestBed.configureTestingModule({
      providers: [
        PluginOAuthBridgeService,
        { provide: PluginOAuthService, useValue: oauthService },
      ],
    });

    service = TestBed.inject(PluginOAuthBridgeService);
  });

  it('rejects browser OAuth when a plugin has no web client id', async () => {
    await expectAsync(
      service.startOAuthFlow('google-calendar', baseConfig),
    ).toBeRejectedWithError(/not available in the web build/);

    expect(oauthService.validateOAuthConfig).toHaveBeenCalledWith(baseConfig);
    expect(oauthService.prepareRedirectUri).not.toHaveBeenCalled();
  });

  it('strips a desktop loopback redirectUri on the web flow and falls through to the host callback default', async () => {
    spyOn(window, 'open').and.returnValue({} as Window);
    const webCallback = 'https://app.super-productivity.com/assets/oauth-callback.html';
    oauthService.prepareRedirectUri.and.resolveTo(webCallback);
    oauthService.buildAuthUrl.and.resolveTo({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      codeVerifier: 'verifier',
      state: 'state',
    });
    oauthService.waitForRedirectCode.and.resolveTo('auth-code');
    oauthService.exchangeCodeForTokens.and.resolveTo({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    oauthService.serializeTokens.and.returnValue(null);

    // A web-capable plugin (webClientId) that ALSO declares a desktop loopback redirectUri:
    // on web the redirectUri must be dropped so the flow uses the host callback default,
    // instead of throwing because the loopback URI fails web validation.
    await service.startOAuthFlow('test-plugin', {
      ...baseConfig,
      webClientId: 'web-client-id',
      redirectUri: 'http://127.0.0.1:8976/callback',
    });

    expect(oauthService.prepareRedirectUri).toHaveBeenCalledWith(undefined);
    expect(oauthService.buildAuthUrl).toHaveBeenCalledWith(
      jasmine.objectContaining({
        clientId: 'web-client-id',
        clientSecret: undefined,
        redirectUri: undefined,
      }),
      webCallback,
    );
    expect(oauthService.exchangeCodeForTokens).toHaveBeenCalledWith(
      jasmine.objectContaining({
        clientId: 'web-client-id',
        clientSecret: undefined,
        redirectUri: webCallback,
      }),
    );
  });

  // The token-store writes triggered by tokenInvalidated$/tokensRefreshed$ are
  // fire-and-forget, so poll instead of awaiting a promise the bridge does not expose.
  const waitForStoredTokens = async (expected: string | null): Promise<string | null> => {
    let stored: string | null = null;
    for (let i = 0; i < 50; i++) {
      stored = await loadOAuthTokens('test-plugin__oauth');
      if (stored === expected) {
        return stored;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return stored;
  };

  it('persists the rotated access token after a successful refresh', async () => {
    await saveOAuthTokens('test-plugin__oauth', 'stale-tokens');
    oauthService.serializeTokens.and.returnValue('refreshed-tokens');

    oauthService.tokensRefreshed$.next('test-plugin');

    expect(await waitForStoredTokens('refreshed-tokens')).toBe('refreshed-tokens');
    await deleteOAuthTokens('test-plugin__oauth');
  });

  it('deletes persisted tokens once the grant is invalidated', async () => {
    await saveOAuthTokens('test-plugin__oauth', 'stale-tokens');

    oauthService.tokenInvalidated$.next('test-plugin');

    expect(await waitForStoredTokens(null)).toBeNull();
  });

  it('persists oauth tokens in the local token store after a successful flow', async () => {
    spyOn(window, 'open').and.returnValue({} as Window);
    oauthService.prepareRedirectUri.and.resolveTo(
      'https://app.super-productivity.com/assets/oauth-callback.html',
    );
    oauthService.buildAuthUrl.and.resolveTo({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      codeVerifier: 'verifier',
      state: 'state',
    });
    oauthService.waitForRedirectCode.and.resolveTo('auth-code');
    oauthService.exchangeCodeForTokens.and.resolveTo({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    oauthService.serializeTokens.and.returnValue('serialized-tokens');

    await service.startOAuthFlow('test-plugin', {
      ...baseConfig,
      webClientId: 'web-client-id',
    });

    expect(await loadOAuthTokens('test-plugin__oauth')).toBe('serialized-tokens');
    await deleteOAuthTokens('test-plugin__oauth');
  });

  it('uses a public web client id without carrying the desktop client secret', async () => {
    spyOn(window, 'open').and.returnValue({} as Window);
    oauthService.prepareRedirectUri.and.resolveTo(
      'https://app.super-productivity.com/assets/oauth-callback.html',
    );
    oauthService.buildAuthUrl.and.resolveTo({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      codeVerifier: 'verifier',
      state: 'state',
    });
    oauthService.waitForRedirectCode.and.resolveTo('auth-code');
    oauthService.exchangeCodeForTokens.and.resolveTo({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    oauthService.serializeTokens.and.returnValue(null);

    await service.startOAuthFlow('pkce-web-provider', {
      ...baseConfig,
      webClientId: 'web-client-id',
    });

    const effectiveConfig = oauthService.buildAuthUrl.calls.mostRecent()
      .args[0] as OAuthFlowConfig;
    expect(effectiveConfig.clientId).toBe('web-client-id');
    expect(effectiveConfig.clientSecret).toBeUndefined();
    expect(oauthService.exchangeCodeForTokens).toHaveBeenCalledWith(
      jasmine.objectContaining({
        clientId: 'web-client-id',
        clientSecret: undefined,
      }),
    );
  });

  it('warns that a client secret is not used in the web build', async () => {
    spyOn(window, 'open').and.returnValue({} as Window);
    const warnSpy = spyOn(PluginLog, 'warn');
    oauthService.prepareRedirectUri.and.resolveTo(
      'https://app.super-productivity.com/assets/oauth-callback.html',
    );
    oauthService.buildAuthUrl.and.resolveTo({
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      codeVerifier: 'verifier',
      state: 'state',
    });
    oauthService.waitForRedirectCode.and.resolveTo('auth-code');
    oauthService.exchangeCodeForTokens.and.resolveTo({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    });
    oauthService.serializeTokens.and.returnValue(null);

    // baseConfig carries a clientSecret, which the web build cannot use.
    await service.startOAuthFlow('pkce-web-provider', {
      ...baseConfig,
      webClientId: 'web-client-id',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'OAuth: the configured client secret is not used on this platform; the public/platform client id is used instead.',
    );
  });

  it('clears stale browser tokens for providers that are unavailable on web', async () => {
    oauthService.hasTokens.and.returnValue(true);

    const hasTokens = await service.restoreAndCheckOAuthTokens(
      'google-calendar',
      baseConfig,
    );

    expect(hasTokens).toBeFalse();
    expect(oauthService.clearTokens).toHaveBeenCalledWith('google-calendar');
    expect(oauthService.getValidToken).not.toHaveBeenCalled();
  });

  it('does not return stale browser tokens for providers that are unavailable on web', async () => {
    oauthService.hasTokens.and.returnValue(true);

    const token = await service.getOAuthToken('google-calendar', baseConfig);

    expect(token).toBeNull();
    expect(oauthService.clearTokens).toHaveBeenCalledWith('google-calendar');
    expect(oauthService.getValidToken).not.toHaveBeenCalled();
  });
});

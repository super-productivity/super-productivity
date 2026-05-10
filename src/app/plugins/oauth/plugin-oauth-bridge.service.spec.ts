import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';
import { PluginOAuthService } from './plugin-oauth.service';

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

  beforeEach(() => {
    oauthService = jasmine.createSpyObj<PluginOAuthService>(
      'PluginOAuthService',
      [
        'validateOAuthConfig',
        'getRedirectUri',
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
      { tokenInvalidated$: new Subject<string>() },
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
    expect(oauthService.getRedirectUri).not.toHaveBeenCalled();
  });

  it('uses a public web client id without carrying the desktop client secret', async () => {
    spyOn(window, 'open').and.returnValue({} as Window);
    oauthService.getRedirectUri.and.resolveTo(
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

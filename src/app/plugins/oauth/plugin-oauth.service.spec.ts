import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PluginOAuthService } from './plugin-oauth.service';
import { OAuthFlowConfig } from '@super-productivity/plugin-api';

describe('PluginOAuthService', () => {
  let service: PluginOAuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginOAuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PluginOAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('buildAuthUrl', () => {
    it('should construct URL with PKCE params and scopes', async () => {
      const config: OAuthFlowConfig = {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: 'my-client-id',
        scopes: ['calendar.readonly', 'calendar.events'],
      };
      const redirectUri = 'https://localhost/assets/oauth-callback.html';

      const result = await service.buildAuthUrl(config, redirectUri);

      expect(result.codeVerifier).toBeTruthy();

      const url = new URL(result.url);
      expect(url.origin + url.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('my-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(url.searchParams.get('scope')).toBe('calendar.readonly calendar.events');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(result.state).toBeTruthy();
      expect(url.searchParams.get('state')).toBe(result.state);
      // access_type/prompt are no longer hardcoded — they come via extraAuthParams
      expect(url.searchParams.get('access_type')).toBeNull();
      expect(url.searchParams.get('prompt')).toBeNull();
    });

    it('should include extraAuthParams in the URL', async () => {
      const config: OAuthFlowConfig = {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: 'my-client-id',
        scopes: ['read'],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      };

      const result = await service.buildAuthUrl(config, 'https://redirect.example.com');
      const url = new URL(result.url);
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('should reject non-HTTPS authUrl', async () => {
      const config: OAuthFlowConfig = {
        authUrl: 'http://insecure.example.com/auth',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'cid',
        scopes: ['read'],
      };

      await expectAsync(
        service.buildAuthUrl(config, 'https://redirect.example.com'),
      ).toBeRejectedWithError(/OAuth authUrl must use HTTPS/);
    });

    it('should reject non-HTTPS tokenUrl', async () => {
      const config: OAuthFlowConfig = {
        authUrl: 'https://auth.example.com/auth',
        tokenUrl: 'http://insecure.example.com/token',
        clientId: 'cid',
        scopes: ['read'],
      };

      await expectAsync(
        service.buildAuthUrl(config, 'https://redirect.example.com'),
      ).toBeRejectedWithError(/OAuth tokenUrl must use HTTPS/);
    });

    it('should return a non-empty code verifier', async () => {
      const config: OAuthFlowConfig = {
        authUrl: 'https://auth.example.com/auth',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'cid',
        scopes: ['read'],
      };

      const result = await service.buildAuthUrl(config, 'https://redirect.example.com');
      expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('should POST to tokenUrl with code and PKCE verifier', async () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const clientId = 'my-client-id';
      const code = 'auth-code-123';
      const codeVerifier = 'verifier-456';
      const redirectUri = 'https://localhost/callback';

      const promise = service.exchangeCodeForTokens({
        tokenUrl,
        clientId,
        code,
        codeVerifier,
        redirectUri,
      });

      const req = httpMock.expectOne(tokenUrl);
      expect(req.request.method).toBe('POST');

      const body = new URLSearchParams(req.request.body as string);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_id')).toBe(clientId);
      expect(body.get('code')).toBe(code);
      expect(body.get('code_verifier')).toBe(codeVerifier);
      expect(body.get('redirect_uri')).toBe(redirectUri);

      req.flush({
        access_token: 'access-abc',
        refresh_token: 'refresh-xyz',
        expires_in: 3600,
      });

      const result = await promise;
      expect(result.accessToken).toBe('access-abc');
      expect(result.refreshToken).toBe('refresh-xyz');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should include client_secret when provided', async () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const clientId = 'my-client-id';
      const code = 'auth-code-123';
      const codeVerifier = 'verifier-456';
      const redirectUri = 'https://localhost/callback';
      const clientSecret = 'my-secret';

      const promise = service.exchangeCodeForTokens({
        tokenUrl,
        clientId,
        code,
        codeVerifier,
        redirectUri,
        clientSecret,
      });

      const req = httpMock.expectOne(tokenUrl);
      expect(req.request.method).toBe('POST');

      const body = new URLSearchParams(req.request.body as string);
      expect(body.get('client_secret')).toBe('my-secret');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_id')).toBe(clientId);

      req.flush({
        access_token: 'access-with-secret',
        refresh_token: 'refresh-with-secret',
        expires_in: 3600,
      });

      const result = await promise;
      expect(result.accessToken).toBe('access-with-secret');
    });
  });

  describe('refreshAccessToken', () => {
    it('should POST to tokenUrl with refresh_token grant', async () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const clientId = 'my-client-id';
      const refreshToken = 'refresh-xyz';

      const promise = service.refreshAccessToken(tokenUrl, clientId, refreshToken);

      const req = httpMock.expectOne(tokenUrl);
      expect(req.request.method).toBe('POST');

      const body = new URLSearchParams(req.request.body as string);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('client_id')).toBe(clientId);
      expect(body.get('refresh_token')).toBe(refreshToken);

      req.flush({
        access_token: 'new-access-token',
        expires_in: 3600,
      });

      const result = await promise;
      expect(result.accessToken).toBe('new-access-token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('token store', () => {
    it('should return false for hasTokens when no tokens stored', () => {
      expect(service.hasTokens('unknown-plugin')).toBe(false);
    });

    it('should store and retrieve tokens', () => {
      service.storeTokens('plugin-1', {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        tokenUrl: 'https://token.url',
        clientId: 'cid',
      });

      expect(service.hasTokens('plugin-1')).toBe(true);
    });

    it('should clear tokens for a plugin', () => {
      service.storeTokens('plugin-1', {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        tokenUrl: 'https://token.url',
        clientId: 'cid',
      });

      service.clearTokens('plugin-1');
      expect(service.hasTokens('plugin-1')).toBe(false);
    });
  });

  describe('getValidToken', () => {
    it('should return null if no tokens stored', async () => {
      const token = await service.getValidToken('unknown-plugin');
      expect(token).toBeNull();
    });

    it('should return access token if not expired', async () => {
      service.storeTokens('plugin-1', {
        accessToken: 'valid-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        tokenUrl: 'https://token.url',
        clientId: 'cid',
      });

      const token = await service.getValidToken('plugin-1');
      expect(token).toBe('valid-token');
    });

    it('should refresh and return new token if near expiry', async () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      service.storeTokens('plugin-1', {
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60000, // 1 minute from now (within 5-min buffer)
        tokenUrl,
        clientId: 'cid',
      });

      const promise = service.getValidToken('plugin-1');

      const req = httpMock.expectOne(tokenUrl);
      req.flush({
        access_token: 'refreshed-token',
        expires_in: 3600,
      });

      const token = await promise;
      expect(token).toBe('refreshed-token');
    });

    it('should return null if refresh fails', async () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      service.storeTokens('plugin-1', {
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60000, // within 5-min buffer
        tokenUrl,
        clientId: 'cid',
      });

      const promise = service.getValidToken('plugin-1');

      const req = httpMock.expectOne(tokenUrl);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      const token = await promise;
      expect(token).toBeNull();
      expect(service.hasTokens('plugin-1')).toBe(false);
    });
  });

  describe('token serialization', () => {
    it('should serialize and restore tokens', () => {
      service.storeTokens('plugin-1', {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        tokenUrl: 'https://token.url',
        clientId: 'client-id',
      });

      const serialized = service.serializeTokens('plugin-1');
      expect(serialized).toBeTruthy();

      service.clearTokens('plugin-1');
      expect(service.hasTokens('plugin-1')).toBe(false);

      service.restoreTokens('plugin-1', serialized!);
      expect(service.hasTokens('plugin-1')).toBe(true);
    });

    it('should return null for non-existent plugin', () => {
      expect(service.serializeTokens('nonexistent')).toBeNull();
    });
  });

  describe('restoreTokens validation', () => {
    beforeEach(() => {
      spyOn(console, 'warn');
    });

    it('should discard tokens with missing accessToken', () => {
      const serialized = JSON.stringify({
        refreshToken: 'r',
        tokenUrl: 'u',
        clientId: 'c',
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(false);
    });

    it('should discard tokens with missing refreshToken', () => {
      const serialized = JSON.stringify({
        accessToken: 'a',
        tokenUrl: 'u',
        clientId: 'c',
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(false);
    });

    it('should discard tokens with missing tokenUrl', () => {
      const serialized = JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        clientId: 'c',
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(false);
    });

    it('should discard tokens with missing clientId', () => {
      const serialized = JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        tokenUrl: 'u',
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(false);
    });

    it('should handle malformed JSON gracefully', () => {
      expect(() => service.restoreTokens('p1', 'not-json')).not.toThrow();

      expect(service.hasTokens('p1')).toBe(false);
    });

    it('should accept valid tokens with all required fields', () => {
      const serialized = JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        tokenUrl: 'https://example.com/token',
        clientId: 'c',
        expiresAt: Date.now() + 3600000,
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(true);
    });

    it('should reject tokens with non-HTTPS tokenUrl', () => {
      const serialized = JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        tokenUrl: 'http://example.com/token',
        clientId: 'c',
        expiresAt: Date.now() + 3600000,
      });

      service.restoreTokens('p1', serialized);

      expect(service.hasTokens('p1')).toBe(false);
    });
  });

  describe('redirect code handling', () => {
    it('should resolve when handleRedirectCode is called with matching state', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'test-state');
      service.handleRedirectCode('auth-code-789', 'test-state');

      const code = await promise;
      expect(code).toBe('auth-code-789');
    });

    it('should reject when handleRedirectError is called with matching state', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'test-state');
      service.handleRedirectError('user_denied', 'test-state');

      await expectAsync(promise).toBeRejectedWithError(/user_denied/);
    });

    it('should ignore handleRedirectError with mismatched state', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'test-state');
      service.handleRedirectError('user_denied', 'wrong-state');

      // Promise should still be pending (not rejected)
      service.handleRedirectCode('the-code', 'test-state');
      const code = await promise;
      expect(code).toBe('the-code');
    });

    it('should ignore handleRedirectError with missing state', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'test-state');
      service.handleRedirectError('user_denied');

      // Promise should still be pending (not rejected) since state is undefined
      service.handleRedirectCode('the-code', 'test-state');
      const code = await promise;
      expect(code).toBe('the-code');
    });

    it('should only resolve the most recent pending flow', async () => {
      const promise1 = service.waitForRedirectCode('plugin-1', 'state-1');
      const promise2 = service.waitForRedirectCode('plugin-2', 'state-2');

      service.handleRedirectCode('code-for-latest', 'state-2');

      const code = await promise2;
      expect(code).toBe('code-for-latest');

      // First promise should have been rejected when second was created
      await expectAsync(promise1).toBeRejectedWithError(/superseded/);
    });

    it('should reject the previous pending redirect with the correct error message', async () => {
      const promise1 = service.waitForRedirectCode('plugin-1', 'state-1');
      service.waitForRedirectCode('plugin-2', 'state-2');

      await expectAsync(promise1).toBeRejectedWithError(
        'OAuth flow superseded by a new request',
      );
    });

    it('should ignore redirect code when state does not match', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'expected-state');
      service.handleRedirectCode('auth-code-789', 'wrong-state');

      // Code should not have been resolved; now resolve with correct state
      service.handleRedirectCode('auth-code-correct', 'expected-state');
      const code = await promise;
      expect(code).toBe('auth-code-correct');
    });

    it('should accept redirect code when state matches', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'my-state');
      service.handleRedirectCode('code-123', 'my-state');

      const code = await promise;
      expect(code).toBe('code-123');
    });

    it('should reject redirect code when state is missing', async () => {
      const promise = service.waitForRedirectCode('plugin-1', 'expected-state');
      service.handleRedirectCode('code-456');

      // State mismatch (undefined !== 'expected-state'), so resolve with correct state
      service.handleRedirectCode('code-correct', 'expected-state');
      const code = await promise;
      expect(code).toBe('code-correct');
    });
  });
});

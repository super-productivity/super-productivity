import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { OAuthFlowConfig, OAuthTokenResult } from '@super-productivity/plugin-api';
import { PluginOAuthTokens } from './plugin-oauth.model';
import { generateCodeVerifier, generateCodeChallenge } from './pkce.util';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { PluginLog } from '../../core/log';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const OAUTH_REDIRECT_TIMEOUT_MS = 5 * 60 * 1000;

const RESERVED_OAUTH_PARAMS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'state',
]);

interface PendingRedirect {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  expectedState: string;
}

@Injectable({ providedIn: 'root' })
export class PluginOAuthService {
  private _http = inject(HttpClient);
  private _tokenStore = new Map<string, PluginOAuthTokens>();
  private _pendingRedirect: PendingRedirect | null = null;
  private _refreshPromises = new Map<string, Promise<string | null>>();

  /** Emits the pluginId when a token refresh fails and in-memory tokens are cleared. */
  tokenInvalidated$ = new Subject<string>();

  getRedirectUri(): string {
    if (IS_ELECTRON) {
      return 'super-productivity://oauth';
    }
    if (IS_ANDROID_WEB_VIEW) {
      return 'com.super-productivity.app://plugin-oauth-callback';
    }
    return `${window.location.origin}/assets/oauth-callback.html`;
  }

  async buildAuthUrl(
    config: OAuthFlowConfig,
    redirectUri: string,
  ): Promise<{ url: string; codeVerifier: string; state: string }> {
    this._validateHttpsUrl(config.authUrl, 'authUrl');
    this._validateHttpsUrl(config.tokenUrl, 'tokenUrl');

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateCodeVerifier();

    const filteredExtraParams: Record<string, string> = {};
    if (config.extraAuthParams) {
      for (const [key, value] of Object.entries(config.extraAuthParams)) {
        if (!RESERVED_OAUTH_PARAMS.has(key)) {
          filteredExtraParams[key] = value;
        }
      }
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...filteredExtraParams,
    });

    return {
      url: `${config.authUrl}?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  private _validateHttpsUrl(url: string, label: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new Error(`OAuth ${label} must use HTTPS, got ${parsed.protocol}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('OAuth ')) {
        throw e;
      }
      throw new Error(`Invalid OAuth ${label}: ${(e as Error).message}`);
    }
  }

  async exchangeCodeForTokens(opts: {
    tokenUrl: string;
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientSecret?: string;
  }): Promise<OAuthTokenResult> {
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: opts.clientId,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri,
    };
    if (opts.clientSecret) {
      params['client_secret'] = opts.clientSecret;
    }

    const response = await this._postTokenRequest<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(opts.tokenUrl, params);

    const expiresInMs = response.expires_in * 1000;
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + expiresInMs,
    };
  }

  async refreshAccessToken(
    tokenUrl: string,
    clientId: string,
    refreshToken: string,
    clientSecret?: string,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    };
    if (clientSecret) {
      params['client_secret'] = clientSecret;
    }

    const response = await this._postTokenRequest<{
      access_token: string;
      expires_in: number;
    }>(tokenUrl, params);

    const expiresInMs = response.expires_in * 1000;
    return {
      accessToken: response.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
  }

  private _postTokenRequest<T>(
    tokenUrl: string,
    params: Record<string, string>,
  ): Promise<T> {
    this._validateHttpsUrl(tokenUrl, 'tokenUrl');
    const body = new URLSearchParams(params);
    const headers = new HttpHeaders().set(
      'Content-Type',
      'application/x-www-form-urlencoded',
    );
    return firstValueFrom(this._http.post<T>(tokenUrl, body.toString(), { headers }));
  }

  storeTokens(pluginId: string, tokens: PluginOAuthTokens): void {
    this._tokenStore.set(pluginId, tokens);
  }

  hasTokens(pluginId: string): boolean {
    return this._tokenStore.has(pluginId);
  }

  clearTokens(pluginId: string): void {
    this._tokenStore.delete(pluginId);
  }

  serializeTokens(pluginId: string): string | null {
    const tokens = this._tokenStore.get(pluginId);
    return tokens ? JSON.stringify(tokens) : null;
  }

  restoreTokens(pluginId: string, serialized: string): void {
    try {
      const tokens = JSON.parse(serialized) as PluginOAuthTokens;
      if (
        !tokens?.accessToken ||
        !tokens?.refreshToken ||
        !tokens?.tokenUrl ||
        !tokens?.clientId ||
        typeof tokens?.expiresAt !== 'number' ||
        isNaN(tokens.expiresAt)
      ) {
        PluginLog.warn(`Invalid stored OAuth tokens for plugin ${pluginId}, discarding`);
        return;
      }
      try {
        this._validateHttpsUrl(tokens.tokenUrl, 'stored tokenUrl');
      } catch {
        PluginLog.warn(`Stored tokenUrl for plugin ${pluginId} is not HTTPS, discarding`);
        return;
      }
      this._tokenStore.set(pluginId, tokens);
    } catch (e) {
      PluginLog.warn(`Failed to parse stored OAuth tokens for plugin ${pluginId}`, e);
    }
  }

  async getValidToken(pluginId: string): Promise<string | null> {
    const tokens = this._tokenStore.get(pluginId);
    if (!tokens) {
      return null;
    }

    if (tokens.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return tokens.accessToken;
    }

    // Deduplicate concurrent refresh calls to avoid token rotation issues
    const existing = this._refreshPromises.get(pluginId);
    if (existing) {
      return existing;
    }

    const refreshPromise = this._doRefresh(pluginId, tokens).finally(() => {
      this._refreshPromises.delete(pluginId);
    });
    this._refreshPromises.set(pluginId, refreshPromise);
    return refreshPromise;
  }

  private async _doRefresh(
    pluginId: string,
    tokens: PluginOAuthTokens,
  ): Promise<string | null> {
    try {
      PluginLog.log(`Refreshing token for plugin ${pluginId}`);
      const refreshed = await this.refreshAccessToken(
        tokens.tokenUrl,
        tokens.clientId,
        tokens.refreshToken,
        tokens.clientSecret,
      );
      this._tokenStore.set(pluginId, {
        ...tokens,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      });
      return refreshed.accessToken;
    } catch (err) {
      PluginLog.err(`Failed to refresh token for plugin ${pluginId}`, err);
      this._tokenStore.delete(pluginId);
      this.tokenInvalidated$.next(pluginId);
      return null;
    }
  }

  waitForRedirectCode(pluginId: string, expectedState: string): Promise<string> {
    // Reject any existing pending redirect as superseded
    if (this._pendingRedirect) {
      this._pendingRedirect.reject(new Error('OAuth flow superseded by a new request'));
      this._pendingRedirect = null;
    }

    return new Promise<string>((resolve, reject) => {
      PluginLog.log(`Waiting for OAuth redirect code for plugin ${pluginId}`);
      const timeoutId = setTimeout(() => {
        this._pendingRedirect = null;
        reject(
          new Error(
            `OAuth redirect timed out after ${OAUTH_REDIRECT_TIMEOUT_MS / 1000}s for plugin ${pluginId}`,
          ),
        );
      }, OAUTH_REDIRECT_TIMEOUT_MS);
      this._pendingRedirect = {
        resolve: (code: string) => {
          clearTimeout(timeoutId);
          resolve(code);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutId);
          reject(err);
        },
        expectedState,
      };
    });
  }

  handleRedirectCode(code: string, state?: string): void {
    if (this._pendingRedirect) {
      if (state !== this._pendingRedirect.expectedState) {
        PluginLog.warn('OAuth state mismatch – ignoring callback');
        return;
      }
      this._pendingRedirect.resolve(code);
      this._pendingRedirect = null;
    } else {
      PluginLog.warn('Received OAuth code but no pending flow');
    }
  }

  handleRedirectError(error: string, state?: string): void {
    if (this._pendingRedirect) {
      if (state !== this._pendingRedirect.expectedState) {
        PluginLog.warn('OAuth error state mismatch – ignoring callback');
        return;
      }
      this._pendingRedirect.reject(new Error(error));
      this._pendingRedirect = null;
    }
  }
}

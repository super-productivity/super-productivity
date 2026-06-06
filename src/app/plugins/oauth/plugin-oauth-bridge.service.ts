import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAuthFlowConfig, OAuthTokenResult } from '@super-productivity/plugin-api';
import { PluginOAuthService } from './plugin-oauth.service';
import {
  saveOAuthTokens,
  loadOAuthTokens,
  deleteOAuthTokens,
} from './plugin-oauth-token-store';
import { IS_ELECTRON } from '../../app.constants';
import {
  IS_NATIVE_PLATFORM,
  IS_IOS_NATIVE,
  IS_ANDROID_NATIVE,
} from '../../util/is-native-platform';
import { PluginLog } from '../../core/log';

/**
 * Bridges OAuth operations between plugin API surface and the underlying
 * PluginOAuthService + persistence layer. Extracted from PluginBridgeService
 * to keep that class focused.
 *
 * OAuth tokens are stored in a local-only IndexedDB database (NOT synced
 * via op-log). Each device authenticates independently.
 */
@Injectable({ providedIn: 'root' })
export class PluginOAuthBridgeService {
  private _pluginOAuthService = inject(PluginOAuthService);

  constructor() {
    // Clear persisted OAuth tokens when a refresh fails
    this._pluginOAuthService.tokenInvalidated$
      .pipe(takeUntilDestroyed())
      .subscribe((pluginId) => {
        this._clearPersistedOAuthTokens(pluginId);
      });
  }

  async startOAuthFlow(
    pluginId: string,
    config: OAuthFlowConfig,
  ): Promise<OAuthTokenResult> {
    // Validate URLs before starting the loopback server. On Electron,
    // getRedirectUri() starts a server — avoid leaking it if config is invalid.
    this._pluginOAuthService.validateOAuthConfig(config);

    // Pick the platform-specific client. The default `clientId` is the desktop
    // client (loopback redirect, used by Electron); other platforms override it.
    // - Android/iOS authenticate via app signing → no client secret
    // - Web can only use providers that support public browser clients via PKCE
    // Order matters: Android-WebView sets both IS_ANDROID_NATIVE and IS_NATIVE_PLATFORM,
    // so it lands in the Android branch (correct) and never reaches the web branch.
    const effectiveConfig = ((): OAuthFlowConfig => {
      if (IS_ANDROID_NATIVE && config.mobileClientId) {
        return { ...config, clientId: config.mobileClientId, clientSecret: undefined };
      }
      if (IS_IOS_NATIVE && config.iosClientId) {
        return { ...config, clientId: config.iosClientId, clientSecret: undefined };
      }
      if (!IS_ELECTRON && !IS_NATIVE_PLATFORM) {
        const webClientId = config.webClientId;
        if (!webClientId) {
          throw new Error(
            'OAuth: this plugin is not available in the web build. Connect from the desktop or mobile app instead.',
          );
        }
        return {
          ...config,
          clientId: webClientId,
          clientSecret: undefined,
        };
      }
      return config;
    })();

    const redirectUri = await this._pluginOAuthService.getRedirectUri();
    const { url, codeVerifier, state } = await this._pluginOAuthService.buildAuthUrl(
      effectiveConfig,
      redirectUri,
    );

    this._openOAuthWindow(url);

    const code = await this._pluginOAuthService.waitForRedirectCode(pluginId, state);

    const tokens = await this._pluginOAuthService.exchangeCodeForTokens({
      tokenUrl: effectiveConfig.tokenUrl,
      clientId: effectiveConfig.clientId,
      code,
      codeVerifier,
      redirectUri,
      clientSecret: effectiveConfig.clientSecret,
    });

    this._pluginOAuthService.storeTokens(pluginId, {
      ...tokens,
      tokenUrl: effectiveConfig.tokenUrl,
      clientId: effectiveConfig.clientId,
      clientSecret: effectiveConfig.clientSecret,
    });

    await this._persistOAuthTokens(pluginId);

    return tokens;
  }

  async clearOAuthTokens(pluginId: string): Promise<void> {
    this._pluginOAuthService.clearTokens(pluginId);
    await this._clearPersistedOAuthTokens(pluginId);
  }

  async restoreAndCheckOAuthTokens(
    pluginId: string,
    config?: OAuthFlowConfig,
  ): Promise<boolean> {
    if (this._isUnavailableInWeb(config)) {
      await this.clearOAuthTokens(pluginId);
      return false;
    }
    if (!this._pluginOAuthService.hasTokens(pluginId)) {
      await this._restoreOAuthTokens(pluginId);
    }
    return this._pluginOAuthService.hasTokens(pluginId);
  }

  async getOAuthToken(
    pluginId: string,
    config?: OAuthFlowConfig,
  ): Promise<string | null> {
    if (this._isUnavailableInWeb(config)) {
      await this.clearOAuthTokens(pluginId);
      return null;
    }
    if (!this._pluginOAuthService.hasTokens(pluginId)) {
      await this._restoreOAuthTokens(pluginId);
    }
    return this._pluginOAuthService.getValidToken(pluginId);
  }

  private _isUnavailableInWeb(config?: OAuthFlowConfig): boolean {
    return !!config && !IS_ELECTRON && !IS_NATIVE_PLATFORM && !config.webClientId;
  }

  private _openOAuthWindow(url: string): void {
    if (IS_ELECTRON) {
      window.ea.pluginOAuthStart(url);
    } else if (IS_NATIVE_PLATFORM) {
      // On mobile, Google blocks OAuth in embedded WebViews (Error 400: invalid_request).
      // Use Capacitor Browser to open the system browser instead.
      import('@capacitor/browser').then(({ Browser }) =>
        Browser.open({ url, presentationStyle: 'popover' }),
      );
    } else {
      const popup = window.open(url, '_blank', 'width=600,height=700');
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    }
  }

  private _oauthPersistenceKey(pluginId: string): string {
    return `${pluginId}__oauth`;
  }

  private async _persistOAuthTokens(pluginId: string): Promise<void> {
    const serialized = this._pluginOAuthService.serializeTokens(pluginId);
    if (serialized) {
      try {
        await saveOAuthTokens(this._oauthPersistenceKey(pluginId), serialized);
      } catch (error) {
        PluginLog.err('PluginOAuthBridge: Failed to persist OAuth tokens:', error);
      }
    }
  }

  private async _restoreOAuthTokens(pluginId: string): Promise<void> {
    try {
      const serialized = await loadOAuthTokens(this._oauthPersistenceKey(pluginId));
      if (serialized) {
        this._pluginOAuthService.restoreTokens(pluginId, serialized);
      }
    } catch (error) {
      PluginLog.err('PluginOAuthBridge: Failed to restore OAuth tokens:', error);
    }
  }

  private async _clearPersistedOAuthTokens(pluginId: string): Promise<void> {
    try {
      await deleteOAuthTokens(this._oauthPersistenceKey(pluginId));
    } catch (error) {
      PluginLog.err('PluginOAuthBridge: Failed to clear persisted OAuth tokens:', error);
    }
  }
}

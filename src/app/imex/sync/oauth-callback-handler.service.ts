import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { IS_ELECTRON } from '../../app.constants';
import { SyncLog } from '../../core/log';
import { PluginOAuthService } from '../../plugins/oauth/plugin-oauth.service';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { validateOAuthState } from './oauth-state.util';

type OAuthProvider = 'dropbox' | 'onedrive' | 'plugin' | 'unknown';

export interface OAuthCallbackData {
  code?: string;
  error?: string;
  error_description?: string;
  provider: OAuthProvider;
}

@Injectable({
  providedIn: 'root',
})
export class OAuthCallbackHandlerService implements OnDestroy {
  private _pluginOAuthService = inject(PluginOAuthService);
  private _authCodeReceived$ = new Subject<OAuthCallbackData>();
  private _urlListenerHandle?: PluginListenerHandle;
  private _isDestroyed = false;

  readonly authCodeReceived$ = this._authCodeReceived$.asObservable();

  constructor() {
    if (IS_NATIVE_PLATFORM) {
      this._setupAppUrlListener();
    }
    if (IS_ELECTRON && typeof window !== 'undefined' && !!window.ea?.on) {
      this._setupElectronOAuthListener();
    }
  }

  ngOnDestroy(): void {
    this._isDestroyed = true;
    this._urlListenerHandle?.remove();
    this._authCodeReceived$.complete();
  }

  private async _setupAppUrlListener(): Promise<void> {
    this._urlListenerHandle = await App.addListener(
      'appUrlOpen',
      (event: URLOpenListenerEvent) => {
        SyncLog.log('OAuthCallbackHandler: Received URL');

        if (event.url.includes('plugin-oauth-callback')) {
          this._handlePluginOAuthCallback(event.url);
        } else if (
          event.url.startsWith('com.super-productivity.app://oauth-callback') ||
          event.url.startsWith('superproductivity://oauth-callback')
        ) {
          const callbackData = this._parseOAuthCallback(event.url);

          if (callbackData.code) {
            SyncLog.log('OAuthCallbackHandler: Extracted auth code');
          } else if (callbackData.error) {
            SyncLog.warn(
              'OAuthCallbackHandler: OAuth error',
              callbackData.error,
              callbackData.error_description,
            );
          } else {
            SyncLog.warn('OAuthCallbackHandler: No auth code or error in URL');
          }

          this._authCodeReceived$.next(callbackData);
        }
      },
    );
  }

  private _setupElectronOAuthListener(): void {
    window.ea.on(IPC.OAUTH_CALLBACK, (_event, payload) => {
      if (this._isDestroyed) {
        return;
      }
      const callbackUrl =
        typeof payload === 'string'
          ? payload
          : (payload as { url?: string } | undefined)?.url;

      if (!callbackUrl) {
        SyncLog.warn('OAuthCallbackHandler: Missing callback URL payload from Electron');
        return;
      }

      if (!callbackUrl.startsWith('superproductivity://oauth-callback')) {
        SyncLog.warn(
          'OAuthCallbackHandler: Rejected callback URL with unexpected scheme',
          callbackUrl.split(':')[0],
        );
        return;
      }

      SyncLog.log('OAuthCallbackHandler: Received Electron OAuth callback URL');
      this._authCodeReceived$.next(this._parseOAuthCallback(callbackUrl));
    });
  }

  private _parseOAuthCallback(url: string): OAuthCallbackData {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      const errorDescription = urlObj.searchParams.get('error_description');
      const state = urlObj.searchParams.get('state');
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const providerFromPath = pathParts[0]?.toLowerCase();
      const providerFromQuery = urlObj.searchParams.get('provider')?.toLowerCase();
      const providerRaw = providerFromPath || providerFromQuery;

      // Validate state for OneDrive CSRF protection.
      let provider: OAuthProvider;
      if (providerRaw === 'onedrive') {
        const stateValid = validateOAuthState('onedrive', state);
        if (!stateValid) {
          SyncLog.warn(
            'OAuthCallbackHandler: Invalid or missing state for OneDrive callback',
          );
          return {
            error: 'invalid_state',
            error_description: 'OAuth state validation failed',
            provider: 'onedrive',
          };
        }
        provider = 'onedrive';
      } else if (providerRaw === 'dropbox') {
        provider = 'dropbox';
      } else if (providerRaw === 'plugin') {
        provider = 'plugin';
      } else {
        SyncLog.warn('OAuthCallbackHandler: Unknown provider in callback', providerRaw);
        provider = 'unknown';
      }

      return {
        code: code || undefined,
        error: error || undefined,
        error_description: errorDescription || undefined,
        provider,
      };
    } catch (e) {
      SyncLog.err('OAuthCallbackHandler: Failed to parse URL');
      return {
        error: 'parse_error',
        error_description: 'Failed to parse OAuth callback URL',
        provider: 'unknown',
      };
    }
  }

  private _handlePluginOAuthCallback(url: string): void {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      const state = urlObj.searchParams.get('state') ?? undefined;

      if (code) {
        SyncLog.log('OAuthCallbackHandler: Extracted plugin OAuth code');
        this._pluginOAuthService.handleRedirectCode(code, state);
      } else if (error) {
        SyncLog.warn('OAuthCallbackHandler: Plugin OAuth error', error);
        this._pluginOAuthService.handleRedirectError(error, state);
      } else {
        SyncLog.warn('OAuthCallbackHandler: No code or error in plugin OAuth URL');
        this._pluginOAuthService.handleRedirectError('no_code_or_error', state);
      }
    } catch (e) {
      SyncLog.err('OAuthCallbackHandler: Failed to parse plugin OAuth URL', url, e);
      this._pluginOAuthService.handleRedirectError('parse_error');
    }
  }
}

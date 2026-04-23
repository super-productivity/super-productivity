import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { IS_ELECTRON } from '../../app.constants';
import { SyncLog } from '../../core/log';
import { PluginOAuthService } from '../../plugins/oauth/plugin-oauth.service';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';

type OAuthProvider = 'dropbox' | 'onedrive' | 'plugin';

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
    this._urlListenerHandle?.remove();
    this._authCodeReceived$.complete();
  }

  private async _setupAppUrlListener(): Promise<void> {
    this._urlListenerHandle = await App.addListener(
      'appUrlOpen',
      (event: URLOpenListenerEvent) => {
        SyncLog.log('OAuthCallbackHandler: Received URL', event.url);

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
            SyncLog.warn('OAuthCallbackHandler: No auth code or error in URL', event.url);
          }

          this._authCodeReceived$.next(callbackData);
        }
      },
    );
  }

  private _setupElectronOAuthListener(): void {
    window.ea.on(IPC.OAUTH_CALLBACK, (_event, payload) => {
      const callbackUrl =
        typeof payload === 'string'
          ? payload
          : (payload as { url?: string } | undefined)?.url;

      if (!callbackUrl) {
        SyncLog.warn('OAuthCallbackHandler: Missing callback URL payload from Electron');
        return;
      }

      SyncLog.log(
        'OAuthCallbackHandler: Received Electron OAuth callback URL',
        callbackUrl,
      );
      this._authCodeReceived$.next(this._parseOAuthCallback(callbackUrl));
    });
  }

  private _parseOAuthCallback(url: string): OAuthCallbackData {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      const errorDescription = urlObj.searchParams.get('error_description');
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const providerFromPath = pathParts[0]?.toLowerCase();
      const providerFromQuery = urlObj.searchParams.get('provider')?.toLowerCase();
      const providerRaw = providerFromPath || providerFromQuery;
      const provider: OAuthProvider =
        providerRaw === 'onedrive'
          ? 'onedrive'
          : providerRaw === 'plugin'
            ? 'plugin'
            : 'dropbox';

      return {
        code: code || undefined,
        error: error || undefined,
        error_description: errorDescription || undefined,
        provider,
      };
    } catch (e) {
      SyncLog.err('OAuthCallbackHandler: Failed to parse URL', url, e);
      return {
        error: 'parse_error',
        error_description: 'Failed to parse OAuth callback URL',
        provider: 'dropbox',
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
        SyncLog.warn('OAuthCallbackHandler: No code or error in plugin OAuth URL', url);
        this._pluginOAuthService.handleRedirectError('no_code_or_error', state);
      }
    } catch (e) {
      SyncLog.err('OAuthCallbackHandler: Failed to parse plugin OAuth URL', url, e);
      this._pluginOAuthService.handleRedirectError('parse_error');
    }
  }
}

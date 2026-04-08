import { Injectable, OnDestroy, inject } from '@angular/core';
import { PluginOAuthService } from './plugin-oauth.service';
import { IS_ELECTRON } from '../../app.constants';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';

/**
 * Bridges platform-specific OAuth redirect callbacks to PluginOAuthService.
 *
 * - Web: listens for `postMessage` from the OAuth callback popup.
 * - Electron: listens for IPC via `window.ea.onPluginOAuthCb`.
 *
 * Must be instantiated at boot (via APP_INITIALIZER) so the listeners
 * are registered before any OAuth flow starts.
 */
@Injectable({ providedIn: 'root' })
export class PluginOAuthRedirectHandler implements OnDestroy {
  private _oauthService = inject(PluginOAuthService);
  private _messageListener?: (event: MessageEvent) => void;

  constructor() {
    if (IS_ELECTRON) {
      this._setupElectronListener();
    } else if (!IS_NATIVE_PLATFORM) {
      // Native mobile OAuth redirects are handled by OAuthCallbackHandlerService
      // via Capacitor's appUrlOpen listener, not by this handler.
      this._setupWebListener();
    }
  }

  ngOnDestroy(): void {
    if (this._messageListener) {
      window.removeEventListener('message', this._messageListener);
    }
  }

  private _setupWebListener(): void {
    this._messageListener = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type !== 'SP_OAUTH_CALLBACK') {
        return;
      }
      if (event.data.code) {
        this._oauthService.handleRedirectCode(event.data.code, event.data.state);
      } else if (event.data.error) {
        this._oauthService.handleRedirectError(event.data.error, event.data.state);
      }
    };
    window.addEventListener('message', this._messageListener);
  }

  private _setupElectronListener(): void {
    // Note: Electron IPC listener is never removed because this service lives
    // for the app lifetime (providedIn: 'root', bootstrapped via APP_INITIALIZER).
    // The preload API does not expose a removeListener method.
    window.ea.onPluginOAuthCb((data) => {
      if (data.code) {
        this._oauthService.handleRedirectCode(data.code, data.state);
      } else if (data.error) {
        this._oauthService.handleRedirectError(data.error, data.state);
      }
    });
  }
}

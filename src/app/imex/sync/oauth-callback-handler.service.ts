import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { SyncLog } from '../../core/log';

export interface OAuthCallbackData {
  code?: string;
  error?: string;
  error_description?: string;
  provider: 'dropbox';
}

@Injectable({
  providedIn: 'root',
})
export class OAuthCallbackHandlerService implements OnDestroy {
  private _authCodeReceived$ = new Subject<OAuthCallbackData>();
  private _urlListenerHandle?: PluginListenerHandle;

  readonly authCodeReceived$ = this._authCodeReceived$.asObservable();

  constructor() {
    if (IS_NATIVE_PLATFORM) {
      this._setupAppUrlListener();
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

        if (event.url.startsWith('com.super-productivity.app://oauth-callback')) {
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

  private _parseOAuthCallback(url: string): OAuthCallbackData {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      const errorDescription = urlObj.searchParams.get('error_description');

      return {
        code: code || undefined,
        error: error || undefined,
        error_description: errorDescription || undefined,
        provider: 'dropbox',
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
}

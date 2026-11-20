import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HttpNotOkAPIError } from '../../op-log/core/errors/sync-errors';
import { SyncProviderId } from '../../op-log/sync-exports';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncLog } from '../../core/log';
import { T } from '../../t.const';
import { getErrorTxt } from '../../util/get-error-text';
import { escapeHtml } from '../../util/escape-html';
import { DialogGetAndEnterAuthCodeComponent } from './dialog-get-and-enter-auth-code/dialog-get-and-enter-auth-code.component';

/**
 * OAuth-style provider setup (Dropbox, OneDrive): opens the auth-code dialog,
 * exchanges the code and saves the tokens next to the existing config.
 * SyncWrapperService keeps `configuredAuthForSyncProviderIfNecessary` as the
 * entry point and passes in the re-sync to run afterwards.
 */
@Injectable({
  providedIn: 'root',
})
export class SyncProviderAuthService {
  private _providerManager = inject(SyncProviderManager);
  private _matDialog = inject(MatDialog);
  private _snackService = inject(SnackService);

  async configureIfNecessary(
    providerId: SyncProviderId,
    force: boolean,
    onConfigured: () => void,
  ): Promise<{ wasConfigured: boolean }> {
    const provider = await this._providerManager.getProviderById(providerId);

    if (!provider) {
      return { wasConfigured: false };
    }

    if (!provider.getAuthHelper) {
      return { wasConfigured: false };
    }

    if (!force && (await provider.isReady())) {
      SyncLog.warn('Provider already configured');
      return { wasConfigured: false };
    }

    try {
      const { authUrl, codeVerifier, verifyCodeChallenge } =
        await provider.getAuthHelper();
      if (authUrl && codeVerifier && verifyCodeChallenge) {
        const authCode = await this._matDialog
          .open(DialogGetAndEnterAuthCodeComponent, {
            restoreFocus: true,
            data: {
              providerName: provider.id,
              url: authUrl,
            },
          })
          .afterClosed()
          .toPromise();
        if (authCode) {
          const r = await verifyCodeChallenge(authCode);
          // Preserve existing config (especially encryptKey) when updating auth
          const existingConfig = await provider.privateCfg.load();
          await this._providerManager.setProviderConfig(provider.id, {
            ...existingConfig,
            ...r,
          });
          // NOTE: exec sync afterward; promise not awaited
          setTimeout(() => {
            onConfigured();
          }, 1000);
          return { wasConfigured: true };
        } else {
          return { wasConfigured: false };
        }
      }
    } catch (error) {
      SyncLog.err(`Failed to configure auth for provider ${providerId}:`, error);
      const httpErr = error instanceof HttpNotOkAPIError ? error : null;
      const httpStatus = httpErr?.response.status;
      const isTokenExchangeError = httpStatus === 400;
      const isAuthServiceUnavailable =
        httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600;
      // Dropbox recommends retaining this response ID for support investigations.
      // https://developers.dropbox.com/error-handling-guide#logging
      const providerRequestId =
        providerId === SyncProviderId.Dropbox
          ? httpErr?.response.headers.get('X-Dropbox-Request-Id')
          : null;
      // A OneDrive token-exchange 400 is almost always a misconfigured
      // Microsoft Entra app registration (typically "Allow public client
      // flows" disabled), not a mistyped/expired code — the authorize step
      // already succeeded. Point the user at the registration fix and surface
      // the Azure error detail (AADSTSxxxxx, carried on the UI-only `.detail`)
      // so it is self-diagnosable.
      let msg: string;
      let translateParams: { [key: string]: string } | undefined;
      if (isTokenExchangeError && providerId === SyncProviderId.OneDrive) {
        msg = T.F.SYNC.S.ONEDRIVE_AUTH_FAILED;
        translateParams = { error: httpErr?.detail || getErrorTxt(error) };
      } else if (isTokenExchangeError) {
        msg = T.F.SYNC.S.INVALID_AUTH_CODE;
      } else if (isAuthServiceUnavailable) {
        translateParams = { status: String(httpStatus) };
        if (providerRequestId) {
          msg = T.F.SYNC.S.AUTH_SERVICE_UNAVAILABLE_WITH_REFERENCE;
          translateParams.reference = escapeHtml(providerRequestId);
        } else {
          msg = T.F.SYNC.S.AUTH_SERVICE_UNAVAILABLE;
        }
      } else {
        msg = T.F.SYNC.S.AUTH_SETUP_FAILED;
      }
      this._snackService.open({
        msg,
        translateParams,
        type: 'ERROR',
        config: { duration: 0 },
      });
      return { wasConfigured: false };
    }
    return { wasConfigured: false };
  }
}

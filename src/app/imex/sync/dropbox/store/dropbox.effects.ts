import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { Observable } from 'rxjs';
import { filter, tap, withLatestFrom } from 'rxjs/operators';
import { SyncConfig } from '../../../../features/config/global-config.model';
import { updateGlobalConfigSection } from '../../../../features/config/store/global-config.actions';
import { environment } from '../../../../../environments/environment';
import { SyncProviderManager } from '../../../../op-log/sync-providers/provider-manager.service';
import { DropboxPrivateCfg, SyncProviderId } from '../../../../op-log/sync-exports';

@Injectable()
export class DropboxEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _providerManager = inject(SyncProviderManager);

  askToDeleteTokensOnDisable$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter(
          ({ sectionKey, sectionCfg }): boolean =>
            sectionKey === 'sync' && (sectionCfg as SyncConfig).isEnabled === false,
        ),
        withLatestFrom(this._providerManager.currentProviderPrivateCfg$),
        tap(async ([, provider]) => {
          if (
            provider?.providerId === SyncProviderId.Dropbox &&
            (provider.privateCfg as DropboxPrivateCfg)?.accessToken
          ) {
            if (!environment.production && !confirm('DEV: Delete Dropbox Tokens?')) {
              return;
            }
            alert('Delete tokens');
            const existingConfig = provider.privateCfg as DropboxPrivateCfg;
            await this._providerManager.setProviderConfig(SyncProviderId.Dropbox, {
              ...existingConfig,
              accessToken: '',
              refreshToken: '',
            });
          }
        }),
      ),
    { dispatch: false },
  );
}

import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { Observable } from 'rxjs';
import { filter, tap } from 'rxjs/operators';
import { SyncConfig } from '../../../../features/config/global-config.model';
import { updateGlobalConfigSection } from '../../../../features/config/store/global-config.actions';
import { environment } from '../../../../../environments/environment';
import { SyncProviderManager } from '../../../../op-log/sync-providers/provider-manager.service';
import { DropboxPrivateCfg, SyncProviderId } from '../../../../op-log/sync-exports';
import { LegacySyncProvider } from '../../legacy-sync-provider.model';
import { confirmDialog } from '../../../../util/native-dialogs';

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
        tap(async ({ sectionCfg }) => {
          const syncCfg = sectionCfg as SyncConfig;
          if (syncCfg.syncProvider !== LegacySyncProvider.Dropbox) {
            return;
          }
          const provider = this._providerManager.getProviderById(SyncProviderId.Dropbox);
          if (!provider) {
            return;
          }
          const existingConfig =
            (await provider.privateCfg.load()) as DropboxPrivateCfg | null;
          if (!existingConfig?.accessToken && !existingConfig?.refreshToken) {
            return;
          }
          if (!environment.production && !confirmDialog('DEV: Delete Dropbox Tokens?')) {
            return;
          }
          await this._providerManager.setProviderConfig(SyncProviderId.Dropbox, {
            ...existingConfig,
            accessToken: '',
            refreshToken: '',
          });
        }),
      ),
    { dispatch: false },
  );
}

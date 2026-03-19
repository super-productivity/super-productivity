import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { distinctUntilChanged, filter, tap } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { SUPER_SYNC_DEFAULT_BASE_URL } from '../../../op-log/sync-providers/super-sync/super-sync.model';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { DroidLog } from '../../../core/log';
import { SuperSyncPrivateCfg } from '../../../op-log/sync-providers/super-sync/super-sync.model';

/**
 * Mirrors SuperSync credentials to native SharedPreferences so the
 * background SyncReminderWorker can authenticate against the server
 * without needing the WebView.
 */
@Injectable()
export class AndroidSyncBridgeEffects {
  private _providerManager = inject(SyncProviderManager);

  syncSuperSyncCredentialsToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._providerManager.currentProviderPrivateCfg$.pipe(
          skipWhileApplyingRemoteOps(),
          distinctUntilChanged(
            (a, b) =>
              a?.providerId === b?.providerId &&
              (a?.privateCfg as SuperSyncPrivateCfg | null)?.baseUrl ===
                (b?.privateCfg as SuperSyncPrivateCfg | null)?.baseUrl &&
              (a?.privateCfg as SuperSyncPrivateCfg | null)?.accessToken ===
                (b?.privateCfg as SuperSyncPrivateCfg | null)?.accessToken,
          ),
          filter((cfg) => cfg !== null),
          tap((cfg) => {
            if (cfg!.providerId === SyncProviderId.SuperSync && cfg!.privateCfg) {
              const privateCfg = cfg!.privateCfg as SuperSyncPrivateCfg;
              if (privateCfg.accessToken) {
                const baseUrl = privateCfg.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL;
                DroidLog.log('AndroidSyncBridgeEffects: Setting SuperSync credentials');
                androidInterface.setSuperSyncCredentials?.(
                  baseUrl,
                  privateCfg.accessToken,
                );
              } else {
                DroidLog.log(
                  'AndroidSyncBridgeEffects: No access token, clearing credentials',
                );
                androidInterface.clearSuperSyncCredentials?.();
              }
            } else {
              // Different provider or null config — clear SuperSync credentials
              DroidLog.log(
                'AndroidSyncBridgeEffects: Non-SuperSync provider, clearing credentials',
              );
              androidInterface.clearSuperSyncCredentials?.();
            }
          }),
        ),
      { dispatch: false },
    );
}

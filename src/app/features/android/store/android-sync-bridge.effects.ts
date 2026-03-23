import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { distinctUntilChanged, filter, tap } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import {
  SUPER_SYNC_DEFAULT_BASE_URL,
  SuperSyncPrivateCfg,
} from '../../../op-log/sync-providers/super-sync/super-sync.model';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { DroidLog } from '../../../core/log';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';

/**
 * Compares two provider configs for credential-relevant equality.
 *
 * Returns true (equal) when emissions should be suppressed:
 * - Provider ID changed → false (always emit)
 * - Both non-SuperSync → true (suppress, prevents repeated clearSuperSyncCredentials calls)
 * - Both SuperSync → compare accessToken and baseUrl
 */
const credentialConfigEqual = (
  a: CurrentProviderPrivateCfg | null,
  b: CurrentProviderPrivateCfg | null,
): boolean => {
  if (a?.providerId !== b?.providerId) return false;
  if (a?.providerId !== SyncProviderId.SuperSync) return true;
  const aCfg = a?.privateCfg as SuperSyncPrivateCfg | undefined;
  const bCfg = b?.privateCfg as SuperSyncPrivateCfg | undefined;
  return aCfg?.accessToken === bCfg?.accessToken && aCfg?.baseUrl === bCfg?.baseUrl;
};

const isNonNull = (
  cfg: CurrentProviderPrivateCfg | null,
): cfg is CurrentProviderPrivateCfg => cfg !== null;

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
          distinctUntilChanged(credentialConfigEqual),
          filter(isNonNull),
          tap((cfg) => {
            if (cfg.providerId === SyncProviderId.SuperSync && cfg.privateCfg) {
              const privateCfg = cfg.privateCfg as SuperSyncPrivateCfg;
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

import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { distinctUntilChanged, filter, map, tap } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import {
  SUPER_SYNC_DEFAULT_BASE_URL,
  SuperSyncPrivateCfg,
} from '@sp/sync-providers/super-sync';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { DroidLog } from '../../../core/log';
import { CurrentProviderPrivateCfg } from '../../../op-log/core/types/sync.types';
import { isShallowEqual } from '../../../util/is-shallow-equal';

const isNonNull = <T>(value: T | null): value is T => value !== null;

export type SuperSyncCredentialBridgeCommand =
  | {
      type: 'set';
      baseUrl: string;
      accessToken: string;
      /** E2EE password for decrypting op payloads natively; '' clears it */
      encryptionPassword: string;
    }
  | {
      type: 'clear';
      reason: 'no-token' | 'not-supersync';
    };

export const getSuperSyncCredentialBridgeCommand = (
  cfg: CurrentProviderPrivateCfg,
): SuperSyncCredentialBridgeCommand => {
  if (cfg.providerId === SyncProviderId.SuperSync && cfg.privateCfg) {
    const privateCfg = cfg.privateCfg as SuperSyncPrivateCfg;
    if (privateCfg.accessToken) {
      return {
        type: 'set',
        baseUrl: privateCfg.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL,
        accessToken: privateCfg.accessToken,
        encryptionPassword: privateCfg.encryptKey || '',
      };
    }
    return { type: 'clear', reason: 'no-token' };
  }
  return { type: 'clear', reason: 'not-supersync' };
};

/**
 * Two commands are equal when replaying the second would be a no-op on the
 * native side — comparing commands (not configs) means credential-irrelevant
 * config changes and repeated clears are suppressed automatically.
 */
export const bridgeCommandEqual = (
  a: SuperSyncCredentialBridgeCommand | null,
  b: SuperSyncCredentialBridgeCommand | null,
): boolean => (a === null || b === null ? a === b : isShallowEqual(a, b));

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
          map((cfg) => (cfg ? getSuperSyncCredentialBridgeCommand(cfg) : null)),
          distinctUntilChanged(bridgeCommandEqual),
          filter(isNonNull),
          tap((command) => {
            if (command.type === 'set') {
              DroidLog.log('AndroidSyncBridgeEffects: Setting SuperSync credentials');
              androidInterface.setSuperSyncCredentials?.(
                command.baseUrl,
                command.accessToken,
              );
              // Optional chaining: old APKs don't have this method yet.
              // The password itself must never be logged.
              androidInterface.setSuperSyncEncryptionPassword?.(
                command.encryptionPassword,
              );
            } else if (command.reason === 'no-token') {
              DroidLog.log(
                'AndroidSyncBridgeEffects: No access token, clearing credentials',
              );
              androidInterface.clearSuperSyncCredentials?.();
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

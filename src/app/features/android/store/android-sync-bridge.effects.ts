import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { combineLatest } from 'rxjs';
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
import { GlobalConfigService } from '../../config/global-config.service';
import { CaptureKeyConfig, ReminderConfig } from '../../config/global-config.model';

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

export type BackgroundReminderSettings = {
  isDisabled: boolean;
  useAlarmStyle: boolean;
};

/**
 * The reminder settings the native SyncReminderWorker needs to schedule alarms
 * like the app would (see capacitor-reminder.service.ts). Defaults match the
 * worker's behavior before settings were mirrored.
 */
export const getBackgroundReminderSettings = (
  cfg: ReminderConfig | undefined,
): BackgroundReminderSettings => ({
  isDisabled: !!cfg?.disableReminders,
  useAlarmStyle: !!cfg?.useAlarmStyleReminders,
});

/**
 * The capture public key native code seals Android shares to, or '' when
 * shares must stay on the device: no SuperSync login, capture off, or a key
 * from a newer client whose format this version cannot know.
 */
export const getCapturePublicKeyForNative = (
  key: CaptureKeyConfig | null | undefined,
  hasSuperSyncCredentials: boolean,
): string =>
  hasSuperSyncCredentials && key?.v === 1 && key.publicKeySpki ? key.publicKeySpki : '';

/**
 * Mirrors SuperSync credentials to native SharedPreferences so the
 * background SyncReminderWorker can authenticate against the server
 * without needing the WebView.
 */
@Injectable()
export class AndroidSyncBridgeEffects {
  private _providerManager = inject(SyncProviderManager);
  private _globalConfigService = inject(GlobalConfigService);

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

  /**
   * Mirrors the reminder settings so the background worker does not schedule
   * alarms while reminders are disabled and uses alarm style when enabled.
   *
   * SYNC-SAFE without skipWhileApplyingRemoteOps: dispatch:false and an
   * idempotent native call only. A setting changed on another device must
   * reach the worker too, so remote config updates are deliberately mirrored.
   */
  syncReminderSettingsToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._globalConfigService.cfg$.pipe(
          map((cfg) => getBackgroundReminderSettings(cfg?.reminder)),
          distinctUntilChanged(
            (a, b) =>
              a.isDisabled === b.isDisabled && a.useAlarmStyle === b.useAlarmStyle,
          ),
          tap(({ isDisabled, useAlarmStyle }) => {
            // Optional chaining: old APKs don't have this method yet.
            androidInterface.setBackgroundReminderSettings?.(isDisabled, useAlarmStyle);
          }),
        ),
      { dispatch: false },
    );

  /**
   * Mirrors the SuperSync capture public key, so a share made while the app is
   * closed uploads sealed to it (ShareUploader.kt). Native only uploads while
   * SuperSync credentials are mirrored too; clearing them clears the key.
   *
   * SYNC-SAFE without skipWhileApplyingRemoteOps, like the reminder settings:
   * dispatch:false and an idempotent native call. Capture switched on or off
   * on another device must reach native, or shares would never upload, or
   * would keep sealing to a dropped key.
   */
  syncCapturePublicKeyToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._globalConfigService.cfg$,
          this._providerManager.currentProviderPrivateCfg$.pipe(
            map(
              (cfg) => !!cfg && getSuperSyncCredentialBridgeCommand(cfg).type === 'set',
            ),
          ),
        ]).pipe(
          map(([cfg, hasCredentials]) =>
            getCapturePublicKeyForNative(cfg?.sync?.captureKey, hasCredentials),
          ),
          distinctUntilChanged(),
          tap((publicKeySpki) => {
            // Optional chaining: old APKs don't have this method yet.
            androidInterface.setCapturePublicKey?.(publicKeySpki);
          }),
        ),
      { dispatch: false },
    );
}

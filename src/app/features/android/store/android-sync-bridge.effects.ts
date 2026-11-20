import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { combineLatest, from, Observable, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
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
import type { WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../op-log/sync-providers/file-based/file-based-sync.types';
import { isShallowEqual } from '../../../util/is-shallow-equal';
import { GlobalConfigService } from '../../config/global-config.service';
import {
  CaptureKeyConfig,
  GlobalConfigState,
  ReminderConfig,
} from '../../config/global-config.model';
import { getStartOfNextDayDiffMs } from '../../../util/start-of-next-day.util';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { selectAllTaskRepeatCfgs } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectArchivedProjectIds } from '../../project/store/project.selectors';
import { getRepeatCfgSnapshotForNative } from './get-repeat-cfg-snapshot-for-native';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { waitForSyncWindow } from '../../../util/wait-for-sync-window.operator';

// Coalesces bursts (a sync applying many ops) into one bridge call.
const REPEAT_CFG_SNAPSHOT_DEBOUNCE_MS = 2000;

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
      reason: 'no-token' | 'not-supersync' | 'sync-disabled';
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
 * File-based providers whose sync file the native worker can read. Both share
 * the WebDAV transport; the other file providers need OAuth refresh natively.
 */
const BACKGROUND_FILE_SYNC_PROVIDER_IDS: ReadonlySet<SyncProviderId> = new Set([
  SyncProviderId.WebDAV,
  SyncProviderId.Nextcloud,
]);

export type FileSyncReadRequest = { url: string; authorization: string };

type FileReadRequestProvider = {
  getFileReadRequest(targetPath: string): Promise<FileSyncReadRequest>;
};

export type FileSyncCredentialBridgeCommand = {
  type: 'set-file';
  /** GET target of the v2 sync file (sync-data.json) */
  fileUrl: string;
  authorization: string;
  /** Local encryption intent: native refuses a plaintext file when true */
  isEncryptionExpected: boolean;
  /** E2EE password for decrypting the file natively; '' clears it */
  encryptionPassword: string;
};

export type BackgroundSyncBridgeCommand =
  | SuperSyncCredentialBridgeCommand
  | FileSyncCredentialBridgeCommand;

export const isBackgroundFileSyncProvider = (providerId: SyncProviderId): boolean =>
  BACKGROUND_FILE_SYNC_PROVIDER_IDS.has(providerId);

export const getFileSyncCredentialBridgeCommand = (
  privateCfg: Pick<WebdavPrivateCfg, 'encryptKey' | 'isEncryptionEnabled'>,
  readRequest: FileSyncReadRequest,
): FileSyncCredentialBridgeCommand => ({
  type: 'set-file',
  fileUrl: readRequest.url,
  authorization: readRequest.authorization,
  // Same fallback as the sync config: pre-flag configs encrypt iff a key exists
  isEncryptionExpected: privateCfg.isEncryptionEnabled ?? !!privateCfg.encryptKey,
  encryptionPassword: privateCfg.encryptKey || '',
});

/**
 * Two commands are equal when replaying the second would be a no-op on the
 * native side — comparing commands (not configs) means credential-irrelevant
 * config changes and repeated clears are suppressed automatically.
 */
export const bridgeCommandEqual = (
  a: BackgroundSyncBridgeCommand | null,
  b: BackgroundSyncBridgeCommand | null,
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

/** Settings plus the start-of-next-day offset the repeat-reminder port needs. */
export const getBackgroundReminderBridgeSettings = (
  cfg: Pick<GlobalConfigState, 'reminder' | 'misc'> | undefined,
): BackgroundReminderSettings & { startOfNextDayDiffMs: number } => ({
  ...getBackgroundReminderSettings(cfg?.reminder),
  startOfNextDayDiffMs: getStartOfNextDayDiffMs(
    cfg?.misc?.startOfNextDayTime,
    cfg?.misc?.startOfNextDay,
  ),
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
 * Mirrors SuperSync or WebDAV/Nextcloud credentials to native
 * SharedPreferences so the background SyncReminderWorker can read synced
 * reminders without needing the WebView.
 */
@Injectable()
export class AndroidSyncBridgeEffects {
  private _providerManager = inject(SyncProviderManager);
  private _globalConfigService = inject(GlobalConfigService);
  private _dataInitStateService = inject(DataInitStateService);
  private _store = inject(Store);
  private _hydrationState = inject(HydrationStateService);

  // Created here, in the injection context: the operator injects on creation
  private readonly _skipWhileApplyingRemoteOps =
    skipWhileApplyingRemoteOps<CurrentProviderPrivateCfg | null>();

  /**
   * Turning sync off only makes the provider manager emit a null cfg, which
   * also happens transiently mid-switch, so it is read from the sync config:
   * otherwise the background worker keeps polling with the old login. Gated on
   * the data load so the pre-hydration default (sync off) never clears it.
   */
  private readonly _bridgeCommand$: Observable<BackgroundSyncBridgeCommand | null> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      switchMap(() => this._globalConfigService.sync$),
      map((syncCfg) => !!syncCfg.isEnabled),
      distinctUntilChanged(),
      switchMap((isSyncEnabled) =>
        isSyncEnabled
          ? this._providerManager.currentProviderPrivateCfg$.pipe(
              this._skipWhileApplyingRemoteOps,
              switchMap((cfg) => from(this._toBridgeCommand(cfg))),
            )
          : of<BackgroundSyncBridgeCommand>({ type: 'clear', reason: 'sync-disabled' }),
      ),
      distinctUntilChanged(bridgeCommandEqual),
    );

  syncSuperSyncCredentialsToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._bridgeCommand$.pipe(
          filter(isNonNull),
          tap((command) => {
            if (command.type === 'set-file') {
              DroidLog.log('AndroidSyncBridgeEffects: Setting file sync credentials');
              // Native drops any SuperSync credentials: one provider at a time.
              // Optional chaining: old APKs don't have this method yet.
              androidInterface.setFileSyncCredentials?.(
                command.fileUrl,
                command.authorization,
                command.isEncryptionExpected,
              );
              androidInterface.setSuperSyncEncryptionPassword?.(
                command.encryptionPassword,
              );
            } else if (command.type === 'set') {
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
            } else {
              DroidLog.log('AndroidSyncBridgeEffects: Clearing credentials', {
                reason: command.reason,
              });
              androidInterface.clearSuperSyncCredentials?.();
              // Also on 'no-token': a previous WebDAV login must not outlive the switch
              androidInterface.clearFileSyncCredentials?.();
            }
          }),
        ),
      { dispatch: false },
    );

  private async _toBridgeCommand(
    cfg: CurrentProviderPrivateCfg | null,
  ): Promise<BackgroundSyncBridgeCommand | null> {
    if (!cfg) {
      return null;
    }
    if (isBackgroundFileSyncProvider(cfg.providerId) && cfg.privateCfg) {
      try {
        const provider = (await this._providerManager.getProviderById(cfg.providerId)) as
          | Partial<FileReadRequestProvider>
          | undefined;
        const readRequest = await provider?.getFileReadRequest?.(
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        );
        if (readRequest) {
          return getFileSyncCredentialBridgeCommand(
            cfg.privateCfg as WebdavPrivateCfg,
            readRequest,
          );
        }
      } catch (e) {
        // Incomplete config (e.g. no base URL yet): clear like any other
        // provider the worker cannot read. Never log the error's cfg details.
        DroidLog.log('AndroidSyncBridgeEffects: File sync config not readable', {
          providerId: cfg.providerId,
          errorName: (e as Error)?.name,
        });
      }
    }
    return getSuperSyncCredentialBridgeCommand(cfg);
  }

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
          map((cfg) => getBackgroundReminderBridgeSettings(cfg)),
          distinctUntilChanged(
            (a, b) =>
              a.isDisabled === b.isDisabled &&
              a.useAlarmStyle === b.useAlarmStyle &&
              a.startOfNextDayDiffMs === b.startOfNextDayDiffMs,
          ),
          tap(({ isDisabled, useAlarmStyle, startOfNextDayDiffMs }) => {
            // Optional chaining: old APKs don't have these methods yet.
            androidInterface.setBackgroundReminderSettings?.(isDisabled, useAlarmStyle);
            androidInterface.setStartOfNextDayDiffMs?.(startOfNextDayDiffMs);
          }),
        ),
      { dispatch: false },
    );

  /**
   * Mirrors every repeat config to the background worker, which otherwise only
   * knows configs from ops it downloaded: one created before background sync
   * was on would never alarm, and one removed by an op it cannot fold would
   * keep alarming. Native drops it while no background-sync login is stored
   * and clears its cache on a login change, so a login change re-sends it.
   *
   * Starts after this session's first successful sync: before it (opened
   * offline, or closed mid-sync) the app's configs can be older than the
   * worker's, and replacing them would undo remote edits in the background.
   *
   * SYNC-SAFE: dispatch:false and an idempotent native call. Waits out the
   * sync window rather than dropping, so the settled state is what gets sent.
   */
  syncRepeatCfgsToNative$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._providerManager.syncStatus$.pipe(
          filter((status) => status === 'IN_SYNC'),
          take(1),
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTaskRepeatCfgs),
              this._store.select(selectArchivedProjectIds),
              this._bridgeCommand$,
            ]),
          ),
          // Also lets the credentials effect reach native first on a login.
          debounceTime(REPEAT_CFG_SNAPSHOT_DEBOUNCE_MS),
          waitForSyncWindow(this._hydrationState, 'AndroidRepeatCfgSnapshot'),
          map(([cfgs, archivedIds]) => getRepeatCfgSnapshotForNative(cfgs, archivedIds)),
          tap((json) => {
            // Optional chaining: old APKs don't have this method yet.
            androidInterface.setRepeatCfgSnapshot?.(json);
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

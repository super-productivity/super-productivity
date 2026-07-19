import { updateGlobalConfigSection } from './global-config.actions';
import {
  createFeatureSelector,
  createReducer,
  createSelector,
  MemoizedSelector,
  on,
} from '@ngrx/store';
import {
  ClipboardImagesConfig,
  FocusModeConfig,
  GlobalConfigState,
  MiscConfig,
  SyncConfig,
} from '../global-config.model';
import type { KeyboardConfig } from '@sp/keyboard-config';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { getHoursFromClockString } from '../../../util/get-hours-from-clock-string';
import { normalizeStartOfNextDayConfig } from '../normalize-start-of-next-day-config';
import { withLocalOnlySyncSettings } from '../local-only-sync-settings.util';

/**
 * Migrate the legacy `isSyncSessionWithTracking` flag (removed in the focus-mode
 * rework) to the new `autoStartFocusOnPlay` opt-in. Users who had sync enabled
 * relied on play→spawn behavior; without this, the upgrade would silently turn
 * auto-spawn off for them.
 *
 * Important: this runs on the RAW incoming config (before defaults are merged)
 * so `autoStartFocusOnPlay` is genuinely absent on pre-rework data — otherwise
 * the default `false` would short-circuit the `??` backfill below.
 */
const migrateFocusModeConfig = (
  cfg: Partial<FocusModeConfig> | undefined,
): Partial<FocusModeConfig> => {
  if (!cfg) {
    return {};
  }
  const legacy = cfg as Partial<FocusModeConfig> & {
    isSyncSessionWithTracking?: boolean;
  };
  // `hasOwnProperty.call` rather than `in` to avoid prototype-chain false positives.
  const hasLegacyKey = Object.prototype.hasOwnProperty.call(
    legacy,
    'isSyncSessionWithTracking',
  );
  if (!hasLegacyKey) {
    return cfg;
  }
  const { isSyncSessionWithTracking, ...rest } = legacy;
  // Only backfill when the user has not explicitly set the new key.
  const autoStartFocusOnPlay =
    rest.autoStartFocusOnPlay ?? isSyncSessionWithTracking === true;
  return { ...rest, autoStartFocusOnPlay };
};

export const CONFIG_FEATURE_NAME = 'globalConfig';
export const selectConfigFeatureState =
  createFeatureSelector<GlobalConfigState>(CONFIG_FEATURE_NAME);
/**
 * Builds a section selector that returns the config slice, falling back to the
 * baked-in default when the slice is missing (older data / partial snapshots).
 */
const createConfigSectionSelector = <K extends keyof GlobalConfigState>(
  key: K,
): MemoizedSelector<object, GlobalConfigState[K]> =>
  createSelector(
    selectConfigFeatureState,
    (cfg): GlobalConfigState[K] => cfg?.[key] ?? DEFAULT_GLOBAL_CONFIG[key],
  );

export const selectLocalizationConfig = createConfigSectionSelector('localization');
export const selectTasksConfig = createConfigSectionSelector('tasks');
export const selectMiscConfig = createConfigSectionSelector('misc');
export const selectShortSyntaxConfig = createConfigSectionSelector('shortSyntax');
export const selectSoundConfig = createConfigSectionSelector('sound');
export const selectEvaluationConfig = createConfigSectionSelector('evaluation');
export const selectIdleConfig = createConfigSectionSelector('idle');
export const selectSyncConfig = createConfigSectionSelector('sync');
export const selectTakeABreakConfig = createConfigSectionSelector('takeABreak');
// NOTE: the schedule slice is historically surfaced under the "Timeline" name.
export const selectTimelineConfig = createConfigSectionSelector('schedule');

/** @deprecated Exists only for migration to the voice-reminder plugin. */
export const selectIsDominaModeConfig = createConfigSectionSelector('dominaMode');

export const selectFocusModeConfig = createConfigSectionSelector('focusMode');
// Hand-written: `clipboardImages` is optional on the state, so the non-null
// assertion on the default keeps the public return type non-nullable.
export const selectClipboardImagesConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ClipboardImagesConfig =>
    cfg?.clipboardImages ?? DEFAULT_GLOBAL_CONFIG.clipboardImages!,
);
export const selectPomodoroConfig = createConfigSectionSelector('pomodoro');
export const selectFlowtimeConfig = createConfigSectionSelector('flowtime');
export const selectReminderConfig = createConfigSectionSelector('reminder');
export const selectAppFeaturesConfig = createConfigSectionSelector('appFeatures');
export const selectIsFocusModeEnabled = createSelector(
  selectConfigFeatureState,
  (cfg): boolean =>
    cfg?.appFeatures?.isFocusModeEnabled ??
    DEFAULT_GLOBAL_CONFIG.appFeatures.isFocusModeEnabled,
);

export const initialGlobalConfigState: GlobalConfigState = {
  ...DEFAULT_GLOBAL_CONFIG,
};

const migrateKeyboardConfig = (cfg: KeyboardConfig | undefined): KeyboardConfig => {
  const { moveToTodaysTasks, ...rest } =
    (cfg as (KeyboardConfig & { moveToTodaysTasks?: string | null }) | undefined) ?? {};

  let keyboard: KeyboardConfig = {
    ...DEFAULT_GLOBAL_CONFIG.keyboard,
    ...rest,
  };

  if (moveToTodaysTasks != null && rest.taskScheduleToday == null) {
    keyboard = {
      ...keyboard,
      taskScheduleToday: moveToTodaysTasks,
    };
  }

  if (
    rest.addNewNote === 'N' &&
    (rest.taskOpenNotesPanel === undefined || rest.taskOpenNotesPanel === null)
  ) {
    return {
      ...keyboard,
      addNewNote: DEFAULT_GLOBAL_CONFIG.keyboard.addNewNote,
      taskOpenNotesPanel: DEFAULT_GLOBAL_CONFIG.keyboard.taskOpenNotesPanel,
    };
  }

  return keyboard;
};

export const globalConfigReducer = createReducer<GlobalConfigState>(
  initialGlobalConfigState,

  on(loadAllData, (oldState, { appDataComplete }) => {
    if (!appDataComplete.globalConfig) {
      return oldState;
    }

    const incomingSyncConfig = {
      ...DEFAULT_GLOBAL_CONFIG.sync,
      ...appDataComplete.globalConfig.sync,
    };

    // Preserve local-only sync settings if they're already set.
    // These settings should remain local to each client:
    // - syncProvider: Each client can use different providers (Dropbox, WebDAV, etc.)
    // - isEnabled: Each client independently controls whether sync is enabled
    // - isEncryptionEnabled: Encryption state must not be overwritten by imports
    // - syncInterval: Each client chooses its own automatic sync frequency
    // - isManualSyncOnly: Each client chooses automatic vs manual sync
    //
    // If oldState.sync.syncProvider is null, we're on first load (using initialGlobalConfigState)
    // and should use the incoming values (from snapshot). Otherwise, preserve local values.
    const hasLocalSettings = oldState.sync.syncProvider !== null;

    const syncConfig = hasLocalSettings
      ? withLocalOnlySyncSettings(incomingSyncConfig, oldState.sync)
      : incomingSyncConfig;

    const incomingGlobalConfig = {
      ...DEFAULT_GLOBAL_CONFIG,
      ...appDataComplete.globalConfig,
      misc: {
        ...DEFAULT_GLOBAL_CONFIG.misc,
        ...appDataComplete.globalConfig.misc,
        ...normalizeStartOfNextDayConfig(appDataComplete.globalConfig.misc ?? {}),
      },
    };

    return {
      ...incomingGlobalConfig,
      // Merge defaults for tasks config to fill missing fields.
      // This handles data from older app versions or synced snapshots that
      // predate newly added fields (e.g., isAutoMarkParentAsDone, notesTemplate).
      appFeatures: {
        ...DEFAULT_GLOBAL_CONFIG.appFeatures,
        ...appDataComplete.globalConfig.appFeatures,
      },
      tasks: {
        ...DEFAULT_GLOBAL_CONFIG.tasks,
        ...appDataComplete.globalConfig.tasks,
        // Legacy configs stored `null`/`''` (the old "None" default) which no longer
        // has a matching dropdown option; coerce to the Inbox default so the select
        // shows a value. Behavior is unchanged — an unset default already routed new
        // tasks to the Inbox (#7891).
        defaultProjectId:
          appDataComplete.globalConfig.tasks?.defaultProjectId ||
          DEFAULT_GLOBAL_CONFIG.tasks.defaultProjectId,
      },
      shortSyntax: {
        ...DEFAULT_GLOBAL_CONFIG.shortSyntax,
        ...appDataComplete.globalConfig.shortSyntax,
      },
      localBackup: {
        ...DEFAULT_GLOBAL_CONFIG.localBackup,
        ...appDataComplete.globalConfig.localBackup,
      },
      focusMode: {
        ...DEFAULT_GLOBAL_CONFIG.focusMode,
        ...migrateFocusModeConfig(appDataComplete.globalConfig.focusMode),
      },
      idle: {
        ...DEFAULT_GLOBAL_CONFIG.idle,
        ...appDataComplete.globalConfig.idle,
      },
      keyboard: migrateKeyboardConfig(appDataComplete.globalConfig.keyboard),
      sync: syncConfig,
    };
  }),

  on(updateGlobalConfigSection, (state, action) => {
    const { sectionKey, sectionCfg } = action;
    const normalizedSectionCfg =
      sectionKey === 'misc'
        ? normalizeStartOfNextDayConfig(sectionCfg as Partial<MiscConfig>)
        : sectionCfg;
    const updatedSection = {
      ...state[sectionKey],
      ...normalizedSectionCfg,
    };

    // Preserve this device's local-only sync settings ONLY when the update came
    // from ANOTHER client. `isRemote` is also true while replaying the device's
    // OWN ops during hydration — keying off it there would overwrite the op's
    // real (own) sync settings with whatever local state happens to be mid-replay
    // (e.g. a null syncProvider when the crash snapshot predates the setup op),
    // silently disabling sync. See bulkOperationsMetaReducer.
    const isFromOtherClient =
      (action as { meta?: { isApplyingFromOtherClient?: boolean } }).meta
        ?.isApplyingFromOtherClient === true;
    const nextSection =
      sectionKey === 'sync' && isFromOtherClient
        ? withLocalOnlySyncSettings(updatedSection as SyncConfig, state.sync)
        : updatedSection;

    return {
      ...state,
      [sectionKey]: nextSection,
    };
  }),
);

export const selectTimelineWorkStartEndHours = createSelector(
  selectConfigFeatureState,
  (
    cfg,
  ): {
    workStart: number;
    workEnd: number;
  } | null => {
    const schedule = cfg?.schedule ?? DEFAULT_GLOBAL_CONFIG.schedule;
    if (!schedule.isWorkStartEndEnabled) {
      return null;
    }
    return {
      workStart: getHoursFromClockString(schedule.workStart),
      workEnd: getHoursFromClockString(schedule.workEnd),
    };
  },
);

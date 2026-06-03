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
} from '../global-config.model';
import type { KeyboardConfig } from '../keyboard-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { getHoursFromClockString } from '../../../util/get-hours-from-clock-string';
import { normalizeStartOfNextDayConfig } from '../normalize-start-of-next-day-config';

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
  const keyboard: KeyboardConfig = {
    ...DEFAULT_GLOBAL_CONFIG.keyboard,
    ...cfg,
  };

  if (
    cfg?.addNewNote === 'N' &&
    (cfg.taskOpenNotesPanel === undefined || cfg.taskOpenNotesPanel === null)
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

    const incomingSyncConfig = appDataComplete.globalConfig.sync;

    // Preserve local-only sync settings if they're already set.
    // These settings should remain local to each client:
    // - syncProvider: Each client can use different providers (Dropbox, WebDAV, etc.)
    // - isEnabled: Each client independently controls whether sync is enabled
    // - isEncryptionEnabled: Encryption state must not be overwritten by imports
    //
    // If oldState.sync.syncProvider is null, we're on first load (using initialGlobalConfigState)
    // and should use the incoming values (from snapshot). Otherwise, preserve local values.
    const hasLocalSettings = oldState.sync.syncProvider !== null;

    const syncProvider = hasLocalSettings
      ? oldState.sync.syncProvider
      : incomingSyncConfig.syncProvider;

    const isEnabled = hasLocalSettings
      ? oldState.sync.isEnabled
      : incomingSyncConfig.isEnabled;

    const isEncryptionEnabled = hasLocalSettings
      ? oldState.sync.isEncryptionEnabled
      : incomingSyncConfig.isEncryptionEnabled;

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
      focusMode: {
        ...DEFAULT_GLOBAL_CONFIG.focusMode,
        ...migrateFocusModeConfig(appDataComplete.globalConfig.focusMode),
      },
      keyboard: migrateKeyboardConfig(appDataComplete.globalConfig.keyboard),
      sync: {
        ...incomingSyncConfig,
        syncProvider,
        isEnabled,
        isEncryptionEnabled,
      },
    };
  }),

  on(updateGlobalConfigSection, (state, { sectionKey, sectionCfg }) => {
    const normalizedSectionCfg =
      sectionKey === 'misc'
        ? normalizeStartOfNextDayConfig(sectionCfg as Partial<MiscConfig>)
        : sectionCfg;

    return {
      ...state,
      [sectionKey]: {
        ...state[sectionKey],
        ...normalizedSectionCfg,
      },
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

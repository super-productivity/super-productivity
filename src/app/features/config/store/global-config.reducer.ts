import { updateGlobalConfigSection } from './global-config.actions';
import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import {
  AppFeaturesConfig,
  ClipboardImagesConfig,
  DominaModeConfig,
  EvaluationConfig,
  FocusModeConfig,
  GlobalConfigState,
  IdleConfig,
  LocalizationConfig,
  MiscConfig,
  PomodoroConfig,
  FlowtimeConfig,
  ReminderConfig,
  ScheduleConfig,
  ShortSyntaxConfig,
  SoundConfig,
  SyncConfig,
  TakeABreakConfig,
  TasksConfig,
} from '../global-config.model';
import type { KeyboardConfig } from '../keyboard-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { getHoursFromClockString } from '../../../util/get-hours-from-clock-string';
import { getStartOfNextDayHourFromTimeString } from '../../../util/start-of-next-day.util';

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
export const selectLocalizationConfig = createSelector(
  selectConfigFeatureState,
  (cfg): LocalizationConfig => cfg?.localization ?? DEFAULT_GLOBAL_CONFIG.localization,
);
export const selectTasksConfig = createSelector(
  selectConfigFeatureState,
  (cfg): TasksConfig => cfg.tasks ?? DEFAULT_GLOBAL_CONFIG.tasks,
);
export const selectMiscConfig = createSelector(
  selectConfigFeatureState,
  (cfg): MiscConfig => cfg?.misc ?? DEFAULT_GLOBAL_CONFIG.misc,
);
export const selectShortSyntaxConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ShortSyntaxConfig => cfg?.shortSyntax ?? DEFAULT_GLOBAL_CONFIG.shortSyntax,
);
export const selectSoundConfig = createSelector(
  selectConfigFeatureState,
  (cfg): SoundConfig => cfg?.sound ?? DEFAULT_GLOBAL_CONFIG.sound,
);
export const selectEvaluationConfig = createSelector(
  selectConfigFeatureState,
  (cfg): EvaluationConfig => cfg?.evaluation ?? DEFAULT_GLOBAL_CONFIG.evaluation,
);
export const selectIdleConfig = createSelector(
  selectConfigFeatureState,
  (cfg): IdleConfig => cfg?.idle ?? DEFAULT_GLOBAL_CONFIG.idle,
);
export const selectSyncConfig = createSelector(
  selectConfigFeatureState,
  (cfg): SyncConfig => cfg?.sync ?? DEFAULT_GLOBAL_CONFIG.sync,
);
export const selectTakeABreakConfig = createSelector(
  selectConfigFeatureState,
  (cfg): TakeABreakConfig => cfg?.takeABreak ?? DEFAULT_GLOBAL_CONFIG.takeABreak,
);
export const selectTimelineConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ScheduleConfig => cfg?.schedule ?? DEFAULT_GLOBAL_CONFIG.schedule,
);

/** @deprecated Exists only for migration to the voice-reminder plugin. */
export const selectIsDominaModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): DominaModeConfig => cfg?.dominaMode ?? DEFAULT_GLOBAL_CONFIG.dominaMode,
);

export const selectFocusModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): FocusModeConfig => cfg?.focusMode ?? DEFAULT_GLOBAL_CONFIG.focusMode,
);
export const selectClipboardImagesConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ClipboardImagesConfig =>
    cfg?.clipboardImages ?? DEFAULT_GLOBAL_CONFIG.clipboardImages!,
);
export const selectPomodoroConfig = createSelector(
  selectConfigFeatureState,
  (cfg): PomodoroConfig => cfg?.pomodoro ?? DEFAULT_GLOBAL_CONFIG.pomodoro,
);
export const selectFlowtimeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): FlowtimeConfig => cfg?.flowtime ?? DEFAULT_GLOBAL_CONFIG.flowtime,
);
export const selectReminderConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ReminderConfig => cfg?.reminder ?? DEFAULT_GLOBAL_CONFIG.reminder,
);
export const selectAppFeaturesConfig = createSelector(
  selectConfigFeatureState,
  (cfg): AppFeaturesConfig => cfg?.appFeatures ?? DEFAULT_GLOBAL_CONFIG.appFeatures,
);
export const selectIsFocusModeEnabled = createSelector(
  selectConfigFeatureState,
  (cfg): boolean =>
    cfg?.appFeatures?.isFocusModeEnabled ??
    DEFAULT_GLOBAL_CONFIG.appFeatures.isFocusModeEnabled,
);

export const initialGlobalConfigState: GlobalConfigState = {
  ...DEFAULT_GLOBAL_CONFIG,
};

const normalizeStartOfNextDayConfig = (
  misc: Partial<MiscConfig>,
): Partial<MiscConfig> => {
  // `startOfNextDayTime` wins when present. When both fields arrive together
  // from sync/REST/plugin payloads we keep minute precision from
  // `startOfNextDayTime` and derive a legacy hour-only `startOfNextDay`.
  // If only the legacy `startOfNextDay` arrives, minutes are unavoidably lost.
  type NormalizedMiscConfig = Omit<
    Partial<MiscConfig>,
    'startOfNextDay' | 'startOfNextDayTime'
  > & {
    startOfNextDay?: number;
    startOfNextDayTime?: string;
  };
  const normalized: NormalizedMiscConfig = { ...misc };

  if (typeof misc.startOfNextDayTime === 'string') {
    const hour = getStartOfNextDayHourFromTimeString(misc.startOfNextDayTime);
    if (hour != null) {
      normalized.startOfNextDay = hour;
    }
  }

  if (typeof misc.startOfNextDay === 'number' && normalized.startOfNextDayTime == null) {
    const hour = Math.max(0, Math.min(23, misc.startOfNextDay));
    normalized.startOfNextDayTime = `${String(hour).padStart(2, '0')}:00`;
  }

  return normalized;
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

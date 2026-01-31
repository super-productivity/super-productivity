import { updateGlobalConfigSection } from './global-config.actions';
import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import {
  AppFeaturesConfig,
  DominaModeConfig,
  EvaluationConfig,
  FocusModeConfig,
  GlobalConfigState,
  IdleConfig,
  LocalizationConfig,
  MiscConfig,
  PomodoroConfig,
  ReminderConfig,
  ScheduleConfig,
  ShortSyntaxConfig,
  SoundConfig,
  SyncConfig,
  TakeABreakConfig,
  TasksConfig,
} from '../global-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { getHoursFromClockString } from '../../../util/get-hours-from-clock-string';

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

export const selectIsDominaModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): DominaModeConfig => cfg?.dominaMode ?? DEFAULT_GLOBAL_CONFIG.dominaMode,
);

export const selectFocusModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): FocusModeConfig => cfg?.focusMode ?? DEFAULT_GLOBAL_CONFIG.focusMode,
);
export const selectPomodoroConfig = createSelector(
  selectConfigFeatureState,
  (cfg): PomodoroConfig => cfg?.pomodoro ?? DEFAULT_GLOBAL_CONFIG.pomodoro,
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

    return {
      ...appDataComplete.globalConfig,
      // Merge defaults for tasks config to fill missing fields.
      // This handles data from older app versions or synced snapshots that
      // predate newly added fields (e.g., isAutoMarkParentAsDone, notesTemplate).
      tasks: {
        ...DEFAULT_GLOBAL_CONFIG.tasks,
        ...appDataComplete.globalConfig.tasks,
      },
      sync: {
        ...incomingSyncConfig,
        syncProvider,
        isEnabled,
      },
    };
  }),

  on(updateGlobalConfigSection, (state, { sectionKey, sectionCfg }) => ({
    ...state,
    [sectionKey]: {
      ...state[sectionKey],
      ...sectionCfg,
    },
  })),
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

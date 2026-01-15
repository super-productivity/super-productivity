import { updateGlobalConfigSection } from './global-config.actions';
import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import {
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
} from '../global-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { getHoursFromClockString } from '../../../util/get-hours-from-clock-string';

export const CONFIG_FEATURE_NAME = 'globalConfig';
export const selectConfigFeatureState =
  createFeatureSelector<GlobalConfigState>(CONFIG_FEATURE_NAME);
export const selectLocalizationConfig = createSelector(
  selectConfigFeatureState,
  (cfg): LocalizationConfig => cfg.localization,
);
export const selectMiscConfig = createSelector(
  selectConfigFeatureState,
  (cfg): MiscConfig => cfg.misc,
);
export const selectShortSyntaxConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ShortSyntaxConfig => cfg.shortSyntax,
);
export const selectSoundConfig = createSelector(
  selectConfigFeatureState,
  (cfg): SoundConfig => cfg.sound,
);
export const selectEvaluationConfig = createSelector(
  selectConfigFeatureState,
  (cfg): EvaluationConfig => cfg.evaluation,
);
export const selectIdleConfig = createSelector(
  selectConfigFeatureState,
  (cfg): IdleConfig => cfg.idle,
);
export const selectSyncConfig = createSelector(
  selectConfigFeatureState,
  (cfg): SyncConfig => cfg.sync,
);
export const selectTakeABreakConfig = createSelector(
  selectConfigFeatureState,
  (cfg): TakeABreakConfig => cfg.takeABreak,
);
export const selectTimelineConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ScheduleConfig => cfg.schedule,
);

export const selectIsDominaModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): DominaModeConfig => cfg.dominaMode,
);

export const selectFocusModeConfig = createSelector(
  selectConfigFeatureState,
  (cfg): FocusModeConfig => cfg.focusMode,
);
export const selectPomodoroConfig = createSelector(
  selectConfigFeatureState,
  (cfg): PomodoroConfig => cfg.pomodoro,
);
export const selectReminderConfig = createSelector(
  selectConfigFeatureState,
  (cfg): ReminderConfig => cfg.reminder,
);
export const selectIsFocusModeEnabled = createSelector(
  selectConfigFeatureState,
  (cfg): boolean => cfg.appFeatures.isFocusModeEnabled,
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
    if (!cfg.schedule.isWorkStartEndEnabled) {
      return null;
    }
    return {
      workStart: getHoursFromClockString(cfg.schedule.workStart),
      workEnd: getHoursFromClockString(cfg.schedule.workEnd),
    };
  },
);

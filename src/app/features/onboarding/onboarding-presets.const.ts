import { AppFeaturesConfig } from '../config/global-config.model';

export interface OnboardingPreset {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  features: AppFeaturesConfig;
}

const BASE_FEATURES: AppFeaturesConfig = {
  isTimeTrackingEnabled: false,
  isFocusModeEnabled: false,
  isSchedulerEnabled: false,
  isPlannerEnabled: false,
  isBoardsEnabled: false,
  isScheduleDayPanelEnabled: false,
  isIssuesPanelEnabled: false,
  isProjectNotesEnabled: false,
  isSyncIconEnabled: true,
  isSearchEnabled: true,
  isDonatePageEnabled: true,
  isEnableUserProfiles: false,
  isHabitsEnabled: false,
  isFinishDayEnabled: false,
};

export const ONBOARDING_PRESETS: OnboardingPreset[] = [
  {
    id: 'simple-todo',
    titleKey: 'ONBOARDING.PRESETS.SIMPLE_TODO.TITLE',
    descriptionKey: 'ONBOARDING.PRESETS.SIMPLE_TODO.DESCRIPTION',
    icon: 'checklist',
    features: {
      ...BASE_FEATURES,
      isProjectNotesEnabled: true,
    },
  },
  {
    id: 'time-tracker',
    titleKey: 'ONBOARDING.PRESETS.TIME_TRACKER.TITLE',
    descriptionKey: 'ONBOARDING.PRESETS.TIME_TRACKER.DESCRIPTION',
    icon: 'timer',
    features: {
      ...BASE_FEATURES,
      isTimeTrackingEnabled: true,
      isPlannerEnabled: true,
      isFinishDayEnabled: true,
      isScheduleDayPanelEnabled: true,
      isProjectNotesEnabled: true,
    },
  },
  {
    id: 'productivity-pro',
    titleKey: 'ONBOARDING.PRESETS.PRODUCTIVITY_PRO.TITLE',
    descriptionKey: 'ONBOARDING.PRESETS.PRODUCTIVITY_PRO.DESCRIPTION',
    icon: 'rocket_launch',
    features: {
      ...BASE_FEATURES,
      isTimeTrackingEnabled: true,
      isFocusModeEnabled: true,
      isSchedulerEnabled: true,
      isPlannerEnabled: true,
      isBoardsEnabled: true,
      isScheduleDayPanelEnabled: true,
      isIssuesPanelEnabled: true,
      isProjectNotesEnabled: true,
      isHabitsEnabled: true,
    },
  },
];

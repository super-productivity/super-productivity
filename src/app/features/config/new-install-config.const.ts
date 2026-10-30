import { LS } from '../../core/persistence/storage-keys.const';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import {
  AppFeaturesConfig,
  GlobalConfigState,
  IdleConfig,
  TakeABreakConfig,
} from './global-config.model';

/**
 * The calm feature set a brand-new install starts with: tasks, planner and time
 * tracking. More (schedule, boards, habits, ...) can be switched on under
 * Settings › App Features.
 */
export const NEW_INSTALL_APP_FEATURES: AppFeaturesConfig = {
  ...DEFAULT_GLOBAL_CONFIG.appFeatures,
  isSchedulerEnabled: false,
  isScheduleDayPanelEnabled: false,
  isBoardsEnabled: false,
  isHabitsEnabled: false,
  isIssuesPanelEnabled: false,
  isFinishDayEnabled: false,
  isFocusModeEnabled: false,
};

/** No idle dialog unless there is tracked time to correct. */
export const NEW_INSTALL_IDLE_CONFIG: IdleConfig = {
  ...DEFAULT_GLOBAL_CONFIG.idle,
  isOnlyOpenIdleWhenCurrentTask: true,
};

/** Break reminders are attention-grabbing, so they stay opt-in. */
export const NEW_INSTALL_TAKE_A_BREAK_CONFIG: TakeABreakConfig = {
  ...DEFAULT_GLOBAL_CONFIG.takeABreak,
  isTakeABreakEnabled: false,
};

/** Config sections where a new install starts calmer than DEFAULT_GLOBAL_CONFIG. */
export const NEW_INSTALL_CONFIG_SECTION_KEYS = [
  'appFeatures',
  'idle',
  'takeABreak',
] as const;

export type NewInstallConfigSections = Pick<
  GlobalConfigState,
  (typeof NEW_INSTALL_CONFIG_SECTION_KEYS)[number]
>;

/**
 * Only used as the initial store state. It is never written, so nothing syncs,
 * and it never fills in missing keys of existing data (that stays
 * DEFAULT_GLOBAL_CONFIG), so existing users keep what they have.
 */
export const NEW_INSTALL_CONFIG_SECTIONS: NewInstallConfigSections = {
  appFeatures: NEW_INSTALL_APP_FEATURES,
  idle: NEW_INSTALL_IDLE_CONFIG,
  takeABreak: NEW_INSTALL_TAKE_A_BREAK_CONFIG,
};

/**
 * E2E runs that skip onboarding (the regular suite) exercise every feature and
 * keep starting with the full defaults; onboarding specs see the real
 * new-install set. Same user-agent check as StartupService. Evaluated once per
 * page load from values that never change during an install, so the initial
 * state stays stable across reloads.
 */
export const getInitialNewInstallSections = (): NewInstallConfigSections => {
  try {
    const isE2eSkippingOnboarding =
      typeof navigator !== 'undefined' &&
      navigator.userAgent.includes('PLAYWRIGHT') &&
      !!localStorage.getItem(LS.IS_SKIP_TOUR);
    return isE2eSkippingOnboarding
      ? {
          appFeatures: DEFAULT_GLOBAL_CONFIG.appFeatures,
          idle: DEFAULT_GLOBAL_CONFIG.idle,
          takeABreak: DEFAULT_GLOBAL_CONFIG.takeABreak,
        }
      : NEW_INSTALL_CONFIG_SECTIONS;
  } catch {
    // No localStorage (e.g. sandboxed frame): fall back to the new-install set.
    return NEW_INSTALL_CONFIG_SECTIONS;
  }
};

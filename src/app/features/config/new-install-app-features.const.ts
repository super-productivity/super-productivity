import { LS } from '../../core/persistence/storage-keys.const';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { AppFeaturesConfig } from './global-config.model';

/**
 * The calm feature set a brand-new install starts with: tasks, planner and time
 * tracking. More (schedule, boards, habits, ...) can be switched on under
 * Settings › App Features.
 *
 * Only used as the initial store state. It is never written, so nothing syncs,
 * and it never fills in missing keys of existing data (that stays
 * DEFAULT_GLOBAL_CONFIG.appFeatures), so existing users keep what they have.
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

/**
 * E2E runs that skip onboarding (the regular suite) exercise every feature and
 * keep starting with all of them on; onboarding specs see the real new-install
 * set. Same user-agent check as StartupService. Evaluated once per page load
 * from values that never change during an install, so the initial state stays
 * stable across reloads.
 */
export const getInitialAppFeatures = (): AppFeaturesConfig => {
  try {
    const isE2eSkippingOnboarding =
      typeof navigator !== 'undefined' &&
      navigator.userAgent.includes('PLAYWRIGHT') &&
      !!localStorage.getItem(LS.IS_SKIP_TOUR);
    return isE2eSkippingOnboarding
      ? DEFAULT_GLOBAL_CONFIG.appFeatures
      : NEW_INSTALL_APP_FEATURES;
  } catch {
    // No localStorage (e.g. sandboxed frame): fall back to the new-install set.
    return NEW_INSTALL_APP_FEATURES;
  }
};

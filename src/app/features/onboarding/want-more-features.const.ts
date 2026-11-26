import { T } from '../../t.const';
import { NAV_SECTION_ICON } from '../../core-ui/magic-side-nav/nav-section-icons.const';
import { AppFeaturesConfig } from '../config/global-config.model';

export interface WantMoreFeature {
  key: keyof AppFeaturesConfig;
  icon: string;
  /** The same label Settings › App Features uses for the switch. */
  label: string;
}

/** Features a new install starts without; the tour's last card names the ones still off. */
export const WANT_MORE_FEATURES: readonly WantMoreFeature[] = [
  {
    key: 'isBoardsEnabled',
    icon: NAV_SECTION_ICON.BOARDS,
    label: T.GCF.APP_FEATURES.BOARDS,
  },
  {
    key: 'isSchedulerEnabled',
    icon: NAV_SECTION_ICON.SCHEDULE,
    label: T.GCF.APP_FEATURES.SCHEDULE,
  },
  {
    key: 'isHabitsEnabled',
    icon: NAV_SECTION_ICON.HABITS,
    label: T.GCF.APP_FEATURES.HABITS,
  },
  {
    key: 'isFocusModeEnabled',
    icon: 'center_focus_strong',
    label: T.GCF.APP_FEATURES.FOCUS_MODE,
  },
  {
    key: 'isFinishDayEnabled',
    icon: 'done_all',
    label: T.GCF.APP_FEATURES.FINISH_DAY,
  },
  {
    key: 'isIssuesPanelEnabled',
    icon: 'webhook',
    label: T.GCF.APP_FEATURES.ISSUES_PANEL,
  },
];

export const getOffWantMoreFeatures = (
  appFeatures: AppFeaturesConfig,
): WantMoreFeature[] => WANT_MORE_FEATURES.filter((f) => !appFeatures[f.key]);

import {
  AppFeaturesConfig,
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../global-config.model';
import { T } from '../../../t.const';
import { IS_DONATION_UI_RESTRICTED } from '../../../app.constants';

/**
 * Also shown at the top of the Time Tracking tab: people who want tracking off
 * look there first, not in General › App Features (2026 survey).
 */
export const TIME_TRACKING_SWITCH_FORM_ITEM: LimitedFormlyFieldConfig<AppFeaturesConfig> =
  {
    key: 'isTimeTrackingEnabled',
    type: 'slide-toggle',
    props: {
      label: T.GCF.APP_FEATURES.TIME_TRACKING,
      description: T.GCF.APP_FEATURES.TIME_TRACKING_HINT,
      icon: 'play_arrow',
    },
  };

export const APP_FEATURES_FORM_CFG: ConfigFormSection<AppFeaturesConfig> = {
  title: T.GCF.APP_FEATURES.TITLE,
  key: 'appFeatures',
  help: T.GCF.APP_FEATURES.HELP,
  items: [
    {
      key: 'isPlannerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PLANNER,
        description: T.GCF.APP_FEATURES.PLANNER_HINT,
        icon: 'edit_calendar',
      },
    },
    {
      key: 'isSchedulerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SCHEDULE,
        description: T.GCF.APP_FEATURES.SCHEDULE_HINT,
        icon: 'schedule',
      },
    },
    {
      key: 'isBoardsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.BOARDS,
        description: T.GCF.APP_FEATURES.BOARDS_HINT,
        icon: 'grid_view',
      },
    },
    {
      key: 'isHabitsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.HABITS,
        description: T.GCF.APP_FEATURES.HABITS_HINT,
        icon: 'heart_check',
      },
    },
    TIME_TRACKING_SWITCH_FORM_ITEM,
    {
      key: 'isFocusModeEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.FOCUS_MODE,
        description: T.GCF.APP_FEATURES.FOCUS_MODE_HINT,
        icon: 'center_focus_strong',
      },
    },
    {
      key: 'isFinishDayEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.FINISH_DAY,
        description: T.GCF.APP_FEATURES.FINISH_DAY_HINT,
        icon: 'done_all',
      },
    },
    {
      key: 'isIssuesPanelEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.ISSUES_PANEL,
        description: T.GCF.APP_FEATURES.ISSUES_PANEL_HINT,
        icon: 'webhook',
      },
    },
    {
      key: 'isProjectNotesEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PROJECT_NOTES,
        description: T.GCF.APP_FEATURES.PROJECT_NOTES_HINT,
        icon: 'comment',
      },
    },
    {
      key: 'isSyncIconEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SYNC_BUTTON,
        description: T.GCF.APP_FEATURES.SYNC_BUTTON_HINT,
        icon: 'sync',
      },
    },
    {
      key: 'isSearchEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SEARCH,
        description: T.GCF.APP_FEATURES.SEARCH_HINT,
        icon: 'search',
      },
    },
    {
      key: 'isDonatePageEnabled',
      type: 'slide-toggle',
      // Donations are fully hidden on native iOS and macOS desktop builds, so
      // this toggle would be inert there — hide it to avoid a dead control.
      hideExpression: () => IS_DONATION_UI_RESTRICTED,
      templateOptions: {
        label: T.GCF.APP_FEATURES.DONATE_PAGE,
        description: T.GCF.APP_FEATURES.DONATE_PAGE_HINT,
        icon: 'favorite',
      },
    },
  ],
};

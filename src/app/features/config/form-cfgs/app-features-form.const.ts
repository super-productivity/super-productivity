import { ConfigFormSection, AppFeaturesConfig } from '../global-config.model';
import { T } from '../../../t.const';
export const APP_FEATURES_FORM_CFG: ConfigFormSection<AppFeaturesConfig> = {
  title: T.GCF.APP_FEATURES.TITLE,
  key: 'appFeatures',
  help: T.GCF.APP_FEATURES.HELP,
  items: [
    {
      key: 'isTimeTrackingEnabled',
      type: 'slide-toggle',
      props: {
        label: T.GCF.APP_FEATURES.TIME_TRACKING,
        icon: 'play_arrow',
      },
    },
    {
      key: 'isFocusModeEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.FOCUS_MODE,
        icon: 'center_focus_strong',
      },
    },
    {
      key: 'isSchedulerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SCHEDULE,
        icon: 'schedule',
      },
    },
    {
      key: 'isPlannerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PLANNER,
        icon: 'edit_calendar',
      },
    },
    {
      key: 'isBoardsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.BOARDS,
        icon: 'grid_view',
      },
    },
    {
      key: 'isScheduleDayPanelEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SCHEDULE_DAY_PANEL,
        icon: 'schedule',
      },
    },
    {
      key: 'isIssuesPanelEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.ISSUES_PANEL,
        icon: 'dashboard_customize',
      },
    },
    {
      key: 'isProjectNotesEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PROJECT_NOTES,
        icon: 'comment',
      },
    },
    {
      key: 'isSyncIconEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SYNC_BUTTON,
        icon: 'sync',
      },
    },
    {
      key: 'isSearchEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SEARCH,
        icon: 'search',
      },
    },
    {
      key: 'isDonatePageEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.DONATE_PAGE,
        icon: 'favorite',
      },
    },
    {
      key: 'isHabitsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.HABITS,
        svgIcon: 'habit',
      },
    },
    {
      key: 'isEnableUserProfiles',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.USER_PROFILES,
        description: T.GCF.APP_FEATURES.USER_PROFILES_HINT,
        icon: 'account_circle',
      },
    },
  ],
};

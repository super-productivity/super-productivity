import { ConfigFormSection, AppFeaturesConfig } from '../global-config.model';
import { T } from '../../../t.const';
export const APP_FEATURES_FORM_CFG: ConfigFormSection<AppFeaturesConfig> = {
  title: T.GCF.APP_FEATURES.TITLE,
  key: 'appFeatures',
  help: T.GCF.APP_FEATURES.HELP,
  items: [
    {
      key: 'isTimeTrackingEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.TIME_TRACKING },
    },
    {
      key: 'isFocusModeEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.FOCUS_MODE },
    },
    {
      key: 'isSchedulerEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.SCHEDULE },
    },
    {
      key: 'isPlannerEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.PLANNER },
    },
    {
      key: 'isBoardsEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.BOARDS },
    },
    {
      key: 'isScheduleDayPanelEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.SCHEDULE_DAY_PANEL },
    },
    {
      key: 'isIssuesPanelEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.ISSUES_PANEL },
    },
    {
      key: 'isProjectNotesEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.PROJECT_NOTES },
    },
    {
      key: 'isSyncIconEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.SYNC_BUTTON },
    },
    {
      key: 'isDonatePageEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.DONATE_PAGE },
    },
    {
      key: 'isHabitsEnabled',
      type: 'checkbox',
      templateOptions: { label: T.GCF.APP_FEATURES.HABITS },
    },
    {
      key: 'isEnableUserProfiles',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.APP_FEATURES.USER_PROFILES,
        description: T.GCF.APP_FEATURES.USER_PROFILES_HINT,
      },
    },
  ],
};

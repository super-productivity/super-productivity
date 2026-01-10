/* eslint-disable max-len */
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
  MiscConfig,
} from '../global-config.model';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import { AVAILABLE_CUSTOM_THEMES } from '../../../core/theme/custom-theme.service';

export const MISC_SETTINGS_FORM_CFG: ConfigFormSection<MiscConfig> = {
  title: T.GCF.MISC.TITLE,
  key: 'misc',
  help: T.GCF.MISC.HELP,
  items: [
    // {
    //   key: 'isDarkMode',
    //   type: 'checkbox',
    //   templateOptions: {
    //     label: T.GCF.MISC.IS_DARK_MODE,
    //   },
    // },
    ...((IS_ELECTRON
      ? [
          {
            key: 'isConfirmBeforeExitWithoutFinishDay',
            type: 'checkbox',
            templateOptions: {
              label: T.GCF.MISC.IS_CONFIRM_BEFORE_EXIT_WITHOUT_FINISH_DAY,
            },
          },
        ]
      : [
          {
            key: 'isConfirmBeforeExit',
            type: 'checkbox',
            templateOptions: {
              label: T.GCF.MISC.IS_CONFIRM_BEFORE_EXIT,
            },
          },
        ]) as LimitedFormlyFieldConfig<MiscConfig>[]),
    {
      key: 'isConfirmBeforeTaskDelete',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_CONFIRM_BEFORE_TASK_DELETE,
      },
    },
    {
      key: 'isAutMarkParentAsDone',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_AUTO_MARK_PARENT_AS_DONE,
      },
    },

    {
      key: 'isTurnOffMarkdown',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_TURN_OFF_MARKDOWN,
      },
    },
    {
      key: 'isAutoAddWorkedOnToToday',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_AUTO_ADD_WORKED_ON_TO_TODAY,
      },
    },
    {
      key: 'isMinimizeToTray',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_MINIMIZE_TO_TRAY,
      },
    },
    {
      key: 'isTrayShowCurrentTask',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_TRAY_SHOW_CURRENT_TASK,
      },
    },
    {
      key: 'defaultProjectId',
      type: 'project-select',
      templateOptions: {
        label: T.GCF.MISC.DEFAULT_PROJECT,
      },
    },
    {
      key: 'startOfNextDay',
      type: 'input',
      defaultValue: 0,
      templateOptions: {
        required: true,
        label: T.GCF.MISC.START_OF_NEXT_DAY,
        description: T.GCF.MISC.START_OF_NEXT_DAY_HINT,
        type: 'number',
        min: 0,
        max: 23,
      },
    },
    {
      key: 'taskNotesTpl',
      type: 'textarea',
      templateOptions: {
        rows: 5,
        label: T.GCF.MISC.TASK_NOTES_TPL,
      },
    },
    {
      key: 'isDisableAnimations',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_DISABLE_ANIMATIONS,
      },
    },
    {
      key: 'isDisableCelebration',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_DISABLE_CELEBRATION,
      },
    },
    {
      key: 'isShowProductivityTipLonger',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_SHOW_TIP_LONGER,
      },
    },
    {
      key: 'isTrayShowCurrentCountdown',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_TRAY_SHOW_CURRENT_COUNTDOWN,
      },
    },
    {
      key: 'isOverlayIndicatorEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_OVERLAY_INDICATOR_ENABLED,
      },
    },
    ...((IS_ELECTRON
      ? [
          {
            key: 'isUseCustomWindowTitleBar',
            type: 'checkbox',
            templateOptions: {
              label: T.GCF.MISC.IS_USE_CUSTOM_WINDOW_TITLE_BAR,
              description: T.GCF.MISC.IS_USE_CUSTOM_WINDOW_TITLE_BAR_HINT,
            },
          },
        ]
      : []) as LimitedFormlyFieldConfig<MiscConfig>[]),
    {
      key: 'customTheme',
      type: 'select',
      templateOptions: {
        label: T.GCF.MISC.THEME,
        options: AVAILABLE_CUSTOM_THEMES.map((theme) => ({
          label: theme.name,
          value: theme.id,
        })),
      },
    },
    {
      key: 'defaultStartPage',
      type: 'select',
      defaultValue: 0,
      templateOptions: {
        label: T.GCF.MISC.DEFAULT_START_PAGE,
        options: [
          { label: T.G.TODAY_TAG_TITLE, value: 0 },
          { label: T.G.INBOX_PROJECT_TITLE, value: 1 },
        ],
      },
    },
  ],
};

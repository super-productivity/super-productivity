import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
  MiscConfig,
} from '../global-config.model';
import { T } from '../../../t.const';
import { IS_ELECTRON, IS_GNOME_WAYLAND } from '../../../app.constants';
import { isValidSplitTime } from '../../../util/is-valid-split-time';

export const MISC_SETTINGS_FORM_CFG: ConfigFormSection<MiscConfig> = {
  title: T.GCF.MISC.TITLE,
  key: 'misc',
  help: T.GCF.MISC.HELP,
  items: [
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
      key: 'isMinimizeToTray',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_MINIMIZE_TO_TRAY,
      },
    },
    ...((IS_ELECTRON
      ? [
          {
            key: 'isLocalRestApiEnabled',
            type: 'checkbox',
            templateOptions: {
              label: T.GCF.MISC.IS_LOCAL_REST_API_ENABLED,
              description: T.GCF.MISC.IS_LOCAL_REST_API_ENABLED_HINT,
            },
          },
        ]
      : []) as LimitedFormlyFieldConfig<MiscConfig>[]),
    {
      key: 'startOfNextDayTime',
      type: 'time',
      defaultValue: '00:00',
      templateOptions: {
        required: true,
        label: T.GCF.MISC.START_OF_NEXT_DAY,
        description: T.GCF.MISC.START_OF_NEXT_DAY_HINT,
      },
      // Guard against a corrupt/legacy stored value (e.g. from an import): a
      // truthy-but-invalid time would otherwise display blank yet pass silently.
      // Mirrors the work-time fields in schedule-form.const.ts.
      validators: {
        validTimeString: (c: { value: string | undefined }) => isValidSplitTime(c.value),
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
      key: 'isVerticalActionBar',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_VERTICAL_ACTION_BAR,
        description: T.GCF.MISC.IS_VERTICAL_ACTION_BAR_HINT,
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
    ...((IS_ELECTRON && !IS_GNOME_WAYLAND
      ? [
          {
            key: 'isUseCustomWindowTitleBar',
            type: 'checkbox',
            // Display-only default: seed the checkbox so it reflects the actual
            // window state on a fresh install (the custom title bar is on by
            // default here -- this field is hidden only on GNOME+Wayland, where the
            // main process force-disables it, see the enclosing guard). formly seeds
            // the control without an initial modelChange, so nothing is persisted on load.
            // KNOWN RESIDUAL (#7891): saving any *other* Misc setting emits the
            // whole model and persists this seeded value too. We accept that over a
            // persisted DEFAULT_GLOBAL_CONFIG default, which would be pushed to
            // Electron on *every* launch and override a legacy `isUseObsidianStyleHeader`
            // choice. So a pre-2025-12 user who had disabled the old
            // header may see it re-enabled after editing Misc settings (reversible here).
            defaultValue: true,
            templateOptions: {
              label: T.GCF.MISC.IS_USE_CUSTOM_WINDOW_TITLE_BAR,
              description: T.GCF.MISC.IS_USE_CUSTOM_WINDOW_TITLE_BAR_HINT,
            },
          },
        ]
      : []) as LimitedFormlyFieldConfig<MiscConfig>[]),
    {
      key: 'defaultStartPage',
      type: 'start-page-select',
      defaultValue: 0,
      templateOptions: {
        label: T.GCF.MISC.DEFAULT_START_PAGE,
      },
    },
  ],
};

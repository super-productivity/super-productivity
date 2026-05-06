import { ConfigFormSection, FocusModeConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const FOCUS_MODE_FORM_CFG: ConfigFormSection<FocusModeConfig> = {
  title: T.GCF.FOCUS_MODE.TITLE,
  key: 'focusMode',
  help: T.GCF.FOCUS_MODE.HELP,
  items: [
    {
      key: 'autoStartFocusOnPlay',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_AUTO_START_FOCUS_ON_PLAY,
      },
    },
    {
      key: 'focusModeSound',
      type: 'select',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_FOCUS_MODE_SOUND,
        options: [
          { label: T.GCF.FOCUS_MODE.FOCUS_MODE_SOUND_OFF, value: 'off' },
          { label: T.GCF.FOCUS_MODE.FOCUS_MODE_SOUND_TICK, value: 'tick' },
          { label: T.GCF.FOCUS_MODE.FOCUS_MODE_SOUND_WHITE_NOISE, value: 'whiteNoise' },
        ],
      },
    },
    {
      type: 'collapsible',
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        {
          key: 'isPauseTrackingDuringBreak',
          type: 'checkbox',
          templateOptions: {
            label: T.GCF.FOCUS_MODE.L_PAUSE_TRACKING_DURING_BREAK,
          },
        },
        {
          key: 'isSkipPreparation',
          type: 'checkbox',
          templateOptions: {
            label: T.GCF.FOCUS_MODE.L_SKIP_PREPARATION_SCREEN,
          },
        },
        {
          key: 'isManualBreakStart',
          type: 'checkbox',
          templateOptions: {
            label: T.GCF.FOCUS_MODE.L_MANUAL_BREAK_START,
          },
        },
      ],
    },
  ],
};

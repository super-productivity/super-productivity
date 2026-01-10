import { ConfigFormSection, FocusModeConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const FOCUS_MODE_FORM_CFG: ConfigFormSection<FocusModeConfig> = {
  title: T.GCF.FOCUS_MODE.TITLE,
  key: 'focusMode',
  help: T.GCF.FOCUS_MODE.HELP,
  items: [
    {
      key: 'isSyncSessionWithTracking',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_SYNC_SESSION_WITH_TRACKING,
      },
    },
    {
      key: 'isStartInBackground',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_START_IN_BACKGROUND,
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
      key: 'isPlayTick',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_IS_PLAY_TICK,
      },
    },
    {
      key: 'isPauseTrackingDuringBreak',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE.L_PAUSE_TRACKING_DURING_BREAK,
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
};

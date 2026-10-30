import {
  ConfigFormSection,
  FocusModeLocalConfig,
  LimitedFormlyFieldConfig,
} from '../global-config.model';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import { isNotificationApiAvailable } from '../../../core/notify/browser-notification-permission';

export const FOCUS_MODE_LOCAL_FORM_CFG: ConfigFormSection<FocusModeLocalConfig> = {
  title: T.GCF.FOCUS_MODE_LOCAL.TITLE,
  key: 'focusModeLocal',
  help: T.GCF.FOCUS_MODE_LOCAL.HELP,
  items: [
    {
      key: 'isLoopBreakEndAlarm',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.FOCUS_MODE_LOCAL.L_IS_LOOP_BREAK_END_ALARM,
      },
    },
    {
      key: 'isNotifyOnSessionEnd',
      type: 'checkbox',
      // Web only: desktop flashes the window frame and native mobile is
      // excluded from this whole section (#7550). Hidden where the browser
      // has no Notification API, since the option could never work there.
      hideExpression: () => IS_ELECTRON || !isNotificationApiAvailable(),
      templateOptions: {
        label: T.GCF.FOCUS_MODE_LOCAL.L_IS_NOTIFY_ON_SESSION_END,
      },
    },
  ] as LimitedFormlyFieldConfig<FocusModeLocalConfig>[],
};

import {
  ConfigFormSection,
  FocusModeLocalConfig,
  LimitedFormlyFieldConfig,
} from '../global-config.model';
import { T } from '../../../t.const';

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
  ] as LimitedFormlyFieldConfig<FocusModeLocalConfig>[],
};

import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
  TaskWidgetConfig,
} from '../global-config.model';
import { T } from '../../../t.const';

export const TASK_WIDGET_FORM_CFG: ConfigFormSection<TaskWidgetConfig> = {
  title: T.GCF.TASK_WIDGET.TITLE,
  key: 'taskWidget',
  isElectronOnly: true,
  items: [
    {
      key: 'isEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASK_WIDGET.IS_ENABLED,
      },
    },
    {
      key: 'isAlwaysShow',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASK_WIDGET.IS_ALWAYS_SHOW,
      },
    },
    {
      key: 'opacity',
      type: 'slider',
      templateOptions: {
        type: 'number',
        min: 10,
        max: 100,
        label: T.GCF.TASK_WIDGET.OPACITY,
      },
    },
  ] as LimitedFormlyFieldConfig<TaskWidgetConfig>[],
};

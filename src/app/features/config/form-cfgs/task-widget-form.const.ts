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
    {
      key: 'autoHideToEdge',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASK_WIDGET.AUTO_HIDE_TO_EDGE,
      },
    },
    {
      key: 'edge',
      type: 'select',
      templateOptions: {
        label: T.GCF.TASK_WIDGET.EDGE,
        options: [
          {
            label: T.GCF.TASK_WIDGET.EDGE_RIGHT,
            value: 'right',
          },
          {
            label: T.GCF.TASK_WIDGET.EDGE_LEFT,
            value: 'left',
          },
          {
            label: T.GCF.TASK_WIDGET.EDGE_TOP,
            value: 'top',
          },
          {
            label: T.GCF.TASK_WIDGET.EDGE_BOTTOM,
            value: 'bottom',
          },
        ],
      },
    },
    {
      key: 'expandedWidth',
      type: 'slider',
      templateOptions: {
        type: 'number',
        min: 300,
        max: 560,
        label: T.GCF.TASK_WIDGET.EXPANDED_WIDTH,
      },
    },
    {
      key: 'collapsedWidth',
      type: 'slider',
      templateOptions: {
        type: 'number',
        min: 18,
        max: 60,
        label: T.GCF.TASK_WIDGET.COLLAPSED_WIDTH,
      },
    },
  ] as LimitedFormlyFieldConfig<TaskWidgetConfig>[],
};

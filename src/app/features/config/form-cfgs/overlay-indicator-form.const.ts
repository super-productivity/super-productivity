import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
  OverlayIndicatorConfig,
} from '../global-config.model';
import { T } from '../../../t.const';

export const OVERLAY_INDICATOR_FORM_CFG: ConfigFormSection<OverlayIndicatorConfig> = {
  title: T.GCF.OVERLAY_INDICATOR.TITLE,
  key: 'overlayIndicator',
  isElectronOnly: true,
  items: [
    {
      key: 'isEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.OVERLAY_INDICATOR.IS_ENABLED,
      },
    },
    {
      key: 'isAlwaysShow',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.OVERLAY_INDICATOR.IS_ALWAYS_SHOW,
      },
    },
    {
      key: 'opacity',
      type: 'slider',
      templateOptions: {
        type: 'number',
        min: 10,
        max: 100,
        label: T.GCF.OVERLAY_INDICATOR.OPACITY,
      },
    },
  ] as LimitedFormlyFieldConfig<OverlayIndicatorConfig>[],
};

import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
  MenuBarConfig,
} from '../global-config.model';
import { T } from '../../../t.const';

export const MENU_BAR_FORM_CFG: ConfigFormSection<MenuBarConfig> = {
  title: T.GCF.MENU_BAR.TITLE,
  key: 'menuBar',
  isElectronOnly: true,
  isMacOnly: true,
  items: [
    {
      key: 'showDockIcon',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MENU_BAR.SHOW_DOCK_ICON,
        description: T.GCF.MENU_BAR.SHOW_DOCK_ICON_DESCRIPTION,
      },
    },
  ] as LimitedFormlyFieldConfig<MenuBarConfig>[],
};

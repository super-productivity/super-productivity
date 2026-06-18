import { LimitedFormlyFieldConfig } from '../global-config.model';
import { PluginShortcutCfg } from '../../../plugins/plugin-api.model';
import { T } from '../../../t.const';
import { KeyboardConfig } from '@sp/keyboard-config';

export const createPluginShortcutFormItems = (
  shortcuts: PluginShortcutCfg[],
): LimitedFormlyFieldConfig<KeyboardConfig>[] => {
  if (shortcuts.length === 0) {
    return [];
  }

  const items: LimitedFormlyFieldConfig<KeyboardConfig>[] = [
    {
      type: 'tpl',
      className: 'tpl',
      templateOptions: {
        tag: 'h3',
        class: 'sub-section-heading',
        text: T.GCF.KEYBOARD.PLUGIN_SHORTCUTS || 'Plugin Shortcuts',
      },
    },
  ];

  for (const shortcut of shortcuts) {
    items.push({
      key: `plugin_${shortcut.pluginId}:${shortcut.id}`,
      type: 'keyboard',
      templateOptions: {
        label: `${shortcut.label} (${shortcut.pluginId})`,
      },
    });
  }

  return items;
};

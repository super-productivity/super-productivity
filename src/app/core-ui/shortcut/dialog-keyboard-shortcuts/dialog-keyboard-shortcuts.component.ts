import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { KEYBOARD_SETTINGS_FORM_CFG } from '../../../features/config/form-cfgs/keyboard-form.const';
import { createPluginShortcutFormItems } from '../../../features/config/form-cfgs/plugin-keyboard-shortcuts';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';

interface ShortcutRow {
  heading?: string;
  label?: string;
  combo?: string;
}

@Component({
  selector: 'dialog-keyboard-shortcuts',
  templateUrl: './dialog-keyboard-shortcuts.component.html',
  styleUrls: ['./dialog-keyboard-shortcuts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    TranslatePipe,
  ],
})
export class DialogKeyboardShortcutsComponent {
  private _configService = inject(GlobalConfigService);
  private _pluginBridgeService = inject(PluginBridgeService);

  T: typeof T = T;

  // Reuses the settings form config as the single source of labels and grouping,
  // so a new shortcut shows up here without touching this component.
  readonly rows = computed<ShortcutRow[]>(() => {
    const keyboard = this._configService.cfg()?.keyboard as
      | Record<string, string | null | undefined>
      | undefined;
    if (!keyboard) {
      return [];
    }

    const items = [
      ...(KEYBOARD_SETTINGS_FORM_CFG.items ?? []),
      // plugin shortcuts only exist on the config page's runtime copy of the form
      ...createPluginShortcutFormItems(this._pluginBridgeService.shortcuts()),
    ];

    const rows: ShortcutRow[] = [];
    for (const item of items) {
      if (item.type === 'tpl') {
        // only headings start a group – the explanatory paragraphs are not shown here
        if (item.templateOptions?.['tag'] === 'h3') {
          rows.push({ heading: item.templateOptions?.['text'] as string | undefined });
        }
      } else if (item.key) {
        const combo = keyboard[item.key as string];
        if (combo) {
          rows.push({ label: item.templateOptions?.label, combo });
        }
      }
    }

    // Drop a heading when every shortcut below it is unbound.
    return rows.filter((row, i) => !row.heading || !!rows[i + 1]?.combo);
  });
}

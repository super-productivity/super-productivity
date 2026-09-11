import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DialogKeyboardShortcutsComponent } from './dialog-keyboard-shortcuts.component';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginShortcutCfg } from '../../../plugins/plugin-api.model';
import { T } from '../../../t.const';

describe('DialogKeyboardShortcutsComponent', () => {
  const setup = (
    keyboard: Record<string, string | null>,
    shortcuts: PluginShortcutCfg[] = [],
  ): DialogKeyboardShortcutsComponent => {
    TestBed.configureTestingModule({
      providers: [
        { provide: GlobalConfigService, useValue: { cfg: signal({ keyboard }) } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal(shortcuts) } },
      ],
    });
    return TestBed.runInInjectionContext(() => new DialogKeyboardShortcutsComponent());
  };

  it('should use the h3 heading for the task section and skip the info paragraph', () => {
    const rows = setup({ taskEditTitle: 'Enter' }).rows();

    expect(rows).toEqual([
      { heading: T.GCF.KEYBOARD.TASK_SHORTCUTS },
      { label: T.GCF.KEYBOARD.TASK_EDIT_TITLE, combo: 'Enter' },
    ]);
  });

  it('should include the showHelp shortcut', () => {
    const rows = setup({ showHelp: '?' }).rows();

    expect(rows).toContain({ label: T.GCF.KEYBOARD.SHOW_HELP, combo: '?' });
  });

  it('should include registered plugin shortcuts', () => {
    const pluginKey = 'plugin_my-plugin:doIt';
    const rows = setup({ [pluginKey]: 'Ctrl+P' }, [
      { pluginId: 'my-plugin', id: 'doIt', label: 'Do it', onExec: () => undefined },
    ]).rows();

    expect(rows).toEqual([
      { heading: T.GCF.KEYBOARD.PLUGIN_SHORTCUTS },
      { label: 'Do it (my-plugin)', combo: 'Ctrl+P' },
    ]);
  });
});

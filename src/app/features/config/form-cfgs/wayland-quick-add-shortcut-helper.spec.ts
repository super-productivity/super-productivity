import {
  QUICK_ADD_SYSTEM_SHORTCUT_COMMAND,
  createWaylandQuickAddShortcutHelperItems,
} from './wayland-quick-add-shortcut-helper';
import { T } from '../../../t.const';

describe('wayland quick-add shortcut helper form config', () => {
  it('creates a guided setup block for GNOME Wayland Quick Add shortcuts', () => {
    const items = createWaylandQuickAddShortcutHelperItems();

    expect(QUICK_ADD_SYSTEM_SHORTCUT_COMMAND).toBe(
      'xdg-open superproductivity://quick-add',
    );
    expect(items.length).toBe(4);
    expect(items[0]).toEqual(
      jasmine.objectContaining({
        type: 'tpl',
        className: 'tpl',
        templateOptions: jasmine.objectContaining({
          text: T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_HELP,
          class: 'wayland-shortcut-helper',
        }),
      }),
    );
    expect(items.slice(1).map((item) => item.templateOptions?.text)).toEqual([
      T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_COPY_COMMAND,
      T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_OPEN_SETTINGS,
      T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_TEST,
    ]);
    expect(items.every((item) => typeof item.hideExpression === 'function')).toBeTrue();
  });
});

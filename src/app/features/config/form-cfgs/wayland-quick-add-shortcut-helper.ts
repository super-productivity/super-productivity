import { KeyboardConfig } from '@sp/keyboard-config';
import { IS_ELECTRON } from '../../../app.constants';
import { T } from '../../../t.const';
import { LimitedFormlyFieldConfig } from '../global-config.model';

export const QUICK_ADD_SYSTEM_SHORTCUT_COMMAND = 'xdg-open superproductivity://quick-add';

const hideUnlessGnomeWayland = (): boolean =>
  !IS_ELECTRON || !window.ea?.isGnomeWayland?.();

export const createWaylandQuickAddShortcutHelperItems =
  (): LimitedFormlyFieldConfig<KeyboardConfig>[] => [
    {
      type: 'tpl',
      className: 'tpl',
      hideExpression: hideUnlessGnomeWayland,
      templateOptions: {
        tag: 'div',
        class: 'wayland-shortcut-helper',
        text: T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_HELP,
      },
    },
    {
      type: 'btn',
      className: 'wayland-shortcut-helper-btn',
      hideExpression: hideUnlessGnomeWayland,
      templateOptions: {
        text: T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_COPY_COMMAND,
        btnStyle: 'stroked',
        onClick: async () => {
          await copyTextToClipboard(QUICK_ADD_SYSTEM_SHORTCUT_COMMAND);
        },
      },
    },
    {
      type: 'btn',
      className: 'wayland-shortcut-helper-btn',
      hideExpression: hideUnlessGnomeWayland,
      templateOptions: {
        text: T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_OPEN_SETTINGS,
        btnStyle: 'stroked',
        onClick: () => {
          window.ea.openSystemKeyboardSettings();
        },
      },
    },
    {
      type: 'btn',
      className: 'wayland-shortcut-helper-btn',
      hideExpression: hideUnlessGnomeWayland,
      templateOptions: {
        text: T.GCF.KEYBOARD.WAYLAND_QUICK_ADD_TEST,
        btnStyle: 'stroked',
        onClick: () => {
          window.ea.showQuickAdd();
        },
      },
    },
  ];

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.append(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
};

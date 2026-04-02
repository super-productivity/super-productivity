import { globalShortcut, ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { KeyboardConfig } from '../../src/app/features/config/keyboard-config.model';
import { getWin } from '../main-window';
import { toggleTaskWidgetVisibility } from '../task-widget/task-widget';
import { showOrFocus } from '../various-shared';
import { errorHandlerWithFrontendInform } from '../error-handler-with-frontend-inform';

export const initGlobalShortcutsIpc = (): void => {
  ipcMain.on(IPC.REGISTER_GLOBAL_SHORTCUTS_EVENT, (ev, cfg) => {
    registerShowAppShortCuts(cfg);
  });
};

const registerShowAppShortCuts = (cfg: KeyboardConfig): void => {
  // unregister all previous
  globalShortcut.unregisterAll();
  const GLOBAL_KEY_CFG_KEYS: (keyof KeyboardConfig)[] = [
    'globalShowHide',
    'globalToggleTaskStart',
    'globalAddNote',
    'globalAddTask',
    'globalToggleTaskWidget',
  ];

  if (cfg) {
    const mainWin = getWin();
    Object.keys(cfg)
      .filter((key: string) => GLOBAL_KEY_CFG_KEYS.includes(key as keyof KeyboardConfig))
      .forEach((key: string) => {
        let actionFn: () => void;
        const shortcut = cfg[key as keyof KeyboardConfig];

        switch (key) {
          case 'globalShowHide':
            actionFn = () => {
              if (mainWin.isFocused()) {
                // we need to blur the window for windows
                mainWin.blur();
                mainWin.hide();
              } else {
                showOrFocus(mainWin);
              }
            };
            break;

          case 'globalToggleTaskStart':
            actionFn = () => {
              mainWin.webContents.send(IPC.TASK_TOGGLE_START);
            };
            break;

          case 'globalAddNote':
            actionFn = () => {
              showOrFocus(mainWin);
              mainWin.webContents.send(IPC.ADD_NOTE);
            };
            break;

          case 'globalAddTask':
            actionFn = () => {
              showOrFocus(mainWin);
              // NOTE: delay slightly to make sure app is ready
              mainWin.webContents.send(IPC.SHOW_ADD_TASK_BAR);
            };
            break;

          case 'globalToggleTaskWidget':
            actionFn = () => {
              toggleTaskWidgetVisibility();
            };
            break;

          default:
            actionFn = () => undefined;
        }

        if (shortcut && shortcut.length > 0) {
          try {
            const ret = globalShortcut.register(shortcut, actionFn) as unknown;
            if (!ret) {
              errorHandlerWithFrontendInform(
                'Global Shortcut registration failed: ' + shortcut,
                shortcut,
              );
            }
          } catch (e) {
            errorHandlerWithFrontendInform(
              'Global Shortcut registration failed: ' + shortcut,
              { e, shortcut },
            );
          }
        }
      });
  }
};

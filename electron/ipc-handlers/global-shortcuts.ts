import { globalShortcut, ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { KeyboardConfig } from '../../src/app/features/config/keyboard-config.model';
import { getWin } from '../main-window';
import { errorHandlerWithFrontendInform } from '../error-handler-with-frontend-inform';
import { executeDesktopCommand } from '../desktop-command-executor';
import { showOrFocus } from '../various-shared';

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
              executeDesktopCommand({ type: 'toggle-visibility' }, mainWin, {
                showOrFocus,
              });
            };
            break;

          case 'globalToggleTaskStart':
            actionFn = () => {
              executeDesktopCommand({ type: 'toggle-time-tracking' }, mainWin, {
                showOrFocus,
              });
            };
            break;

          case 'globalAddNote':
            actionFn = () => {
              executeDesktopCommand({ type: 'new-note' }, mainWin, { showOrFocus });
            };
            break;

          case 'globalAddTask':
            actionFn = () => {
              executeDesktopCommand({ type: 'new-task' }, mainWin, { showOrFocus });
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

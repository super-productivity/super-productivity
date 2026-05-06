import { globalShortcut, ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { KeyboardConfig } from '../../src/app/features/config/keyboard-config.model';
import { getWin } from '../main-window';
import { showOrFocus } from '../various-shared';
import { ensureIndicator } from '../indicator';
import { getIsMinimizeToTray } from '../shared-state';
import { IS_MAC } from '../common.const';
import { errorHandlerWithFrontendInform } from '../error-handler-with-frontend-inform';

export const initGlobalShortcutsIpc = (): void => {
  ipcMain.on(IPC.REGISTER_GLOBAL_SHORTCUTS_EVENT, (_ev, cfg) => {
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
              if (!mainWin.isFocused()) {
                showOrFocus(mainWin);
                return;
              }
              // Hide strategy differs by platform:
              // - macOS: the dock icon always remains after hide(), so the
              //   window stays reachable without any tray. Match the native
              //   Cmd+H gesture users expect from a "show/hide" shortcut.
              // - Windows/Linux: hide() removes the taskbar entry. Without a
              //   visible tray icon the window becomes unreachable (see #7282).
              //   Only hide to tray when minimize-to-tray is enabled AND the
              //   tray was successfully (re)created; otherwise minimize so a
              //   taskbar handle remains as a safety net. blur() is a Windows
              //   focus workaround (electron#20464) and a no-op elsewhere.
              if (IS_MAC) {
                mainWin.hide();
              } else if (getIsMinimizeToTray() && ensureIndicator()) {
                mainWin.blur();
                mainWin.hide();
              } else {
                mainWin.minimize();
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

import type { BaseWindow, MenuItemConstructorOptions } from 'electron';

// macOS-only application menu template (built by createMenu in
// main-window.ts). Kept as a pure function so menu.test.cjs can assert on
// the template without loading main-window's import graph.
export const createMenuTemplate = ({
  onCloseWindow,
  onQuit,
}: {
  // receives the key window: the app-wide accelerator also fires while
  // e.g. the break blocker or task widget is focused, and the handler
  // must decide based on which window that is
  onCloseWindow: (focusedWindow: BaseWindow | undefined) => void;
  onQuit: () => void;
}): MenuItemConstructorOptions[] => [
  {
    label: 'Super Productivity',
    submenu: [
      { role: 'about', label: 'About Super Productivity' },
      { type: 'separator' },
      { role: 'hide', label: 'Hide Super Productivity' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CmdOrCtrl+Q',
        click: onQuit,
      },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  },
  {
    label: 'Window',
    submenu: [
      {
        // NOT role 'close': close would run the quit path when
        // minimize-to-tray is off, and as a raw accelerator on the focused
        // window it could destroy the task widget or the break blocker.
        label: 'Close Window',
        accelerator: 'CmdOrCtrl+W',
        click: (_menuItem, focusedWindow) => onCloseWindow(focusedWindow),
      },
    ],
  },
];

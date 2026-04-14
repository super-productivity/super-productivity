import { log } from 'electron-log/main';
import { DesktopCommand } from './desktop-command';
import { IPC } from './shared-with-frontend/ipc-events.const';

export interface DesktopCommandWindow {
  blur(): void;
  hide(): void;
  isFocused(): boolean;
  webContents: {
    send(channel: IPC, ...args: unknown[]): void;
  };
}

export interface DesktopCommandDeps {
  showOrFocus: (mainWin: DesktopCommandWindow) => void;
}

const pendingDesktopCommands: DesktopCommand[] = [];

export const executeDesktopCommand = (
  command: DesktopCommand,
  mainWin: DesktopCommandWindow,
  { showOrFocus }: DesktopCommandDeps,
): void => {
  switch (command.type) {
    case 'toggle-visibility':
      if (mainWin.isFocused()) {
        mainWin.blur();
        mainWin.hide();
      } else {
        showOrFocus(mainWin);
      }
      return;

    case 'toggle-time-tracking':
      mainWin.webContents.send(IPC.TASK_TOGGLE_START);
      return;

    case 'new-note':
      showOrFocus(mainWin);
      mainWin.webContents.send(IPC.ADD_NOTE);
      return;

    case 'new-task':
      showOrFocus(mainWin);
      mainWin.webContents.send(IPC.SHOW_ADD_TASK_BAR);
      return;

    case 'create-task':
      showOrFocus(mainWin);
      mainWin.webContents.send(IPC.ADD_TASK_FROM_APP_URI, { title: command.title });
      return;
  }
};

export const queueDesktopCommand = (command: DesktopCommand): void => {
  pendingDesktopCommands.push(command);
};

export const flushPendingDesktopCommands = ({
  getMainWindow,
  isAppReady,
  showOrFocus,
}: {
  getMainWindow: () => DesktopCommandWindow | null | undefined;
  isAppReady: () => boolean;
  showOrFocus: (mainWin: DesktopCommandWindow) => void;
}): void => {
  const mainWin = getMainWindow();
  if (!mainWin || !isAppReady() || pendingDesktopCommands.length === 0) {
    return;
  }

  log(`Processing ${pendingDesktopCommands.length} pending desktop command(s)`);
  const commands = [...pendingDesktopCommands];
  pendingDesktopCommands.length = 0;
  commands.forEach((command) => executeDesktopCommand(command, mainWin, { showOrFocus }));
};

export const queueOrExecuteDesktopCommand = ({
  command,
  getMainWindow,
  isAppReady,
  showOrFocus,
}: {
  command: DesktopCommand;
  getMainWindow: () => DesktopCommandWindow | null | undefined;
  isAppReady: () => boolean;
  showOrFocus: (mainWin: DesktopCommandWindow) => void;
}): void => {
  const mainWin = getMainWindow();
  if (!mainWin || !isAppReady()) {
    queueDesktopCommand(command);
    return;
  }

  executeDesktopCommand(command, mainWin, { showOrFocus });
};

export const getPendingDesktopCommandCount = (): number => pendingDesktopCommands.length;

export const resetPendingDesktopCommands = (): void => {
  pendingDesktopCommands.length = 0;
};

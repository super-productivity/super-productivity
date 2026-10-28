import { App, BrowserWindow, Menu } from 'electron';
import { PROTOCOL_PREFIX, processProtocolUrl } from './protocol-handler';
import { getDistChannel } from './shared-with-frontend/get-dist-channel';

// The desktop counterpart of the iOS quick actions and Android launcher shortcuts
// (#10971): the same three entries, each opening its `superproductivity://` action.
// Static English labels, as on mobile.
const SHORTCUTS = [
  { title: 'New task', url: `${PROTOCOL_PREFIX}add-task` },
  { title: 'Today', url: `${PROTOCOL_PREFIX}today` },
  { title: 'Inbox', url: `${PROTOCOL_PREFIX}inbox` },
];

export const initLauncherShortcuts = (
  app: App,
  getMainWindow: () => BrowserWindow | null,
): void => {
  if (process.platform === 'darwin') {
    app.dock?.setMenu(
      Menu.buildFromTemplate(
        SHORTCUTS.map(({ title, url }) => ({
          label: title,
          click: () => processProtocolUrl(url, getMainWindow()),
        })),
      ),
    );
    return;
  }

  // A jump list task starts the exe with the URL as its argument: the single-instance
  // lock hands it to the running app (`second-instance`), a cold start reads it from
  // argv. Installer builds only: the Store and portable builds run from versioned or
  // temporary paths that a saved task would outlive (cf. the tray GUID in indicator.ts).
  if (app.isPackaged && getDistChannel() === 'win-nsis') {
    app.setUserTasks(
      SHORTCUTS.map(({ title, url }) => ({
        program: process.execPath,
        arguments: url,
        iconPath: process.execPath,
        iconIndex: 0,
        title,
        description: title,
      })),
    );
  }
};

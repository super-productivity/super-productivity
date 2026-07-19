import { ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { executeJiraRequest } from '../jira';
import { JiraCapabilityRegistry } from '../jira-capability';
import {
  clearRequestHeadersForImages,
  setupRequestHeadersForImages,
} from '../jira-image-auth';

const capabilityRegistry = new JiraCapabilityRegistry();

export const initJiraIpc = (): void => {
  ipcMain.handle(IPC.JIRA_REGISTER_CAPABILITY, (event) => {
    // NOTE: this main-frame check is a secondary guard, not the real boundary:
    // same-origin plugin iframes can reach window.top.ea, so their IPC also
    // arrives with senderFrame === mainFrame. The actual protection is that
    // trusted startup code consumes the one-shot capability before any plugin
    // code runs (see JiraElectronBridgeService.initialize / StartupService).
    if (event.senderFrame !== event.sender.mainFrame) {
      return null;
    }
    const token = capabilityRegistry.register(event.senderFrame);
    // A fresh document just claimed the capability — drop any stale image auth
    // left over from the previous renderer document.
    clearRequestHeadersForImages();
    return token;
  });

  ipcMain.handle(IPC.JIRA_SETUP_IMG_HEADERS, (event, envelope: unknown) => {
    setupRequestHeadersForImages(capabilityRegistry.unwrap(event.senderFrame, envelope));
  });

  ipcMain.handle(IPC.JIRA_CLEAR_IMG_HEADERS, (event, envelope: unknown) => {
    capabilityRegistry.unwrap(event.senderFrame, envelope);
    clearRequestHeadersForImages();
  });

  ipcMain.handle(IPC.JIRA_MAKE_REQUEST_EVENT, (event, envelope: unknown) =>
    executeJiraRequest(capabilityRegistry.unwrap(event.senderFrame, envelope)),
  );
};

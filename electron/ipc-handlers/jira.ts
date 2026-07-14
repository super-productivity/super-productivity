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
    if (event.senderFrame !== event.sender.mainFrame) {
      return null;
    }
    return capabilityRegistry.register(event.senderFrame);
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

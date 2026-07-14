import { ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { executeJiraRequest, setupRequestHeadersForImages } from '../jira';

export const initJiraIpc = (): void => {
  ipcMain.handle(IPC.JIRA_SETUP_IMG_HEADERS, (_event, config: unknown) => {
    setupRequestHeadersForImages(config);
  });

  ipcMain.handle(IPC.JIRA_MAKE_REQUEST_EVENT, (_event, request: unknown) =>
    executeJiraRequest(request),
  );
};

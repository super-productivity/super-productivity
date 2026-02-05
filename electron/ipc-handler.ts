import { log } from 'electron-log/main';
import { pluginNodeExecutor } from './plugin-node-executor';
import {
  initAppControlIpc,
  initAppDataIpc,
  initExecIpc,
  initGlobalShortcutsIpc,
  initJiraIpc,
  initSystemIpc,
} from './ipc-handlers';
import { initClipboardImageHandlers } from './clipboard-image-handler';

export const initIpcInterfaces = (): void => {
  // Initialize plugin node executor (registers IPC handlers)
  // This is needed for plugins with nodeExecution permission
  // The constructor automatically sets up the IPC handlers
  log('Initializing plugin node executor');
  if (!pluginNodeExecutor) {
    log('Warning: Plugin node executor failed to initialize');
  }

  initAppDataIpc();
  initAppControlIpc();
  initSystemIpc();
  initJiraIpc();
  initGlobalShortcutsIpc();
  initExecIpc();
  initClipboardImageHandlers();
};

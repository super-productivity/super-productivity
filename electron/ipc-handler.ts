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
import { initLocalRestApi } from './local-rest-api';

export const initIpcInterfaces = (): void => {
  // Register the fail-closed nodeExecution IPC handler while plugin Node.js
  // execution is disabled for security hardening.
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
  initLocalRestApi();
};

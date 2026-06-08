import { ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';

const NODE_EXECUTION_DISABLED_ERROR =
  'Plugin Node.js execution is disabled for security hardening.';

class PluginNodeExecutor {
  constructor() {
    this.setupIpcHandler();
  }

  private setupIpcHandler(): void {
    // Fail closed until nodeExecution can be authorized from main-process-owned
    // plugin/consent state instead of renderer-controlled IPC calls.
    ipcMain.handle(IPC.PLUGIN_EXEC_NODE_SCRIPT, async () => {
      throw new Error(NODE_EXECUTION_DISABLED_ERROR);
    });
  }
}

export const pluginNodeExecutor = new PluginNodeExecutor();

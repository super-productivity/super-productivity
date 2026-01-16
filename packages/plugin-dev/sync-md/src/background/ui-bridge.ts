import { loadLocalConfig, LocalUserCfg, saveLocalConfig } from './local-config';
import { initSyncManager } from './sync/sync-manager';

interface UiBridgeConfig {
  getConfig: () => LocalUserCfg | null;
  saveConfig: (config: LocalUserCfg) => void;
  triggerSync: () => void;
}

interface PluginMessage {
  type: string;
  config?: LocalUserCfg;
}

const bridgeConfig: UiBridgeConfig = {
  getConfig: () => loadLocalConfig(),
  saveConfig: (newConfig: LocalUserCfg) => {
    console.log('[sync-md] Saving config:', newConfig);
    saveLocalConfig(newConfig);
    console.log('[sync-md] Config saved to localStorage');
    // Re-initialize sync when config changes
    if (newConfig.filePath) {
      console.log(
        '[sync-md] Initializing sync manager with config, filePath:',
        newConfig.filePath,
      );
      try {
        initSyncManager(newConfig);
        console.log('[sync-md] Sync manager initialized successfully');
      } catch (error) {
        console.error('[sync-md] Failed to initialize sync manager:', error);

        // Show error but DON'T throw - keep plugin running
        PluginAPI.showSnack({
          msg: 'Sync.md: Failed to initialize. Check file path and permissions.',
          type: 'ERROR',
        });
      }
    }
  },
  triggerSync: () => {
    const config = loadLocalConfig();
    if (config?.filePath) {
      // Transform config to match sync-manager expectations
      initSyncManager(config);
    }
  },
};

export const initUiBridge = (): void => {
  console.log(
    '[sync-md] initUiBridge called, PluginAPI.onMessage available:',
    !!PluginAPI.onMessage,
  );

  // Handle messages from UI
  if (PluginAPI.onMessage) {
    console.log('[sync-md] Registering message handler');
    PluginAPI.onMessage(async (message: PluginMessage) => {
      console.log('[sync-md] Received message:', message);

      switch (message.type) {
        case 'getProjects':
          try {
            const projects = await PluginAPI.getAllProjects();
            return { success: true, projects };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }

        case 'getConfig':
          try {
            const config = bridgeConfig.getConfig();
            return { success: true, config };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }

        case 'saveConfig':
          try {
            if (message.config) {
              bridgeConfig.saveConfig(message.config);
              return { success: true };
            }
            return { success: false, error: 'No config provided' };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }

        case 'syncNow':
          try {
            const config = bridgeConfig.getConfig();
            if (config?.filePath) {
              bridgeConfig.triggerSync();
              return { success: true };
            }
            return { success: false, error: 'Sync not enabled' };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }

        default:
          return { success: false, error: 'Unknown message type' };
      }
    });
  }
};

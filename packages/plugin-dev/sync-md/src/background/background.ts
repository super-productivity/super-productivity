import { initSyncManager } from './sync/sync-manager';
import { initUiBridge } from './ui-bridge';
import { loadLocalConfig } from './local-config';
import { log } from '../shared/logger';

// Initialize UI bridge to handle messages
initUiBridge();
log.log('UI bridge initialized');

// Load saved config from local storage and start sync if enabled
PluginAPI.onReady(() => {
  const config = loadLocalConfig();
  log.log('Loaded config:', config);

  if (config?.filePath) {
    // Transform config to match sync-manager expectations
    initSyncManager(config);
  }
});

import type { PluginAPI } from '@super-productivity/plugin-api';

declare const PluginAPI: PluginAPI;

const init = (): void => {
  PluginAPI.log.info('markdown-notes: ready');
};

if (PluginAPI.onReady) {
  PluginAPI.onReady(init);
} else {
  init();
}

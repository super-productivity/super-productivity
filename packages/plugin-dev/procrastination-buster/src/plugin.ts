// Procrastination Buster Plugin for Super Productivity
import { PluginAPI } from '@super-productivity/plugin-api';

declare const plugin: PluginAPI;

// Plugin initialization
plugin.log.info('Procrastination Buster plugin initialized');

// Note: Side panel button is automatically registered via manifest.json
// with "sidePanel": true, so no manual registration needed

// i18n support - handle translation requests from iframe
if (plugin.onMessage) {
  plugin.onMessage(async (message: any) => {
    switch (message?.type) {
      case 'translate':
        return await plugin.translate(message.payload.key, message.payload.params);
      case 'getCurrentLanguage':
        return await plugin.getCurrentLanguage();
      default:
        return { error: 'Unknown message type' };
    }
  });
}

// Listen for language changes and notify iframe
plugin.registerHook('languageChange', (language: string) => {
  plugin.log.info('[plugin.ts] Language changed to:', language);
  // Notify the iframe about language change
  const iframe = document.querySelector('iframe[data-plugin-iframe]');
  plugin.log.info('[plugin.ts] Found iframe:', !!iframe);
  if (iframe && (iframe as HTMLIFrameElement).contentWindow) {
    plugin.log.info('[plugin.ts] Sending languageChanged message to iframe');
    (iframe as HTMLIFrameElement).contentWindow!.postMessage(
      { type: 'languageChanged', language },
      '*',
    );
  }
});

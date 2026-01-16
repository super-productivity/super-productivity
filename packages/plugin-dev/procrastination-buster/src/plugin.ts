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
    plugin.log.info('[plugin.ts] Received message:', message);
    switch (message?.type) {
      case 'translate':
        const translation = await plugin.translate(
          message.payload.key,
          message.payload.params,
        );
        plugin.log.info('[plugin.ts] Returning translation:', translation);
        return translation;
      case 'getCurrentLanguage':
        const lang = await plugin.getCurrentLanguage();
        plugin.log.info('[plugin.ts] Returning language:', lang);
        return lang;
      default:
        plugin.log.info('[plugin.ts] Unknown message type:', message?.type);
        return { error: 'Unknown message type' };
    }
  });
}

// Listen for language changes and notify iframe
plugin.registerHook('languageChange', (language: string) => {
  // Notify the iframe about language change
  const iframe = document.querySelector('iframe[data-plugin-iframe]');
  if (iframe && (iframe as HTMLIFrameElement).contentWindow) {
    (iframe as HTMLIFrameElement).contentWindow!.postMessage(
      { type: 'languageChanged', language },
      '*',
    );
  }
});

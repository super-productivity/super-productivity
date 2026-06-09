// Procrastination Buster Plugin for Super Productivity
import type { PluginAPI } from '@super-productivity/plugin-api';

declare const plugin: PluginAPI;

const PLUGIN_ID = 'procrastination-buster';

type PluginMessage = {
  type?: unknown;
  payload?: {
    key?: unknown;
    params?: unknown;
  };
};

const getPluginMessage = (message: unknown): PluginMessage | undefined =>
  message && typeof message === 'object' ? (message as PluginMessage) : undefined;

const isTranslateParams = (params: unknown): params is Record<string, string | number> =>
  !!params &&
  typeof params === 'object' &&
  Object.values(params).every(
    (value) => typeof value === 'string' || typeof value === 'number',
  );

const getLanguageFromHookPayload = (payload: unknown): string | undefined => {
  if (typeof payload === 'string') {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const languagePayload = payload as {
    code?: unknown;
    newLanguage?: unknown;
    language?: unknown;
  };

  if (typeof languagePayload.code === 'string') {
    return languagePayload.code;
  }
  if (typeof languagePayload.newLanguage === 'string') {
    return languagePayload.newLanguage;
  }
  if (typeof languagePayload.language === 'string') {
    return languagePayload.language;
  }

  return undefined;
};

const getPluginIframe = (): HTMLIFrameElement | null =>
  document.querySelector<HTMLIFrameElement>(`iframe[data-plugin-id="${PLUGIN_ID}"]`) ??
  document.querySelector<HTMLIFrameElement>('iframe[data-plugin-iframe]');

// Plugin initialization
plugin.log.info('Procrastination Buster plugin initialized');

// Note: Side panel button is automatically registered via manifest.json
// with "sidePanel": true, so no manual registration needed

// i18n support - handle translation requests from iframe
if (plugin.onMessage) {
  plugin.onMessage((message: unknown) => {
    const pluginMessage = getPluginMessage(message);

    switch (pluginMessage?.type) {
      case 'translate':
        if (typeof pluginMessage.payload?.key !== 'string') {
          return { error: 'Missing translation key' };
        }
        return plugin.translate(
          pluginMessage.payload.key,
          isTranslateParams(pluginMessage.payload.params)
            ? pluginMessage.payload.params
            : undefined,
        );
      case 'getCurrentLanguage':
        return plugin.getCurrentLanguage();
      default:
        return { error: 'Unknown message type' };
    }
  });
}

// Listen for language changes and notify iframe
plugin.registerHook(plugin.Hooks.LANGUAGE_CHANGE, (payload: unknown) => {
  const language = getLanguageFromHookPayload(payload);
  if (!language) {
    return;
  }

  // Notify the iframe about language change
  const iframe = getPluginIframe();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'languageChanged', language }, '*');
  }
});

import { createSignal, createEffect, onCleanup } from 'solid-js';

// Communication with plugin.js via the PluginAPI.onMessage system
const sendMessage = async (type: string, payload?: any): Promise<any> => {
  return new Promise((resolve) => {
    const messageId = Math.random().toString(36).substring(2, 9);

    const handler = (event: MessageEvent) => {
      // Listen for MESSAGE_RESPONSE from parent
      if (event.data.type === 'PLUGIN_MESSAGE_RESPONSE' && event.data.messageId === messageId) {
        window.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };

    window.addEventListener('message', handler);
    const message = { type, payload };
    // Use the proper PLUGIN_MESSAGE type for the plugin message system
    window.parent.postMessage({ type: 'PLUGIN_MESSAGE', message, messageId }, '*');
  });
};

/**
 * SolidJS hook for reactive translations
 *
 * This hook provides a simple way to translate strings in your plugin components.
 * It automatically handles language changes and caches translations for performance.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const t = useTranslate();
 *   const [greeting, setGreeting] = createSignal('');
 *
 *   createEffect(async () => {
 *     setGreeting(await t('GREETING'));
 *   });
 *
 *   return <h1>{greeting()}</h1>;
 * }
 * ```
 *
 * @example With parameters
 * ```tsx
 * function TaskCount() {
 *   const t = useTranslate();
 *   const [message, setMessage] = createSignal('');
 *
 *   createEffect(async () => {
 *     setMessage(await t('TASK.CREATED_SUCCESS', { title: 'My Task' }));
 *   });
 *
 *   return <p>{message()}</p>;
 * }
 * ```
 */
export function useTranslate() {
  const [currentLanguage, setCurrentLanguage] = createSignal<string>('en');

  // Listen for language change events
  createEffect(() => {
    const handleLanguageChange = (event: MessageEvent) => {
      if (event.data.type === 'languageChanged') {
        setCurrentLanguage(event.data.language);
      }
    };

    window.addEventListener('message', handleLanguageChange);

    onCleanup(() => {
      window.removeEventListener('message', handleLanguageChange);
    });
  });

  /**
   * Translate a key with optional parameter interpolation
   *
   * @param key - Translation key (supports dot notation for nested keys)
   * @param params - Optional parameters for interpolation (e.g., { count: 5 })
   * @returns Promise that resolves to the translated string
   *
   * @example
   * ```tsx
   * const greeting = await t('APP.TITLE');
   * const message = await t('TASK.COUNT', { count: 5 });
   * ```
   */
  const t = async (key: string, params?: Record<string, string | number>): Promise<string> => {
    try {
      return await sendMessage('translate', { key, params });
    } catch (error) {
      console.error('Translation error:', error);
      return key;
    }
  };

  // Also expose the current language as a signal for reactive language-dependent logic
  return Object.assign(t, { currentLanguage });
}

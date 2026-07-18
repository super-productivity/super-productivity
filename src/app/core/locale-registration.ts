import { registerLocaleData } from '@angular/common';
import { Log } from './log';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LOCALE_DATA,
  NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS,
} from './locale.constants';

/**
 * Registers the statically imported default locale data (en-GB under the bare
 * 'en' id). Must run before Angular's first render: LocaleDatePipe is pure, so
 * a date rendered earlier would cache Angular's built-in en-US resolution for
 * the session. main.ts calls this at module scope, before bootstrapApplication.
 */
export const registerDefaultLocale = (): void => {
  registerLocaleData(DEFAULT_LOCALE_DATA, DEFAULT_LANGUAGE);
};

/**
 * Loads and registers the regional locale data matching the browser's own
 * locale, when it's one of the navigator-only variants (en-AU, en-CA, … — see
 * NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS). Awaited by an app initializer so the
 * data is registered before first render; otherwise a pure LocaleDatePipe
 * caches the en-GB parent format for the session.
 *
 * Never rejects: a failed chunk load logs and falls back to default-locale
 * rendering instead of blocking bootstrap.
 */
export const registerNavigatorLocale = async (
  navLanguage: string = navigator.language,
): Promise<void> => {
  const key = navLanguage.toLowerCase().replace(/-/g, '_');
  const load = NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS[key];
  if (!load) {
    return;
  }
  try {
    const m = await load();
    // No explicit id: these data files self-report ids matching their keys
    // (asserted in locale.constants.spec.ts), so the self-id is typo-proof.
    registerLocaleData(m.default);
  } catch (e) {
    Log.err(`Failed to load locale ${key}`, e);
  }
};

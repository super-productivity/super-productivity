import { registerLocaleData } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { Log } from './log';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LOCALE_DATA,
  NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS,
} from './locale.constants';

/**
 * Upper bound on how long bootstrap waits for the regional locale chunk. On
 * timeout we render with the default locale — exactly the behavior before this
 * registration existed — rather than hold up first render on a stalled network.
 */
const LOCALE_LOAD_TIMEOUT_MS = 1500;

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
 * The default argument reads the browser locale through the exact same call
 * `DateTimeFormatService` resolves the pipe's locale with
 * (`getBrowserCultureLang()` → `navigator.languages[0]`). Reading
 * `navigator.language` here instead would let the two disagree, and we would
 * then register data for a locale the pipe never asks for.
 *
 * Never rejects and gives up after {@link LOCALE_LOAD_TIMEOUT_MS}: a failed or
 * stalled chunk load degrades to default-locale rendering instead of failing or
 * holding up bootstrap.
 */
export const registerNavigatorLocale = async (
  navLanguage: string | undefined = TranslateService.getBrowserCultureLang(),
): Promise<void> => {
  const key = navLanguage?.toLowerCase().replace(/-/g, '_');
  const load = key ? NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS[key] : undefined;
  if (!load) {
    return;
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.race consumes a late rejection from load(), so a chunk that fails
    // after the timeout won this race cannot surface as an unhandled rejection.
    const m = await Promise.race([
      load(),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), LOCALE_LOAD_TIMEOUT_MS);
      }),
    ]);
    if (!m) {
      Log.err(`Timed out loading locale ${key}`);
      return;
    }
    // No explicit id: these data files self-report ids matching their keys
    // (asserted in locale.constants.spec.ts), so the self-id is typo-proof.
    registerLocaleData(m.default);
  } catch (e) {
    Log.err(`Failed to load locale ${key}`, e);
  } finally {
    clearTimeout(timeoutId);
  }
};

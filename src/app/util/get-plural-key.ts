import { getValue, TranslateService, TranslateStore } from '@ngx-translate/core';

/**
 * Select the correct translation key for a plural form using CLDR rules.
 *
 * Uses the browser's Intl.PluralRules API to determine the plural category
 * (zero/one/two/few/many/other) for the current locale and count.
 *
 * Convention: translation keys use dot-separated CLDR category suffixes,
 * e.g., KEY_PREFIX.ONE, KEY_PREFIX.OTHER, KEY_PREFIX.FEW, KEY_PREFIX.MANY.
 *
 * Falls back to KEY_PREFIX.OTHER if the specific category key is not defined
 * in the current locale. Checks the current locale's translations directly
 * (via TranslateStore) to avoid the fallback language masking missing keys.
 */
export const getPluralKey = (
  translateService: TranslateService,
  translateStore: TranslateStore,
  count: number,
  keyPrefix: string,
): string => {
  const locale = translateService.currentLang || translateService.defaultLang || 'en';
  const category = new Intl.PluralRules(locale).select(count).toUpperCase();
  const specificKey = `${keyPrefix}.${category}`;

  const localeTranslations = translateStore.getTranslations(locale);
  if (typeof getValue(localeTranslations, specificKey) === 'string') {
    return specificKey;
  }

  return `${keyPrefix}.OTHER`;
};

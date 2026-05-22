import localeEnGB from '@angular/common/locales/en-GB';

/**
 * All of available app languages
 * ! Should use lowercase
 */
export enum LanguageCode {
  ar = 'ar',
  de = 'de',
  cs = 'cs',
  en = 'en',
  es = 'es',
  fa = 'fa',
  fi = 'fi',
  fr = 'fr',
  hr = 'hr',
  id = 'id',
  it = 'it',
  ja = 'ja',
  ko = 'ko',
  nl = 'nl',
  nb = 'nb',
  pl = 'pl',
  pt = 'pt',
  pt_br = 'pt-br', // Portuguese (Brazil)
  ru = 'ru',
  sk = 'sk',
  sv = 'sv',
  tr = 'tr',
  uk = 'uk',
  zh = 'zh', // Chinese (Simplified)
  zh_tw = 'zh-tw', // Chinese (Traditional)
  ro = 'ro',
  ro_md = 'ro-md', // Romanian (Moldova)
  vi = 'vi', // Vietnamese
}

/**
 * We're assuming that the other language speakers are likely to speak English
 * and as English offers most likely the best experience, we use it as default
 */
export const AUTO_SWITCH_LNGS: LanguageCode[] = [
  LanguageCode.zh,
  LanguageCode.zh_tw,
  LanguageCode.ar,
  LanguageCode.fa,
  LanguageCode.ja,
  LanguageCode.ko,
  LanguageCode.ru,
  LanguageCode.tr,
];

export const RTL_LANGUAGES: LanguageCode[] = [LanguageCode.ar, LanguageCode.fa];

/**
 * This is a specification used to date-time localization
 * ! Should use lowercase
 */
export const DateTimeLocales = {
  ...LanguageCode,
  en_gb: `${LanguageCode.en}-gb`,
  en_us: `${LanguageCode.en}-us`,
  tr_tr: `${LanguageCode.tr}-tr`,
  de_de: `${LanguageCode.de}-de`,
  fr_fr: `${LanguageCode.fr}-fr`,
  es_es: `${LanguageCode.es}-es`,
  it_it: `${LanguageCode.it}-it`,
  ru_ru: `${LanguageCode.ru}-ru`,
  zh_cn: `${LanguageCode.zh}-cn`,
  ja_jp: `${LanguageCode.ja}-jp`,
  ko_kr: `${LanguageCode.ko}-kr`,
  cs_cz: `${LanguageCode.cs}-cz`,
  sk_sk: `${LanguageCode.sk}-sk`,
  uk_ua: `${LanguageCode.uk}-ua`,
  ro_ro: `${LanguageCode.ro}-ro`,
  ro_md: `${LanguageCode.ro}-md`,
  pl_pl: `${LanguageCode.pl}-pl`,
} as const;

export type DateTimeLocale = (typeof DateTimeLocales)[keyof typeof DateTimeLocales];

/**
 * Maps locale keys to dynamic import functions for lazy loading.
 * Only the default locale (en-GB) is statically imported; all others
 * are loaded on demand to reduce the initial bundle size.
 */
export const LocaleImportFns: Record<
  keyof typeof DateTimeLocales,
  () => Promise<{ default: unknown }>
> = {
  en: () => Promise.resolve({ default: localeEnGB }),
  en_gb: () => Promise.resolve({ default: localeEnGB }),
  en_us: () => import('@angular/common/locales/en'),
  tr_tr: () => import('@angular/common/locales/tr'),
  de_de: () => import('@angular/common/locales/de'),
  de: () => import('@angular/common/locales/de'),
  fr_fr: () => import('@angular/common/locales/fr'),
  es_es: () => import('@angular/common/locales/es'),
  es: () => import('@angular/common/locales/es'),
  it_it: () => import('@angular/common/locales/it'),
  pt_br: () => import('@angular/common/locales/pt'),
  ru_ru: () => import('@angular/common/locales/ru'),
  ru: () => import('@angular/common/locales/ru'),
  zh_cn: () => import('@angular/common/locales/zh'),
  ja_jp: () => import('@angular/common/locales/ja'),
  ja: () => import('@angular/common/locales/ja'),
  ko_kr: () => import('@angular/common/locales/ko'),
  ko: () => import('@angular/common/locales/ko'),
  zh_tw: () => import('@angular/common/locales/zh'),
  ar: () => import('@angular/common/locales/ar'),
  cs_cz: () => import('@angular/common/locales/cs'),
  cs: () => import('@angular/common/locales/cs'),
  fa: () => import('@angular/common/locales/fa'),
  fi: () => import('@angular/common/locales/fi'),
  fr: () => import('@angular/common/locales/fr'),
  id: () => import('@angular/common/locales/id'),
  it: () => import('@angular/common/locales/it'),
  pl_pl: () => import('@angular/common/locales/pl'),
  pl: () => import('@angular/common/locales/pl'),
  pt: () => import('@angular/common/locales/pt'),
  nl: () => import('@angular/common/locales/nl'),
  nb: () => import('@angular/common/locales/nb'),
  hr: () => import('@angular/common/locales/hr'),
  uk_ua: () => import('@angular/common/locales/uk'),
  uk: () => import('@angular/common/locales/uk'),
  sk_sk: () => import('@angular/common/locales/sk'),
  sk: () => import('@angular/common/locales/sk'),
  sv: () => import('@angular/common/locales/sv'),
  tr: () => import('@angular/common/locales/tr'),
  zh: () => import('@angular/common/locales/zh'),
  ro: () => import('@angular/common/locales/ro'),
  ro_ro: () => import('@angular/common/locales/ro'),
  ro_md: () => import('@angular/common/locales/ro-MD'),
  vi: () => import('@angular/common/locales/vi'),
};

/**
 * Angular locale data for common `navigator.language` region variants that
 * are NOT user-selectable in the dropdown — they back the "System default"
 * option (see {@link getSystemDefaultLocale}). English regions need their own
 * data because Angular's `DatePipe` would otherwise fall back through `en`
 * (registered as en-GB) and render 24h for en-AU/en-CA/en-NZ users.
 *
 * Kept separate from {@link DateTimeLocales} so the `DateTimeLocale` union
 * stays limited to genuinely selectable locales. Scope is English regions
 * only: English is the most common navigator.language and the one language
 * whose bare code is mis-pinned to en-GB. Other regional variants (es-MX,
 * fr-CA, …) still fall back to their bare language code — not always
 * region-correct, but out of scope for this fix.
 *
 * Keys are snake_case; `registerLocaleData` normalises them to BCP-47
 * (`en_au` -> `en-au`), matching `navigator.language.toLowerCase()`.
 */
export const NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS: Record<
  string,
  () => Promise<{ default: unknown }>
> = {
  en_au: () => import('@angular/common/locales/en-AU'),
  en_ca: () => import('@angular/common/locales/en-CA'),
  en_ie: () => import('@angular/common/locales/en-IE'),
  en_in: () => import('@angular/common/locales/en-IN'),
  en_nz: () => import('@angular/common/locales/en-NZ'),
  en_ph: () => import('@angular/common/locales/en-PH'),
  en_sg: () => import('@angular/common/locales/en-SG'),
  en_za: () => import('@angular/common/locales/en-ZA'),
};

/** Default locale data, statically imported for instant availability */
export const DEFAULT_LOCALE_DATA = localeEnGB;

export const DEFAULT_LANGUAGE = LanguageCode.en;
export const DEFAULT_LOCALE = DateTimeLocales.en_gb;
export const DEFAULT_FIRST_DAY_OF_WEEK = 1; // monday

/**
 * Resolves the OS / browser locale for the "System default" option, as a
 * lowercase BCP-47 tag suitable for `Intl` and the Material `DateAdapter`.
 * Falls back to {@link DEFAULT_LOCALE} when `navigator.language` is
 * unavailable (SSR / unit tests) or not a valid locale tag.
 *
 * The return type is `string` (not `DateTimeLocale`) because the value is an
 * arbitrary BCP-47 tag — only a subset matches the curated union.
 */
export const getSystemDefaultLocale = (): string => {
  if (typeof navigator === 'undefined' || !navigator.language) {
    return DEFAULT_LOCALE;
  }
  const lang = navigator.language.toLowerCase();
  try {
    // Reject structurally invalid tags (e.g. the POSIX 'C' locale) before
    // they reach Intl / DatePipe / the Material DateAdapter.
    Intl.getCanonicalLocales(lang);
  } catch {
    return DEFAULT_LOCALE;
  }
  // A region-less 'en' is ambiguous: Intl formats it with 12h conventions
  // while the app registers Angular's 'en' data as en-GB (24h). Pin it to
  // the explicit default so the Intl- and DatePipe-based paths agree.
  return lang === LanguageCode.en ? DEFAULT_LOCALE : lang;
};

import localeEnUS from '@angular/common/locales/en';
import localeEnGB from '@angular/common/locales/en-GB';
import localeEs from '@angular/common/locales/es';
import localeDe from '@angular/common/locales/de';
import localeAr from '@angular/common/locales/ar';
import localeCs from '@angular/common/locales/cs';
import localeFa from '@angular/common/locales/fa';
import localeFr from '@angular/common/locales/fr';
import localeJa from '@angular/common/locales/ja';
import localeKo from '@angular/common/locales/ko';
import localeRu from '@angular/common/locales/ru';
import localeSk from '@angular/common/locales/sk';
import localeTr from '@angular/common/locales/tr';
import localeZh from '@angular/common/locales/zh';
import localeIt from '@angular/common/locales/it';
import localePl from '@angular/common/locales/pl';
import localePt from '@angular/common/locales/pt';
import localeNl from '@angular/common/locales/nl';
import localeNb from '@angular/common/locales/nb';
import localeHr from '@angular/common/locales/hr';
import localeUk from '@angular/common/locales/uk';
import localeId from '@angular/common/locales/id';
import localeFi from '@angular/common/locales/fi';
import localeSv from '@angular/common/locales/sv';
import localeRo from '@angular/common/locales/ro';
import localeRoMD from '@angular/common/locales/ro-MD';

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
} as const;

export type DateTimeLocale = (typeof DateTimeLocales)[keyof typeof DateTimeLocales];

export const LocalesImports: Record<keyof typeof DateTimeLocales, unknown> = {
  en: localeEnGB,
  en_gb: localeEnGB,
  en_us: localeEnUS,
  tr_tr: localeTr,
  de_de: localeDe,
  de: localeDe,
  fr_fr: localeFr,
  es_es: localeEs,
  es: localeEs,
  it_it: localeIt,
  pt_br: localePt,
  ru_ru: localeRu,
  ru: localeRu,
  zh_cn: localeZh,
  ja_jp: localeJa,
  ja: localeJa,
  ko_kr: localeKo,
  ko: localeKo,
  zh_tw: localeZh,
  ar: localeAr,
  cs_cz: localeCs,
  cs: localeCs,
  fa: localeFa,
  fi: localeFi,
  fr: localeFr,
  id: localeId,
  it: localeIt,
  pl: localePl,
  pt: localePt,
  nl: localeNl,
  nb: localeNb,
  hr: localeHr,
  uk_ua: localeUk,
  uk: localeUk,
  sk_sk: localeSk,
  sk: localeSk,
  sv: localeSv,
  tr: localeTr,
  zh: localeZh,
  ro: localeRo,
  ro_ro: localeRo,
  ro_md: localeRoMD,
};

export const DEFAULT_LANGUAGE = LanguageCode.en;
export const DEFAULT_LOCALE = DateTimeLocales.en_gb;
export const DEFAULT_FIRST_DAY_OF_WEEK = 1; // monday

import { INVOICE_LANGUAGES, invoiceLabels, invoiceLanguage } from './invoice-labels';

// The app's languages (src/app/core/locale.constants.ts).
const APP_LANGUAGES = [
  'ar',
  'cs',
  'de',
  'en',
  'es',
  'fa',
  'fi',
  'fr',
  'hr',
  'id',
  'it',
  'ja',
  'ko',
  'nb',
  'nl',
  'pl',
  'pt',
  'pt-br',
  'ro',
  'ro-md',
  'ru',
  'sk',
  'sv',
  'tr',
  'uk',
  'vi',
  'zh',
  'zh-tw',
];

describe('INVOICE_LANGUAGES', () => {
  it('covers every app language', () => {
    expect(Object.keys(INVOICE_LANGUAGES).sort()).toEqual([...APP_LANGUAGES].sort());
  });

  it('has a name and all 13 labels, none empty, in every language', () => {
    for (const { name, labels } of Object.values(INVOICE_LANGUAGES)) {
      expect(name).toBeTruthy();
      expect(Object.keys(labels)).toHaveLength(13);
      expect(Object.values(labels).every((v) => typeof v === 'string' && v.trim())).toBe(
        true,
      );
    }
  });
});

describe('invoiceLanguage', () => {
  it('matches exactly, then by base language, else English', () => {
    expect(invoiceLanguage('zh-TW')).toBe('zh-tw');
    expect(invoiceLanguage('de-AT')).toBe('de');
    expect(invoiceLanguage('xx')).toBe('en');
    expect(invoiceLanguage(undefined)).toBe('en');
  });

  it('gives the labels of that language', () => {
    expect(invoiceLabels('de-DE').invoice).toBe('Rechnung');
  });
});

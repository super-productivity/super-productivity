import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { getPluralKey } from './get-plural-key';

describe('getPluralKey', () => {
  const setup = (
    currentLang: string,
    translations: Record<string, unknown>,
  ): { ts: TranslateService; store: TranslateStore } => ({
    ts: {
      currentLang,
      defaultLang: 'en',
    } as unknown as TranslateService,
    store: {
      getTranslations: (lang: string) => translations[lang] || {},
    } as unknown as TranslateStore,
  });

  describe('English locale', () => {
    const translations = {
      en: {
        PDS: {
          ARCHIVED_TASKS: {
            ONE: '{{count}} task has been archived',
            OTHER: '{{count}} tasks have been archived',
          },
        },
      },
    };

    it('should return ONE key for count=1', () => {
      const { ts, store } = setup('en', translations);
      expect(getPluralKey(ts, store, 1, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.ONE',
      );
    });

    it('should return OTHER key for count=0', () => {
      const { ts, store } = setup('en', translations);
      expect(getPluralKey(ts, store, 0, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.OTHER',
      );
    });

    it('should return OTHER key for count=2', () => {
      const { ts, store } = setup('en', translations);
      expect(getPluralKey(ts, store, 2, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.OTHER',
      );
    });
  });

  describe('fallback to OTHER when category key is missing', () => {
    it('should fall back to OTHER when FEW key is missing for Polish', () => {
      const { ts, store } = setup('pl', {
        pl: {
          PDS: { ARCHIVED_TASKS: { ONE: 'Polish one', OTHER: 'Polish other' } },
        },
      });
      // Polish: select(2) = "few", but FEW key doesn't exist
      expect(getPluralKey(ts, store, 2, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.OTHER',
      );
    });

    it('should fall back to OTHER when MANY key is missing for Russian', () => {
      const { ts, store } = setup('ru', {
        ru: {
          PDS: { ARCHIVED_TASKS: { ONE: 'Russian one', OTHER: 'Russian other' } },
        },
      });
      // Russian: select(5) = "many", but MANY key doesn't exist
      expect(getPluralKey(ts, store, 5, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.OTHER',
      );
    });
  });

  describe('uses CLDR category when key exists', () => {
    it('should return FEW key for Polish when it exists', () => {
      const { ts, store } = setup('pl', {
        pl: {
          PDS: {
            ARCHIVED_TASKS: {
              ONE: 'Polish one',
              FEW: 'Polish few',
              MANY: 'Polish many',
              OTHER: 'Polish other',
            },
          },
        },
      });
      expect(getPluralKey(ts, store, 2, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.FEW',
      );
    });

    it('should return MANY key for Russian when it exists', () => {
      const { ts, store } = setup('ru', {
        ru: {
          PDS: {
            ARCHIVED_TASKS: {
              ONE: 'Russian one',
              FEW: 'Russian few',
              MANY: 'Russian many',
              OTHER: 'Russian other',
            },
          },
        },
      });
      expect(getPluralKey(ts, store, 5, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.MANY',
      );
    });
  });

  describe('does not use fallback language', () => {
    it('should NOT use English ONE key when Russian locale lacks it', () => {
      const { ts, store } = setup('ru', {
        en: {
          F: {
            CALENDARS: {
              BANNER: { TXT_MULTIPLE: { ONE: 'English one', OTHER: 'English other' } },
            },
          },
        },
        ru: {
          F: {
            CALENDARS: {
              BANNER: { TXT_MULTIPLE: { OTHER: 'Russian other' } },
            },
          },
        },
      });
      // Russian: select(1) = "one", but ru doesn't have ONE key
      // Should fall back to ru's OTHER, NOT use en's ONE
      expect(getPluralKey(ts, store, 1, 'F.CALENDARS.BANNER.TXT_MULTIPLE')).toBe(
        'F.CALENDARS.BANNER.TXT_MULTIPLE.OTHER',
      );
    });
  });

  describe('edge cases', () => {
    it('should fall back to OTHER when translations are undefined', () => {
      const { ts, store } = setup('xx', {});
      expect(getPluralKey(ts, store, 1, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.OTHER',
      );
    });

    it('should use defaultLang when currentLang is empty', () => {
      const { ts, store } = setup('', {
        en: {
          PDS: {
            ARCHIVED_TASKS: { ONE: 'English one', OTHER: 'English other' },
          },
        },
      });
      expect(getPluralKey(ts, store, 1, 'PDS.ARCHIVED_TASKS')).toBe(
        'PDS.ARCHIVED_TASKS.ONE',
      );
    });
  });
});

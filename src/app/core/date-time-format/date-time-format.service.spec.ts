import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService } from './date-time-format.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import {
  DateTimeLocales,
  DEFAULT_FIRST_DAY_OF_WEEK,
  LanguageCode,
} from 'src/app/core/locale.constants';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { CustomDateAdapter } from './custom-date-adapter';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../language/language.service';

describe('DateTimeFormatService', () => {
  let service: DateTimeFormatService;
  let dateAdapter: DateAdapter<Date>;

  const createServiceWithFirstDayOfWeek = (
    firstDayOfWeek: number | null | undefined,
  ): DateTimeFormatService => {
    const config: GlobalConfigState = {
      ...DEFAULT_GLOBAL_CONFIG,
      localization: {
        ...DEFAULT_GLOBAL_CONFIG.localization,
        firstDayOfWeek,
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MatNativeDateModule],
      providers: [
        DateTimeFormatService,
        { provide: DateAdapter, useClass: CustomDateAdapter },
        {
          provide: TranslateService,
          useValue: { currentLang: 'en', defaultLang: 'en' },
        },
        provideMockStore({
          initialState: {
            globalConfig: config,
          },
        }),
      ],
    });

    dateAdapter = TestBed.inject(DateAdapter);
    return TestBed.inject(DateTimeFormatService);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MatNativeDateModule],
      providers: [
        DateTimeFormatService,
        { provide: DateAdapter, useClass: CustomDateAdapter },
        {
          provide: TranslateService,
          useValue: { currentLang: 'en', defaultLang: 'en' },
        },
        provideMockStore({
          initialState: {
            globalConfig: DEFAULT_GLOBAL_CONFIG,
          },
        }),
      ],
    });
    dateAdapter = TestBed.inject(DateAdapter);
    service = TestBed.inject(DateTimeFormatService);
  });

  it('should use system locale by default', () => {
    const testTime = new Date(2024, 0, 15, 14, 30).getTime();
    const formatted = service.formatTime(testTime);

    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('should detect 24-hour format for appropriate locales', () => {
    const is24Hour = service.is24HourFormat();
    expect(typeof is24Hour).toBe('boolean');
  });

  it('should maintain consistent behavior', () => {
    const firstCheck = service.is24HourFormat();
    const secondCheck = service.is24HourFormat();
    expect(firstCheck).toBe(secondCheck);

    const firstFormat = service.dateFormat();
    const secondFormat = service.dateFormat();
    expect(firstFormat.raw).toBe(secondFormat.raw);

    const testTime = new Date(2024, 0, 15, 14, 30).getTime();
    const formatted1 = service.formatTime(testTime);
    const formatted2 = service.formatTime(testTime);
    expect(formatted1).toBe(formatted2);
  });

  describe('firstDayOfWeek configuration', () => {
    it('should set Sunday (0) as first day of week when configured', () => {
      createServiceWithFirstDayOfWeek(0);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(0);
    });

    it('should set Monday (1) as first day of week when configured', () => {
      createServiceWithFirstDayOfWeek(1);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(1);
    });

    it('should set Tuesday (2) as first day of week when configured', () => {
      createServiceWithFirstDayOfWeek(2);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(2);
    });

    it('should set Saturday (6) as first day of week when configured', () => {
      createServiceWithFirstDayOfWeek(6);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(6);
    });

    it('should default to Monday when firstDayOfWeek is null', () => {
      createServiceWithFirstDayOfWeek(null);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(DEFAULT_FIRST_DAY_OF_WEEK);
    });

    it('should default to Monday when firstDayOfWeek is undefined', () => {
      createServiceWithFirstDayOfWeek(undefined);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(DEFAULT_FIRST_DAY_OF_WEEK);
    });

    it('should default to Monday when firstDayOfWeek is negative', () => {
      createServiceWithFirstDayOfWeek(-1);
      TestBed.flushEffects();

      expect(dateAdapter.getFirstDayOfWeek()).toBe(DEFAULT_FIRST_DAY_OF_WEEK);
    });
  });

  describe('parseStringToDate', () => {
    it('should set time to 00:00:00 for valid date strings', () => {
      const testDate = service.parseStringToDate('31/12/2000', 'dd/MM/yyyy');
      expect(testDate?.getHours()).toBe(0);
      expect(testDate?.getMinutes()).toBe(0);
      expect(testDate?.getSeconds()).toBe(0);
      expect(testDate?.getMilliseconds()).toBe(0);
    });

    it('should return null for invalid date strings', () => {
      const result1 = service.parseStringToDate('invalid', 'dd/MM/yyyy');
      expect(result1).toBeNull();

      const result2 = service.parseStringToDate('/12/2000', 'dd/MM/yyyy');
      expect(result2).toBeNull();

      const result3 = service.parseStringToDate('0/12/2000', 'dd/MM/yyyy');
      expect(result3).toBeNull();

      const result4 = service.parseStringToDate('30/02/2000', 'dd/MM/yyyy');
      expect(result4).toBeNull();

      const result5 = service.parseStringToDate('31/12/202', 'dd/MM/yyyy');
      expect(result5).toBeNull();
    });

    it('should return null for invalid date format', () => {
      const result1 = service.parseStringToDate('31/12/2000', '/MM/yyyy');
      expect(result1).toBeNull();

      const result2 = service.parseStringToDate('31/12/2000', 'xx/MM/yyyy');
      expect(result2).toBeNull();
    });

    it('should handle different separators', () => {
      const formatEn = service.parseStringToDate('31/12/2000', 'dd/MM/yyyy');
      expect(formatEn?.getDate()).toBe(31);
      expect(formatEn?.getMonth()).toBe(11);
      expect(formatEn?.getFullYear()).toBe(2000);

      const formatEnUs = service.parseStringToDate('12/31/2000', 'MM/dd/yyyy');
      expect(formatEnUs?.getDate()).toBe(31);
      expect(formatEnUs?.getMonth()).toBe(11);
      expect(formatEnUs?.getFullYear()).toBe(2000);

      const formatRU = service.parseStringToDate('31.12.2000', 'dd.MM.yyyy');
      expect(formatRU?.getDate()).toBe(31);
      expect(formatRU?.getMonth()).toBe(11);
      expect(formatRU?.getFullYear()).toBe(2000);

      const formatKr = service.parseStringToDate('2000. 12. 31.', 'yyyy. MM. dd.');
      expect(formatKr?.getDate()).toBe(31);
      expect(formatKr?.getMonth()).toBe(11);
      expect(formatKr?.getFullYear()).toBe(2000);
    });
  });

  describe('formatDate', () => {
    it('should correctly format date', () => {
      const testDate = new Date(2000, 11, 31);

      const formattedEnUs = service.formatDate(testDate, DateTimeLocales.en_us);
      expect(formattedEnUs).toBe('12/31/2000');

      const formattedEnGb = service.formatDate(testDate, DateTimeLocales.en_gb);
      expect(formattedEnGb).toBe('31/12/2000');

      const formattedRuRu = service.formatDate(testDate, DateTimeLocales.ru_ru);
      expect(formattedRuRu).toBe('31.12.2000');

      const formattedKoKr = service.formatDate(testDate, DateTimeLocales.ko_kr);
      expect(formattedKoKr).toBe('2000. 12. 31.');

      // ISO 8601 option (mapped to the Swedish locale) must produce
      // YYYY-MM-DD, see #6484
      const formattedIso = service.formatDate(testDate, DateTimeLocales.sv);
      expect(formattedIso).toBe('2000-12-31');
    });
  });

  describe('formatTime', () => {
    it('should correctly format time', () => {
      const testTime = new Date(2000, 11, 31, 14, 0, 0).getTime();

      const formattedEnUs = service.formatTime(testTime, DateTimeLocales.en_us);
      expect(formattedEnUs).toBe('2:00 PM');

      const formattedEnGb = service.formatTime(testTime, DateTimeLocales.en_gb);
      expect(formattedEnGb).toBe('14:00');

      const formattedRuRu = service.formatTime(testTime, DateTimeLocales.ru_ru);
      expect(formattedRuRu).toBe('14:00');

      const formattedKoKr = service.formatTime(testTime, DateTimeLocales.ko_kr);
      expect(formattedKoKr).toBe('오후 2:00');

      // ISO 8601 option (mapped to the Swedish locale) must use the 24-hour
      // clock with a colon, see #6484
      const formattedIso = service.formatTime(testTime, DateTimeLocales.sv);
      expect(formattedIso).toBe('14:00');
    });
  });

  describe('ISO 8601 locale (sv, #6484)', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [MatNativeDateModule],
        providers: [
          DateTimeFormatService,
          { provide: DateAdapter, useClass: CustomDateAdapter },
          {
            provide: TranslateService,
            useValue: { currentLang: 'en', defaultLang: 'en' },
          },
          provideMockStore({
            initialState: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                localization: {
                  ...DEFAULT_GLOBAL_CONFIG.localization,
                  dateTimeLocale: DateTimeLocales.sv,
                },
              },
            },
          }),
        ],
      });
      service = TestBed.inject(DateTimeFormatService);
    });

    it('detects a year-first YYYY-MM-DD format and 24h clock', () => {
      expect(service.dateFormat().raw).toBe('yyyy-MM-dd');
      expect(service.is24HourFormat()).toBe(true);
    });

    it('round-trips an ISO date string through the detected format', () => {
      const parsed = service.parseStringToDate('2026-02-12', service.dateFormat().raw);
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(1);
      expect(parsed?.getDate()).toBe(12);
    });

    it('updates text labels when the UI language changes without changing ISO formats', () => {
      expect(service.currentLocale()).toBe(DateTimeLocales.sv);
      expect(service.isoTextLocale()).toBe('en');

      service.setUiLanguage('de');
      TestBed.flushEffects();

      expect(service.isoTextLocale()).toBe('de');
      expect(service.currentLocale()).toBe(DateTimeLocales.sv);
      expect(service.dateFormat().raw).toBe('yyyy-MM-dd');
      expect(service.is24HourFormat()).toBe(true);
    });

    it('exposes the UI language as textLocale, tracking language changes', () => {
      // Spelled-out weekday/month names must not render in Swedish under the
      // sv sentinel (#8987 follow-up); textLocale resolves to the UI language.
      expect(service.textLocale()).toBe('en');

      service.setUiLanguage('de');
      TestBed.flushEffects();

      expect(service.textLocale()).toBe('de');
    });
  });

  describe('dateTimeLocale config fallback', () => {
    let mockStore: MockStore;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [MatNativeDateModule],
        providers: [
          DateTimeFormatService,
          { provide: DateAdapter, useClass: CustomDateAdapter },
          {
            provide: TranslateService,
            useValue: {
              currentLang: 'fr',
              defaultLang: 'en',
            },
          },
          provideMockStore({
            initialState: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                localization: {
                  ...DEFAULT_GLOBAL_CONFIG.localization,
                  dateTimeLocale: 'de',
                },
              },
            },
          }),
        ],
      });
      mockStore = TestBed.inject(MockStore);
      service = TestBed.inject(DateTimeFormatService);
    });

    it('should fall back to active UI language when dateTimeLocale is removed', () => {
      // Initially, it should use the configured override 'de'
      TestBed.flushEffects();
      expect(service.currentLocale()).toBe('de');

      // Now update config to remove the override (setting it to null)
      mockStore.setState({
        globalConfig: {
          ...DEFAULT_GLOBAL_CONFIG,
          localization: {
            ...DEFAULT_GLOBAL_CONFIG.localization,
            dateTimeLocale: null,
          },
        },
      });
      TestBed.flushEffects();

      // It should fall back to currentLang 'fr'
      expect(service.currentLocale()).toBe('fr');
    });
  });

  describe('explicit dateTimeLocale override (#8565)', () => {
    const TIME_FORMAT: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: 'numeric',
    };
    // 14:00 — renders "14:00" in 24h locales, "2:00 PM" in 12h (en-US) locales.
    // The adapter time path (matTimepicker) uses the adapter's setLocale value,
    // which is what the bug clobbered with the UI language.
    const testDate = new Date(2000, 11, 31, 14, 0, 0);

    const setup = (
      dateTimeLocale: string | null,
      currentLang: string,
    ): DateTimeFormatService => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [MatNativeDateModule],
        providers: [
          DateTimeFormatService,
          { provide: DateAdapter, useClass: CustomDateAdapter },
          {
            provide: TranslateService,
            useValue: { currentLang, defaultLang: 'en' },
          },
          provideMockStore({
            initialState: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                localization: {
                  ...DEFAULT_GLOBAL_CONFIG.localization,
                  lng: currentLang,
                  dateTimeLocale,
                },
              },
            },
          }),
        ],
      });
      dateAdapter = TestBed.inject(DateAdapter);
      return TestBed.inject(DateTimeFormatService);
    };

    it('renders adapter time in 24h when dateTimeLocale is 24h but UI language is en', () => {
      service = setup(DateTimeLocales.ja_jp, 'en');
      TestBed.flushEffects();

      expect(service.currentLocale()).toBe(DateTimeLocales.ja_jp);
      expect(service.isoTextLocale()).toBeNull();
      // Non-ISO options keep spelled-out names on the configured locale, so
      // ja/ar/etc. still render their native month/weekday names.
      expect(service.textLocale()).toBe(DateTimeLocales.ja_jp);
      expect(dateAdapter.format(testDate, TIME_FORMAT)).toBe('14:00');
    });

    it('does not let UI-language application clobber the dateTimeLocale override', () => {
      service = setup(DateTimeLocales.ja_jp, 'en');
      TestBed.flushEffects();
      expect(dateAdapter.format(testDate, TIME_FORMAT)).toBe('14:00');

      // Applying the UI language must NOT synchronously touch the adapter locale
      // (DateTimeFormatService is the single owner). Before the fix this called
      // setDateAdapterLocale('en') → 12h, and in the real-app startup race that
      // clobbering write was the last one, so it stuck (#8565). Assert without
      // flushing effects to capture exactly that window.
      service.setUiLanguage('en');
      expect(dateAdapter.format(testDate, TIME_FORMAT)).toBe('14:00');

      // Re-running the owning effect keeps the override applied.
      TestBed.flushEffects();
      expect(dateAdapter.format(testDate, TIME_FORMAT)).toBe('14:00');
    });

    it('uses the UI language only as a fallback when no override is set', () => {
      service = setup(null, 'en');
      service.setUiLanguage('en');
      TestBed.flushEffects();

      // en (US) → 12h AM/PM
      expect(dateAdapter.format(testDate, TIME_FORMAT)).toBe('2:00 PM');
    });
  });

  describe('LanguageService wiring keeps the dateTimeLocale override (#8565)', () => {
    const TIME_FORMAT: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: 'numeric',
    };
    const testDate = new Date(2000, 11, 31, 14, 0, 0);

    // Integration guard: the existing #8565 specs call setUiLanguage() directly.
    // This one boots the *real* LanguageService so a regression that points
    // _set() back at setDateAdapterLocale() (re-introducing the original race)
    // is caught — that is the actual code path that clobbered the override.
    it('renders 24h after LanguageService applies UI language "en" over a ja-jp override', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [MatNativeDateModule],
        providers: [
          DateTimeFormatService,
          LanguageService,
          { provide: DateAdapter, useClass: CustomDateAdapter },
          {
            provide: TranslateService,
            useValue: {
              currentLang: 'en',
              defaultLang: 'en',
              use: () => {},
              getBrowserCultureLang: () => undefined,
              getBrowserLang: () => undefined,
            },
          },
          provideMockStore({
            initialState: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                localization: {
                  ...DEFAULT_GLOBAL_CONFIG.localization,
                  dateTimeLocale: DateTimeLocales.ja_jp,
                },
              },
            },
          }),
        ],
      });

      const adapter = TestBed.inject(DateAdapter);
      TestBed.inject(DateTimeFormatService); // construct → owning effect registers
      TestBed.flushEffects(); // applies the ja-jp override
      expect(adapter.format(testDate, TIME_FORMAT)).toBe('14:00');

      // Apply the UI language through the real service. It must route through
      // setUiLanguage() (a fallback), not write the adapter — so the override
      // still wins in the synchronous pre-flush window where the race struck.
      TestBed.inject(LanguageService).setLng(LanguageCode.en);
      expect(adapter.format(testDate, TIME_FORMAT)).toBe('14:00');

      TestBed.flushEffects();
      expect(adapter.format(testDate, TIME_FORMAT)).toBe('14:00');
    });
  });
});

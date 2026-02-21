import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService } from './date-time-format.service';
import { provideMockStore } from '@ngrx/store/testing';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import {
  DateTimeLocales,
  DEFAULT_FIRST_DAY_OF_WEEK,
} from 'src/app/core/locale.constants';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { CustomDateAdapter } from './custom-date-adapter';

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
    });
  });
});

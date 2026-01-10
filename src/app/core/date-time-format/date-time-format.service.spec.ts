import { TestBed } from '@angular/core/testing';
import { DateTimeFormatService } from './date-time-format.service';
import { provideMockStore } from '@ngrx/store/testing';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_FIRST_DAY_OF_WEEK } from 'src/app/core/locale.constants';
import { GlobalConfigState } from '../../features/config/global-config.model';

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

    const mockDateAdapter = {
      getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
      setLocale: jasmine.createSpy('setLocale'),
    } as unknown as DateAdapter<Date>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DateTimeFormatService,
        provideMockStore({
          initialState: {
            globalConfig: config,
          },
        }),
        { provide: DateAdapter, useValue: mockDateAdapter },
      ],
    });

    dateAdapter = TestBed.inject(DateAdapter);
    return TestBed.inject(DateTimeFormatService);
  };

  beforeEach(() => {
    const mockDateAdapter = {
      getFirstDayOfWeek: () => DEFAULT_FIRST_DAY_OF_WEEK,
      setLocale: jasmine.createSpy('setLocale'),
    } as unknown as DateAdapter<Date>;

    TestBed.configureTestingModule({
      providers: [
        DateTimeFormatService,
        provideMockStore({
          initialState: {
            globalConfig: DEFAULT_GLOBAL_CONFIG,
          },
        }),
        { provide: DateAdapter, useValue: mockDateAdapter },
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
});

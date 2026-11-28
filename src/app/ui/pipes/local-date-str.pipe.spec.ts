import { TestBed } from '@angular/core/testing';
import { LocalDateStrPipe } from './local-date-str.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslateService } from '@ngx-translate/core';
import { DateService } from '../../core/date/date.service';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DateTimeLocales } from '../../core/locale.constants';

describe('LocalDateStrPipe', () => {
  let pipe: LocalDateStrPipe;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockDateService: jasmine.SpyObj<DateService>;

  beforeEach(() => {
    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [
      'currentLocale',
    ]);
    mockDateTimeFormatService.currentLocale.and.returnValue(DateTimeLocales.en_us);

    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.callFake((key: string) => {
      if (key === 'G.TODAY_TAG_TITLE') return 'Today';
      return key;
    });

    mockDateService = jasmine.createSpyObj('DateService', ['todayStr']);
    mockDateService.todayStr.and.callFake(() => getDbDateStr());

    TestBed.configureTestingModule({
      providers: [
        LocalDateStrPipe,
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: DateService, useValue: mockDateService },
      ],
    });

    pipe = TestBed.inject(LocalDateStrPipe);
  });

  it('should create the pipe', () => {
    expect(pipe).toBeTruthy();
  });

  it('should return null for null input', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(pipe.transform(undefined)).toBeNull();
  });

  it('should return null for invalid date string', () => {
    expect(pipe.transform('invalid-date')).toBeNull();
  });

  it('should return "Today" when value matches todayStr', () => {
    mockDateService.todayStr.and.returnValue('2026-05-10');
    expect(pipe.transform('2026-05-10')).toBe('Today');
    expect(mockTranslateService.instant).toHaveBeenCalled();
  });

  it('should format date when todayStr is overridden to empty string', () => {
    mockDateService.todayStr.and.returnValue('2026-05-10');
    const result = pipe.transform('2026-05-10', '');
    expect(result).not.toBe('Today');
    expect(result).toContain('10');
  });

  it('should format a non-today date string', () => {
    mockDateService.todayStr.and.returnValue('2026-05-10');
    const result = pipe.transform('2026-05-01');
    expect(result).not.toBe('Today');
    expect(result).toContain('1');
  });

  // With a start-of-next-day offset, 01:00 still belongs to yesterday;
  // the calendar day would format it as a normal date instead of "Today".
  it('should format logical today as "Today" when called past midnight without today arg', () => {
    jasmine.clock().install();
    // calendar day 2026-01-06; the DateService mock's logical today is 2026-01-05
    jasmine.clock().mockDate(new Date(2026, 0, 6, 1));
    mockDateService.todayStr.and.returnValue('2026-01-05');
    try {
      expect(pipe.transform('2026-01-05')).toBe('Today');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

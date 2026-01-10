import { TestBed } from '@angular/core/testing';
import { ScheduledDateGroupPipe } from './scheduled-date-group.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TranslateService } from '@ngx-translate/core';
import { getDbDateStr } from '../../util/get-db-date-str';

describe('ScheduledDateGroupPipe', () => {
  let pipe: ScheduledDateGroupPipe;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [], {
      currentLocale: 'en-US',
    });
    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.callFake((key: string) => {
      if (key === 'G.TODAY_TAG_TITLE') return 'Today';
      return key;
    });

    TestBed.configureTestingModule({
      providers: [
        ScheduledDateGroupPipe,
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: TranslateService, useValue: mockTranslateService },
      ],
    });

    pipe = TestBed.inject(ScheduledDateGroupPipe);
  });

  it('should create the pipe', () => {
    expect(pipe).toBeTruthy();
  });

  it('should format date string with weekday', () => {
    // Wednesday, January 15, 2025
    const result = pipe.transform('2025-01-15');
    expect(result).toMatch(/Wed/i);
    expect(result).toContain('1');
    expect(result).toContain('15');
  });

  it('should return "No date" unchanged', () => {
    const result = pipe.transform('No date');
    expect(result).toBe('No date');
  });

  it('should return null for null input', () => {
    const result = pipe.transform(null);
    expect(result).toBeNull();
  });

  it('should return null for undefined input', () => {
    const result = pipe.transform(undefined);
    expect(result).toBeNull();
  });

  it('should handle "Today" translation for today\'s date', () => {
    const todayStr = getDbDateStr();
    const result = pipe.transform(todayStr);
    expect(result).toBe('Today');
    expect(mockTranslateService.instant).toHaveBeenCalled();
  });

  it('should format weekend dates correctly', () => {
    // Saturday, January 18, 2025
    const saturdayResult = pipe.transform('2025-01-18');
    expect(saturdayResult).toMatch(/Sat/i);

    // Sunday, January 19, 2025
    const sundayResult = pipe.transform('2025-01-19');
    expect(sundayResult).toMatch(/Sun/i);
  });

  it('should respect configured locale for weekday names', () => {
    // Change locale to German
    Object.defineProperty(mockDateTimeFormatService, 'currentLocale', {
      get: () => 'de-DE',
    });

    // Wednesday in German is "Mi" (Mittwoch)
    const result = pipe.transform('2025-01-15');
    expect(result).toMatch(/Mi/i);
  });

  it('should pass through non-date strings that are not "No date"', () => {
    // "No tag", "No project" etc. should pass through unchanged
    const result = pipe.transform('No tag');
    expect(result).toBe('No tag');
  });

  it('should handle invalid date strings gracefully', () => {
    const result = pipe.transform('invalid-date');
    expect(result).toBe('invalid-date');
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DayOfMonthPipe } from './day-of-month.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

describe('DayOfMonthPipe', () => {
  let pipe: DayOfMonthPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DayOfMonthPipe,
        { provide: DateTimeFormatService, useValue: { textLocale: signal('en-GB') } },
      ],
    });
    pipe = TestBed.inject(DayOfMonthPipe);
  });

  it('should default to the configured text locale', () => {
    expect(pipe.transform('2026-09-30')).toBe('30');
  });

  it('should only add a trailing dot where the locale uses one', () => {
    expect(pipe.transform('2026-09-30', 'pl')).toBe('30');
    expect(pipe.transform('2026-09-30', 'de-DE')).toBe('30.');
  });

  it('should order and inflect the day with its month per locale', () => {
    expect(pipe.transform('2026-09-30', 'pl', true)).toBe('30 września');
    expect(pipe.transform('2026-09-30', 'en-GB', true)).toBe('30 September');
    expect(pipe.transform('2026-09-30', 'en-US', true)).toBe('September 30');
    expect(pipe.transform('2026-09-30', 'de-DE', true)).toBe('30. September');
  });
});

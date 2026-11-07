import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NumberToMonthPipe } from './number-to-month.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

describe('NumberToMonthPipe', () => {
  let pipe: NumberToMonthPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NumberToMonthPipe,
        { provide: DateTimeFormatService, useValue: { textLocale: signal('en-US') } },
      ],
    });
    pipe = TestBed.inject(NumberToMonthPipe);
  });

  it('should default to the configured text locale', () => {
    expect(pipe.transform('01')).toBe('January');
  });

  it('should use the standalone month name for the given locale', () => {
    expect(pipe.transform(12, 'pl')).toBe('grudzień');
    expect(pipe.transform('3', 'de-DE')).toBe('März');
  });

  it('should return undefined for an out-of-range month', () => {
    expect(pipe.transform(0)).toBeUndefined();
    expect(pipe.transform('13')).toBeUndefined();
  });
});

import { TestBed } from '@angular/core/testing';
import { LocaleDatePipe } from './locale-date.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

describe('LocaleDatePipe', () => {
  let pipe: LocaleDatePipe;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DateTimeFormatService', ['formatTime'], {
      currentLocale: 'en-US',
    });

    TestBed.configureTestingModule({
      providers: [LocaleDatePipe, { provide: DateTimeFormatService, useValue: spy }],
    });

    pipe = TestBed.inject(LocaleDatePipe);
  });

  it('should return null for null input', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(pipe.transform(undefined)).toBeNull();
  });

  it('should return null for NaN input', () => {
    expect(pipe.transform(NaN)).toBeNull();
  });

  it('should return null for Infinity input', () => {
    expect(pipe.transform(Infinity)).toBeNull();
  });

  it('should format valid number input', () => {
    const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
    const result = pipe.transform(timestamp, 'short');
    expect(result).toBeTruthy();
  });

  it('should format valid Date input', () => {
    const date = new Date(2024, 0, 15, 14, 30);
    const result = pipe.transform(date, 'short');
    expect(result).toBeTruthy();
  });
});

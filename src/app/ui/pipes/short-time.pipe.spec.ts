import { TestBed } from '@angular/core/testing';
import { ShortTimePipe } from './short-time.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

describe('ShortTimePipe', () => {
  let pipe: ShortTimePipe;
  let dateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DateTimeFormatService', ['formatTime']);

    TestBed.configureTestingModule({
      providers: [ShortTimePipe, { provide: DateTimeFormatService, useValue: spy }],
    });

    pipe = TestBed.inject(ShortTimePipe);
    dateTimeFormatService = TestBed.inject(
      DateTimeFormatService,
    ) as jasmine.SpyObj<DateTimeFormatService>;
  });

  it('should format valid timestamp using DateTimeFormatService', () => {
    const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
    dateTimeFormatService.formatTime.and.returnValue('2:30 PM');

    const result = pipe.transform(timestamp);

    expect(dateTimeFormatService.formatTime).toHaveBeenCalledWith(timestamp);
    expect(result).toBe('2:30 PM');
  });

  it('should return null for null input', () => {
    const result = pipe.transform(null);
    expect(result).toBeNull();
    expect(dateTimeFormatService.formatTime).not.toHaveBeenCalled();
  });

  it('should return null for undefined input', () => {
    const result = pipe.transform(undefined);
    expect(result).toBeNull();
    expect(dateTimeFormatService.formatTime).not.toHaveBeenCalled();
  });

  it('should return null for non-number input', () => {
    const result = pipe.transform('not a number' as any);
    expect(result).toBeNull();
    expect(dateTimeFormatService.formatTime).not.toHaveBeenCalled();
  });

  it('should handle zero timestamp', () => {
    dateTimeFormatService.formatTime.and.returnValue('12:00 AM');

    const result = pipe.transform(0);

    expect(dateTimeFormatService.formatTime).toHaveBeenCalledWith(0);
    expect(result).toBe('12:00 AM');
  });

  it('should handle negative timestamp', () => {
    const negativeTimestamp = -86400000; // -1 day in milliseconds
    dateTimeFormatService.formatTime.and.returnValue('12:00 AM');

    const result = pipe.transform(negativeTimestamp);

    expect(dateTimeFormatService.formatTime).toHaveBeenCalledWith(negativeTimestamp);
    expect(result).toBe('12:00 AM');
  });

  describe('with 24-hour format', () => {
    it('should format morning time', () => {
      const timestamp = new Date(2024, 0, 15, 9, 30).getTime();
      dateTimeFormatService.formatTime.and.returnValue('09:30');

      const result = pipe.transform(timestamp);

      expect(result).toBe('09:30');
    });

    it('should format afternoon time', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
      dateTimeFormatService.formatTime.and.returnValue('14:30');

      const result = pipe.transform(timestamp);

      expect(result).toBe('14:30');
    });

    it('should format midnight', () => {
      const timestamp = new Date(2024, 0, 15, 0, 0).getTime();
      dateTimeFormatService.formatTime.and.returnValue('00:00');

      const result = pipe.transform(timestamp);

      expect(result).toBe('00:00');
    });
  });

  describe('with 12-hour format', () => {
    it('should format morning time with AM', () => {
      const timestamp = new Date(2024, 0, 15, 9, 30).getTime();
      dateTimeFormatService.formatTime.and.returnValue('9:30 AM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('9:30 AM');
    });

    it('should format afternoon time with PM', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
      dateTimeFormatService.formatTime.and.returnValue('2:30 PM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('2:30 PM');
    });

    it('should format midnight as 12:00 AM', () => {
      const timestamp = new Date(2024, 0, 15, 0, 0).getTime();
      dateTimeFormatService.formatTime.and.returnValue('12:00 AM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('12:00 AM');
    });

    it('should format noon as 12:00 PM', () => {
      const timestamp = new Date(2024, 0, 15, 12, 0).getTime();
      dateTimeFormatService.formatTime.and.returnValue('12:00 PM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('12:00 PM');
    });
  });
});

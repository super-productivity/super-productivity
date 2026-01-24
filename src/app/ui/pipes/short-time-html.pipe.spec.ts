import { TestBed } from '@angular/core/testing';
import { ShortTimeHtmlPipe } from './short-time-html.pipe';
import { ShortTimePipe } from './short-time.pipe';

describe('ShortTimeHtmlPipe', () => {
  let pipe: ShortTimeHtmlPipe;
  let shortTimePipe: jasmine.SpyObj<ShortTimePipe>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('ShortTimePipe', ['transform']);

    TestBed.configureTestingModule({
      providers: [ShortTimeHtmlPipe, { provide: ShortTimePipe, useValue: spy }],
    });

    pipe = TestBed.inject(ShortTimeHtmlPipe);
    shortTimePipe = TestBed.inject(ShortTimePipe) as jasmine.SpyObj<ShortTimePipe>;
  });

  it('should return null when ShortTimePipe returns null', () => {
    shortTimePipe.transform.and.returnValue(null);

    const result = pipe.transform(null);

    expect(shortTimePipe.transform).toHaveBeenCalledWith(null);
    expect(result).toBeNull();
  });

  it('should return null for undefined input', () => {
    shortTimePipe.transform.and.returnValue(null);

    const result = pipe.transform(undefined);

    expect(shortTimePipe.transform).toHaveBeenCalledWith(undefined);
    expect(result).toBeNull();
  });

  describe('12-hour format with AM/PM', () => {
    it('should wrap AM in span tags', () => {
      const timestamp = new Date(2024, 0, 15, 9, 30).getTime();
      shortTimePipe.transform.and.returnValue('9:30 AM');

      const result = pipe.transform(timestamp);

      expect(shortTimePipe.transform).toHaveBeenCalledWith(timestamp);
      expect(result).toBe('9:30 <span>AM</span>');
    });

    it('should wrap PM in span tags', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
      shortTimePipe.transform.and.returnValue('2:30 PM');

      const result = pipe.transform(timestamp);

      expect(shortTimePipe.transform).toHaveBeenCalledWith(timestamp);
      expect(result).toBe('2:30 <span>PM</span>');
    });

    it('should handle midnight (12:00 AM)', () => {
      const timestamp = new Date(2024, 0, 15, 0, 0).getTime();
      shortTimePipe.transform.and.returnValue('12:00 AM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('12:00 <span>AM</span>');
    });

    it('should handle noon (12:00 PM)', () => {
      const timestamp = new Date(2024, 0, 15, 12, 0).getTime();
      shortTimePipe.transform.and.returnValue('12:00 PM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('12:00 <span>PM</span>');
    });

    it('should only replace the first occurrence of AM', () => {
      // Edge case: if somehow the time contains AM twice
      const timestamp = Date.now();
      shortTimePipe.transform.and.returnValue('AM 9:30 AM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('<span>AM</span> 9:30 AM');
    });

    it('should only replace the first occurrence of PM', () => {
      // Edge case: if somehow the time contains PM twice
      const timestamp = Date.now();
      shortTimePipe.transform.and.returnValue('PM 2:30 PM');

      const result = pipe.transform(timestamp);

      expect(result).toBe('<span>PM</span> 2:30 PM');
    });
  });

  describe('24-hour format without AM/PM', () => {
    it('should return time unchanged for 24-hour format', () => {
      const timestamp = new Date(2024, 0, 15, 14, 30).getTime();
      shortTimePipe.transform.and.returnValue('14:30');

      const result = pipe.transform(timestamp);

      expect(shortTimePipe.transform).toHaveBeenCalledWith(timestamp);
      expect(result).toBe('14:30');
    });

    it('should handle midnight in 24-hour format', () => {
      const timestamp = new Date(2024, 0, 15, 0, 0).getTime();
      shortTimePipe.transform.and.returnValue('00:00');

      const result = pipe.transform(timestamp);

      expect(result).toBe('00:00');
    });

    it('should handle noon in 24-hour format', () => {
      const timestamp = new Date(2024, 0, 15, 12, 0).getTime();
      shortTimePipe.transform.and.returnValue('12:00');

      const result = pipe.transform(timestamp);

      expect(result).toBe('12:00');
    });

    it('should handle early morning in 24-hour format', () => {
      const timestamp = new Date(2024, 0, 15, 3, 45).getTime();
      shortTimePipe.transform.and.returnValue('03:45');

      const result = pipe.transform(timestamp);

      expect(result).toBe('03:45');
    });

    it('should handle late evening in 24-hour format', () => {
      const timestamp = new Date(2024, 0, 15, 23, 59).getTime();
      shortTimePipe.transform.and.returnValue('23:59');

      const result = pipe.transform(timestamp);

      expect(result).toBe('23:59');
    });
  });

  describe('edge cases', () => {
    it('should return null for empty string from ShortTimePipe', () => {
      shortTimePipe.transform.and.returnValue('');

      const result = pipe.transform(Date.now());

      expect(result).toBeNull();
    });

    it('should handle time with extra spaces', () => {
      shortTimePipe.transform.and.returnValue('  9:30  AM  ');

      const result = pipe.transform(Date.now());

      expect(result).toBe('  9:30  <span>AM</span>  ');
    });

    it('should handle time without minutes', () => {
      shortTimePipe.transform.and.returnValue('9 AM');

      const result = pipe.transform(Date.now());

      expect(result).toBe('9 <span>AM</span>');
    });

    it('should handle time with seconds', () => {
      shortTimePipe.transform.and.returnValue('9:30:45 PM');

      const result = pipe.transform(Date.now());

      expect(result).toBe('9:30:45 <span>PM</span>');
    });

    it('should not modify text that contains am/pm in lowercase', () => {
      shortTimePipe.transform.and.returnValue('9:30 am');

      const result = pipe.transform(Date.now());

      // Only uppercase AM/PM should be wrapped
      expect(result).toBe('9:30 am');
    });
  });
});

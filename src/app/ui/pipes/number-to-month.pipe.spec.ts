import { NumberToMonthPipe } from './number-to-month.pipe';

describe('NumberToMonthPipe', () => {
  const pipe = new NumberToMonthPipe();

  it('should return the English month name for an English locale', () => {
    expect(pipe.transform(1, 'en')).toBe('January');
    expect(pipe.transform('12', 'en')).toBe('December');
  });

  it('should return the month name in the given locale', () => {
    expect(pipe.transform(11, 'es')).toBe('noviembre');
    expect(pipe.transform('03', 'de')).toBe('März');
  });

  it('should name the Gregorian month even where the locale defaults to another calendar', () => {
    // fa defaults to the Persian calendar, which would label January "دی" (Dey)
    expect(pipe.transform(1, 'fa')).toBe('ژانویه');
  });

  it('should return undefined for out-of-range values', () => {
    expect(pipe.transform(0, 'en')).toBeUndefined();
    expect(pipe.transform(13, 'en')).toBeUndefined();
    expect(pipe.transform('abc', 'en')).toBeUndefined();
  });
});

import {
  formatDuration,
  formatTime12h,
  parseCustomTimeString,
} from './parse-custom-time-string.util';

describe('parseCustomTimeString', () => {
  it('should fall back to current24h or 12:00 if empty or invalid', () => {
    expect(parseCustomTimeString('', '14:00')).toBe('14:00');
    expect(parseCustomTimeString(null, '14:00')).toBe('14:00');
    expect(parseCustomTimeString(undefined, '14:00')).toBe('14:00');
    expect(parseCustomTimeString('   ', '14:00')).toBe('14:00');
    expect(parseCustomTimeString('', undefined)).toBe('12:00');
  });

  it('should parse 1 or 2 digits shorthand retaining context', () => {
    // Current is AM (10:00)
    expect(parseCustomTimeString('9', '10:00')).toBe('09:00');
    expect(parseCustomTimeString('11', '10:00')).toBe('11:00');

    // Current is PM (22:45)
    expect(parseCustomTimeString('9', '22:45')).toBe('21:00');
    expect(parseCustomTimeString('11', '22:45')).toBe('23:00');
  });

  it('should parse explicit AM and PM', () => {
    expect(parseCustomTimeString('9a', '22:45')).toBe('09:00');
    expect(parseCustomTimeString('9am', '22:45')).toBe('09:00');
    expect(parseCustomTimeString('9p', '10:00')).toBe('21:00');
    expect(parseCustomTimeString('9pm', '10:00')).toBe('21:00');
    expect(parseCustomTimeString('12am', '12:00')).toBe('00:00');
    expect(parseCustomTimeString('12pm', '00:00')).toBe('12:00');
  });

  it('should parse 3 or 4 digits shorthand (e.g. 930, 1130)', () => {
    // 3 digits
    expect(parseCustomTimeString('930', '10:00')).toBe('09:30');
    expect(parseCustomTimeString('930', '22:00')).toBe('21:30');

    // 4 digits
    expect(parseCustomTimeString('1130', '10:00')).toBe('11:30');
    expect(parseCustomTimeString('1130', '22:00')).toBe('23:30');
  });

  it('should parse standard colon time formats', () => {
    expect(parseCustomTimeString('09:30', '10:00')).toBe('09:30');
    expect(parseCustomTimeString('14:45', '10:00')).toBe('14:45');
    expect(parseCustomTimeString('10:45 AM', '10:00')).toBe('10:45');
    expect(parseCustomTimeString('10:45 PM', '10:00')).toBe('22:45');
  });

  it('should toggle am/pm if only "am" or "pm" is entered', () => {
    expect(parseCustomTimeString('am', '22:45')).toBe('10:45');
    expect(parseCustomTimeString('pm', '10:45')).toBe('22:45');
    expect(parseCustomTimeString('pm', '22:45')).toBe('22:45');
    expect(parseCustomTimeString('am', '10:45')).toBe('10:45');
  });

  it('should bound hours and minutes correctly', () => {
    expect(parseCustomTimeString('25:70', '10:00')).toBe('23:59');
  });
});

describe('formatTime12h', () => {
  it('should format 24h string to 12h representation', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM');
    expect(formatTime12h('09:30')).toBe('9:30 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('14:15')).toBe('2:15 PM');
    expect(formatTime12h('22:45')).toBe('10:45 PM');
    expect(formatTime12h('')).toBe('12:00 AM');
  });
});

describe('formatDuration', () => {
  it('should format milliseconds to readable strings', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-100)).toBe('0m');
    expect(formatDuration(15 * 60 * 1000)).toBe('15m');
    expect(formatDuration(30 * 60 * 1000)).toBe('30m');
    expect(formatDuration(60 * 60 * 1000)).toBe('1h');
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
  });
});

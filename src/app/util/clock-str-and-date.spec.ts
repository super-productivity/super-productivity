import { clockStrToDate, dateToClockStr } from './clock-str-and-date';

describe('clockStrToDate', () => {
  it('converts HH:mm to a Date with those hours/minutes', () => {
    const base = new Date(2020, 0, 15, 5, 5, 5, 5);
    const d = clockStrToDate('14:30', base)!;
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('keeps the date portion from baseDate', () => {
    const d = clockStrToDate('08:15', new Date(2021, 5, 9))!;
    expect(d.getFullYear()).toBe(2021);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(9);
  });

  it('normalizes legacy unpadded values', () => {
    const d = clockStrToDate('9:00', new Date(2020, 0, 1))!;
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it('returns null for empty or invalid input', () => {
    expect(clockStrToDate(null)).toBeNull();
    expect(clockStrToDate(undefined)).toBeNull();
    expect(clockStrToDate('')).toBeNull();
    expect(clockStrToDate('25:00', new Date())).toBeNull();
    expect(clockStrToDate('13:60', new Date())).toBeNull();
    expect(clockStrToDate('abc', new Date())).toBeNull();
  });
});

describe('dateToClockStr', () => {
  it('formats a Date to canonical 24h HH:mm', () => {
    expect(dateToClockStr(new Date(2020, 0, 1, 14, 30))).toBe('14:30');
    expect(dateToClockStr(new Date(2020, 0, 1, 9, 5))).toBe('09:05');
    expect(dateToClockStr(new Date(2020, 0, 1, 0, 0))).toBe('00:00');
    expect(dateToClockStr(new Date(2020, 0, 1, 23, 59))).toBe('23:59');
  });

  it('returns null for null or invalid Date', () => {
    expect(dateToClockStr(null)).toBeNull();
    expect(dateToClockStr(undefined)).toBeNull();
    expect(dateToClockStr(new Date('not-a-date'))).toBeNull();
  });

  it('round-trips with clockStrToDate', () => {
    expect(dateToClockStr(clockStrToDate('23:45', new Date()))).toBe('23:45');
    expect(dateToClockStr(clockStrToDate('00:00', new Date()))).toBe('00:00');
  });
});

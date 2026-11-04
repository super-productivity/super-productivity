import { parseInstant, toDueDay } from './csv-fields';
import { parseCsv } from './parse-csv';

describe('parseInstant', () => {
  it('accepts offsets with and without a colon, Z and none', () => {
    const expected = Date.UTC(2026, 9, 15, 8, 30);
    expect(parseInstant('2026-10-15T08:30:00+0000')).toBe(expected);
    expect(parseInstant('2026-10-15T10:30:00+02:00')).toBe(expected);
    expect(parseInstant('2026-10-15T08:30:00.000Z')).toBe(expected);
    expect(parseInstant('2026-10-15 08:30:00')).toBe(expected);
  });

  it('rejects garbage and out-of-range dates', () => {
    expect(parseInstant('')).toBeNull();
    expect(parseInstant('tomorrow')).toBeNull();
    expect(parseInstant('3001-01-01T00:00:00+0000')).toBeNull();
  });
});

describe('toDueDay', () => {
  it('falls back to the device zone for an unknown time zone', () => {
    const ms = Date.UTC(2026, 9, 15, 12);
    expect(toDueDay(ms, 'Not/AZone')).toBe(toDueDay(ms, ''));
  });

  it('reads the calendar day in the given zone', () => {
    expect(toDueDay(Date.UTC(2026, 9, 14, 15), 'Asia/Tokyo')).toBe('2026-10-15');
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes and embedded line breaks', () => {
    expect(parseCsv('a,"b,c","d ""e""\nf"\n\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"\nf'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,,\n')).toEqual([['a', '', '']]);
  });
});

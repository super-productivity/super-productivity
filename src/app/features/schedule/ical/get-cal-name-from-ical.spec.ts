import { getCalNameFromIcal } from './get-cal-name-from-ical';

const wrapIcal = (lines: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

describe('getCalNameFromIcal', () => {
  it('extracts the calendar name from X-WR-CALNAME', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-CALNAME:Work Calendar']))).toBe(
      'Work Calendar',
    );
  });

  it('matches case-insensitively', () => {
    expect(getCalNameFromIcal(wrapIcal(['x-wr-calname:Private']))).toBe('Private');
  });

  it('handles property parameters before the value', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-CALNAME;VALUE=TEXT:Team Events']))).toBe(
      'Team Events',
    );
  });

  it('unfolds folded content lines (RFC 5545 §3.1)', () => {
    expect(
      getCalNameFromIcal(wrapIcal(['X-WR-CALNAME:A very long calen', ' dar name'])),
    ).toBe('A very long calendar name');
  });

  it('unescapes TEXT values (RFC 5545 §3.3.11)', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-CALNAME:Family\\, Friends\\; more']))).toBe(
      'Family, Friends; more',
    );
  });

  it('renders escaped newlines as a single-line label', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-CALNAME:Line1\\nLine2']))).toBe(
      'Line1 Line2',
    );
  });

  it('handles LF-only line endings', () => {
    expect(
      getCalNameFromIcal('BEGIN:VCALENDAR\nX-WR-CALNAME:Unix Feed\nEND:VCALENDAR'),
    ).toBe('Unix Feed');
  });

  it('returns undefined when the property is missing', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-TIMEZONE:Europe/Berlin']))).toBeUndefined();
  });

  it('returns undefined for an empty value', () => {
    expect(getCalNameFromIcal(wrapIcal(['X-WR-CALNAME:']))).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(getCalNameFromIcal('')).toBeUndefined();
  });

  it('does NOT match a property whose name merely starts alike', () => {
    expect(
      getCalNameFromIcal(wrapIcal(['SUMMARY:X-WR-CALNAME:not a real one'])),
    ).toBeUndefined();
  });
});

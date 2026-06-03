import { isLikelyIcal } from './is-likely-ical';

describe('isLikelyIcal', () => {
  it('accepts a minimal iCal body', () => {
    expect(isLikelyIcal('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
  });

  it('accepts iCal with leading whitespace and blank lines', () => {
    expect(isLikelyIcal('\r\n\r\n   BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
  });

  it('accepts iCal regardless of case (RFC 5545 property names are case-insensitive)', () => {
    expect(isLikelyIcal('begin:vcalendar\r\nend:vcalendar')).toBe(true);
  });

  it('rejects an HTML response (the Office365 revoked-link case)', () => {
    expect(
      isLikelyIcal(
        '<html><head><title>Object moved</title></head><body>' +
          '<h2>Object moved to <a href="https://outlook.office365.com/mail/">here</a>.</h2>' +
          '</body></html>',
      ),
    ).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(isLikelyIcal('')).toBe(false);
  });

  it('rejects a plain-text non-iCal body', () => {
    expect(isLikelyIcal('Not found')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isLikelyIcal(null)).toBe(false);
    expect(isLikelyIcal(undefined)).toBe(false);
  });
});

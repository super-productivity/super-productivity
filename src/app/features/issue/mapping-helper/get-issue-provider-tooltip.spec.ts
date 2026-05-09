import { sanitizeIcalUrlForDisplay } from './get-issue-provider-tooltip';

describe('sanitizeIcalUrlForDisplay', () => {
  it('returns hostname for https:// URLs', () => {
    expect(sanitizeIcalUrlForDisplay('https://calendar.google.com/cal.ics')).toBe(
      'calendar.google.com',
    );
  });

  it('strips port from host', () => {
    expect(sanitizeIcalUrlForDisplay('https://example.com:8443/feed')).toBe(
      'example.com',
    );
  });

  it('strips credentials in the path', () => {
    expect(
      sanitizeIcalUrlForDisplay(
        'https://calendar.google.com/calendar/ical/abc123secret/private-xyz/basic.ics',
      ),
    ).toBe('calendar.google.com');
  });

  it('strips credentials in the query string', () => {
    expect(
      sanitizeIcalUrlForDisplay('https://api.example.com/cal?token=SECRETTOKEN'),
    ).toBe('api.example.com');
  });

  it('strips userinfo embedded in the URL', () => {
    expect(sanitizeIcalUrlForDisplay('https://user:tokenSECRET@host.example.com/')).toBe(
      'host.example.com',
    );
  });

  it('normalizes webcal:// to extract the hostname', () => {
    expect(sanitizeIcalUrlForDisplay('webcal://feeds.example.com/cal.ics')).toBe(
      'feeds.example.com',
    );
  });

  it('normalizes webcals:// (case-insensitive) to extract the hostname', () => {
    expect(sanitizeIcalUrlForDisplay('WEBCALS://feeds.example.com/cal.ics')).toBe(
      'feeds.example.com',
    );
  });

  it('returns the basename for file:/// URLs (Electron local files)', () => {
    expect(sanitizeIcalUrlForDisplay('file:///home/user/calendar.ics')).toBe(
      'file: calendar.ics',
    );
  });

  it('returns iCal placeholder for file:/// URLs without a basename', () => {
    expect(sanitizeIcalUrlForDisplay('file:///')).toBe('iCal');
  });

  it('does NOT leak data: URL payloads through the file: branch', () => {
    expect(
      sanitizeIcalUrlForDisplay(
        'data:text/calendar;base64,QkVHSU46VkNBTEVOREFSCgo=SECRETPAYLOAD',
      ),
    ).toBe('iCal');
  });

  it('does NOT leak blob: URLs through the file: branch', () => {
    expect(sanitizeIcalUrlForDisplay('blob:https://example.com/uuid-deadbeef')).toBe(
      'iCal',
    );
  });

  it('does NOT mislabel javascript: URLs as file:', () => {
    expect(sanitizeIcalUrlForDisplay('javascript:alert(document.cookie)')).toBe('iCal');
  });

  it('returns iCal placeholder for non-URL strings', () => {
    expect(sanitizeIcalUrlForDisplay('not a url at all')).toBe('iCal');
  });

  it('returns iCal placeholder for empty input', () => {
    expect(sanitizeIcalUrlForDisplay('')).toBe('iCal');
  });

  it('returns iCal placeholder for undefined input', () => {
    expect(sanitizeIcalUrlForDisplay(undefined)).toBe('iCal');
  });
});

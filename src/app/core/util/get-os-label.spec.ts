import { getOsLabel } from './get-os-label';

describe('getOsLabel', () => {
  it('recognises desktop OS families', () => {
    expect(getOsLabel('Mozilla/5.0 (X11; Linux x86_64) Electron/38')).toBe('Linux');
    expect(getOsLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
    expect(getOsLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(getOsLabel('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')).toBe('ChromeOS');
  });

  it('reads Android before Linux (Android UAs contain both)', () => {
    expect(getOsLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android');
  });

  it('returns null for an unknown UA', () => {
    expect(getOsLabel('curl/8.0')).toBeNull();
  });

  it('defaults to the current user agent', () => {
    expect(getOsLabel()).toBe(getOsLabel(navigator.userAgent));
  });
});

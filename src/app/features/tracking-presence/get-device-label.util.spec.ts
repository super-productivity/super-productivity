import {
  MAX_DEVICE_LABEL_LENGTH,
  getDeviceLabel,
  resolveDeviceLabel,
  sanitizeDeviceLabel,
} from './get-device-label.util';

describe('get-device-label.util', () => {
  describe('getDeviceLabel', () => {
    it('suffixes desktop and browser labels with the OS family', () => {
      expect(getDeviceLabel('E', 'Mozilla/5.0 (X11; Linux x86_64) Electron/38')).toBe(
        'Desktop (Linux)',
      );
      expect(getDeviceLabel('B', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
        'Browser (Windows)',
      );
    });

    it('keeps mobile labels bare — the platform already names the OS', () => {
      expect(getDeviceLabel('A', 'Mozilla/5.0 (Linux; Android 14)')).toBe('Android');
      expect(getDeviceLabel('I', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('iOS');
    });

    it('falls back to the bare platform label for an unknown UA', () => {
      expect(getDeviceLabel('E', 'curl/8.0')).toBe('Desktop');
    });

    it('uses the current platform and UA by default', () => {
      expect(getDeviceLabel()).toMatch(/^(Desktop|Browser|Android|iOS)/);
    });
  });

  describe('sanitizeDeviceLabel', () => {
    it('strips markup-capable chars and caps the length', () => {
      expect(sanitizeDeviceLabel('<b>Jo\'s "PC"</b>')).toBe('bJos PC/b');
      expect(sanitizeDeviceLabel('x'.repeat(50)).length).toBe(MAX_DEVICE_LABEL_LENGTH);
    });

    it('returns an empty string for non-strings', () => {
      expect(sanitizeDeviceLabel(undefined)).toBe('');
      expect(sanitizeDeviceLabel({ evil: true })).toBe('');
    });
  });

  describe('resolveDeviceLabel', () => {
    it('prefers a trimmed custom name', () => {
      expect(resolveDeviceLabel('  Work laptop  ')).toBe('Work laptop');
    });

    it('falls back to the platform default for blank or markup-only names', () => {
      expect(resolveDeviceLabel(undefined)).toBe(getDeviceLabel());
      expect(resolveDeviceLabel('   ')).toBe(getDeviceLabel());
      expect(resolveDeviceLabel('<>')).toBe(getDeviceLabel());
    });

    it('is a fixed point of the viewer-side sanitizer', () => {
      // Pins the sanitize-then-trim order: a trailing space cut by the cap
      // must not reappear when the viewer re-sanitizes the relayed label.
      const label = resolveDeviceLabel('Jo\'s "Mac" ' + 'x'.repeat(40));
      expect(sanitizeDeviceLabel(label)).toBe(label);
    });
  });
});

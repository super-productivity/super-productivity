import { getBackgroundImageBlur, getBackgroundOverlayOpacity } from './app.component';

describe('AppComponent theme helpers', () => {
  describe('getBackgroundOverlayOpacity()', () => {
    it('should use the default overlay opacity when the active context is missing', () => {
      expect(getBackgroundOverlayOpacity(null)).toBe(0.2);
      expect(getBackgroundOverlayOpacity(undefined)).toBe(0.2);
    });

    it('should use the default overlay opacity when a persisted context has a null theme', () => {
      expect(getBackgroundOverlayOpacity({ theme: null })).toBe(0.2);
    });

    it('should resolve configured overlay opacity to a CSS alpha value', () => {
      expect(
        getBackgroundOverlayOpacity({ theme: { backgroundOverlayOpacity: 65 } }),
      ).toBe(0.65);
    });
  });

  describe('getBackgroundImageBlur()', () => {
    it('should use zero blur when the active context is missing', () => {
      expect(getBackgroundImageBlur(null)).toBe(0);
      expect(getBackgroundImageBlur(undefined)).toBe(0);
    });

    it('should use zero blur when a persisted context has a null theme', () => {
      expect(getBackgroundImageBlur({ theme: null })).toBe(0);
    });

    it('should normalize configured blur values', () => {
      expect(getBackgroundImageBlur({ theme: { backgroundImageBlur: 12 } })).toBe(12);
      expect(getBackgroundImageBlur({ theme: { backgroundImageBlur: -5 } })).toBe(0);
    });
  });
});

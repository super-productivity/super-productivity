import {
  getBackgroundImageBlur,
  getBackgroundOverlayOpacity,
  hasBackgroundImage,
  resetBackgroundImageTheme,
} from './app.component';

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

  describe('hasBackgroundImage()', () => {
    it('should be false when no background image is configured', () => {
      expect(hasBackgroundImage(null)).toBeFalse();
      expect(hasBackgroundImage(undefined)).toBeFalse();
      expect(hasBackgroundImage({ theme: null })).toBeFalse();
      expect(
        hasBackgroundImage({
          theme: {
            backgroundImageDark: '',
            backgroundImageLight: '   ',
          },
        }),
      ).toBeFalse();
    });

    it('should be true when either background image is configured', () => {
      expect(
        hasBackgroundImage({
          theme: {
            backgroundImageDark: 'file:///home/user/dark.png',
            backgroundImageLight: '',
          },
        }),
      ).toBeTrue();
      expect(
        hasBackgroundImage({
          theme: {
            backgroundImageDark: null,
            backgroundImageLight: 'https://example.com/light.jpg',
          },
        }),
      ).toBeTrue();
    });
  });

  describe('resetBackgroundImageTheme()', () => {
    it('should clear only background image URLs', () => {
      expect(
        resetBackgroundImageTheme({
          primary: '#123456',
          backgroundImageDark: 'file:///home/user/dark.png',
          backgroundImageLight: 'https://example.com/light.jpg',
          backgroundOverlayOpacity: 42,
          backgroundImageBlur: 6,
        }),
      ).toEqual({
        primary: '#123456',
        backgroundImageDark: null,
        backgroundImageLight: null,
        backgroundOverlayOpacity: 42,
        backgroundImageBlur: 6,
      });
    });
  });
});

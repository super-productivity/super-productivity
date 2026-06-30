import { getBackgroundImageBlur, getBackgroundOverlayOpacity } from './app.component';
import { isQuickAddWindowMode } from './util/is-quick-add-window-mode';

describe('AppComponent theme helpers', () => {
  const fakeQuickAddDocument = (
    hasQuickAddClass: boolean,
  ): Pick<Document, 'body' | 'documentElement'> => {
    const body = document.createElement('body');
    const documentElement = document.createElement('html');
    if (hasQuickAddClass) {
      body.classList.add('isQuickAddHud');
    }
    return {
      body,
      documentElement,
    };
  };

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

  describe('isQuickAddWindowMode()', () => {
    it('should detect the quick-add route hash', () => {
      expect(
        isQuickAddWindowMode(
          { hash: '#/quick-add', search: '' },
          fakeQuickAddDocument(false),
        ),
      ).toBeTrue();
      expect(
        isQuickAddWindowMode(
          { hash: '#/quick-add?x=1', search: '' },
          fakeQuickAddDocument(false),
        ),
      ).toBeTrue();
    });

    it('should detect the stable quick-add query param', () => {
      expect(
        isQuickAddWindowMode(
          { hash: '#/tag/TODAY/tasks', search: '?quickAdd=1' },
          fakeQuickAddDocument(false),
        ),
      ).toBeTrue();
    });

    it('should detect the quick-add body class fallback', () => {
      expect(
        isQuickAddWindowMode(
          { hash: '#/tag/TODAY/tasks', search: '' },
          fakeQuickAddDocument(true),
        ),
      ).toBeTrue();
    });

    it('should not match regular app routes', () => {
      expect(
        isQuickAddWindowMode(
          { hash: '#/tag/TODAY/tasks', search: '' },
          fakeQuickAddDocument(false),
        ),
      ).toBeFalse();
      expect(
        isQuickAddWindowMode({ hash: '', search: '' }, fakeQuickAddDocument(false)),
      ).toBeFalse();
    });
  });
});

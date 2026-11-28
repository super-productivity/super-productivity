import {
  getColorContrastRatio,
  getRandomProjectColor,
  getWorkContextColorsForTheme,
  MIN_COLOR_CONTRAST_RATIO,
  PRESET_COLORS,
} from './work-context-color';

describe('work-context-color', () => {
  describe('getColorContrastRatio', () => {
    it('returns 21 for black against white', () => {
      expect(getColorContrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    });

    it('returns 1 for identical colors', () => {
      expect(getColorContrastRatio('#ffffff', '#ffffff')).toBe(1);
    });

    it('returns the same ratio regardless of argument order', () => {
      const forward = getColorContrastRatio('#ef5350', '#ffffff');
      const reverse = getColorContrastRatio('#ffffff', '#ef5350');

      expect(forward).toBeCloseTo(reverse);
    });
  });

  describe('getWorkContextColorsForTheme', () => {
    it('preserves all preset colors in the manual palette', () => {
      expect(PRESET_COLORS.length).toBe(19);
    });

    it('filters light-theme colors below the contrast threshold', () => {
      const colors = getWorkContextColorsForTheme(false);

      expect(colors.length).toBe(9);

      colors.forEach((color) => {
        expect(getColorContrastRatio(color, '#ffffff')).toBeGreaterThanOrEqual(
          MIN_COLOR_CONTRAST_RATIO,
        );
      });
    });

    it('filters dark-theme colors below the contrast threshold', () => {
      const colors = getWorkContextColorsForTheme(true);

      expect(colors.length).toBe(18);

      colors.forEach((color) => {
        expect(getColorContrastRatio(color, '#242424')).toBeGreaterThanOrEqual(
          MIN_COLOR_CONTRAST_RATIO,
        );
      });
    });

    it('does not modify the original preset palette', () => {
      expect(getWorkContextColorsForTheme(false).length).toBeLessThan(
        PRESET_COLORS.length,
      );

      expect(PRESET_COLORS.length).toBe(19);
    });
  });

  describe('getRandomProjectColor', () => {
    it('returns a color meeting the light-theme contrast threshold', () => {
      const color = getRandomProjectColor(false);

      expect(getWorkContextColorsForTheme(false)).toContain(color);
    });

    it('returns a color meeting the dark-theme contrast threshold', () => {
      const color = getRandomProjectColor(true);

      expect(getWorkContextColorsForTheme(true)).toContain(color);
    });
  });
});

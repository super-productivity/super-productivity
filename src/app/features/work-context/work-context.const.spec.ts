import {
  DEFAULT_BACKGROUND_IMAGE_BLUR,
  hasAllBackgroundImages,
  hasAnyBackgroundImage,
  MAX_BACKGROUND_IMAGE_BLUR,
  normalizeBackgroundImageBlur,
  WORK_CONTEXT_DEFAULT_THEME,
  WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG,
} from './work-context.const';

describe('work-context theme background image helpers', () => {
  it('should detect no background images', () => {
    const model = {
      backgroundImageDark: '',
      backgroundImageLight: null,
    };

    expect(hasAnyBackgroundImage(model)).toBe(false);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect a dark background image only', () => {
    const model = {
      backgroundImageDark: 'assets/bg/dark.jpg',
      backgroundImageLight: '',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect a light background image only', () => {
    const model = {
      backgroundImageDark: null,
      backgroundImageLight: 'assets/bg/light.jpg',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect both background images', () => {
    const model = {
      backgroundImageDark: 'assets/bg/dark.jpg',
      backgroundImageLight: 'assets/bg/light.jpg',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(true);
  });
});

describe('work-context theme background image blur config', () => {
  it('should default background image blur to 0', () => {
    expect(WORK_CONTEXT_DEFAULT_THEME.backgroundImageBlur).toBe(
      DEFAULT_BACKGROUND_IMAGE_BLUR,
    );
  });

  it('should configure the background image blur slider', () => {
    const field = WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG.items?.find(
      ({ key }) => key === 'backgroundImageBlur',
    );

    expect(field).toBeTruthy();
    expect(field?.defaultValue).toBeUndefined();
    expect(field?.props?.min).toBe(0);
    expect(field?.props?.max).toBe(MAX_BACKGROUND_IMAGE_BLUR);
    expect(field?.props?.displayWith?.(5)).toBe('5px');
  });

  it('should normalize missing and invalid blur values to the default', () => {
    expect(normalizeBackgroundImageBlur(undefined)).toBe(DEFAULT_BACKGROUND_IMAGE_BLUR);
    expect(normalizeBackgroundImageBlur(Number.NaN)).toBe(DEFAULT_BACKGROUND_IMAGE_BLUR);
    expect(normalizeBackgroundImageBlur(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_BACKGROUND_IMAGE_BLUR,
    );
    expect(normalizeBackgroundImageBlur('5')).toBe(DEFAULT_BACKGROUND_IMAGE_BLUR);
  });

  it('should clamp blur values to the supported slider range', () => {
    expect(normalizeBackgroundImageBlur(-1)).toBe(DEFAULT_BACKGROUND_IMAGE_BLUR);
    expect(normalizeBackgroundImageBlur(8)).toBe(8);
    expect(normalizeBackgroundImageBlur(MAX_BACKGROUND_IMAGE_BLUR + 1)).toBe(
      MAX_BACKGROUND_IMAGE_BLUR,
    );
  });
});

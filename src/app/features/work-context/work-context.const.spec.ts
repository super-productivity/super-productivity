import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UntypedFormGroup } from '@angular/forms';
import {
  FieldType,
  FormlyFieldConfig,
  FormlyFormBuilder,
  FormlyModule,
} from '@ngx-formly/core';
import {
  DEFAULT_BACKGROUND_IMAGE_BLUR,
  hasAllBackgroundImages,
  hasAnyBackgroundImage,
  MAX_BACKGROUND_IMAGE_BLUR,
  normalizeBackgroundImageBlur,
  WORK_CONTEXT_DEFAULT_THEME,
  WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG,
} from './work-context.const';
import { WorkContextThemeCfg } from './work-context.model';

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

/**
 * Regression for #8504. The overlay-opacity and blur sliders are hidden when no
 * background image is set. Formly's default `resetFieldOnHide: true` wipes the
 * model value of a field while it is hidden, so removing the image dropped
 * `backgroundOverlayOpacity` to `undefined`. Re-adding an image then showed the
 * slider at 0% (its min) instead of the configured value. Marking the sliders
 * `resetOnHide: false` keeps the value across the hide/show cycle.
 */
describe('work-context theme background slider persistence (#8504)', () => {
  @Component({ selector: 'noop-formly-field', template: '', standalone: true })
  class NoopFormlyFieldComponent extends FieldType {}

  const TYPE_STUBS = [
    'input',
    'color',
    'checkbox',
    'select',
    'image-input',
    'slider',
  ].map((name) => ({ name, component: NoopFormlyFieldComponent }));

  let builder: FormlyFormBuilder;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NoopFormlyFieldComponent, FormlyModule.forRoot({ types: TYPE_STUBS })],
    });
    builder = TestBed.inject(FormlyFormBuilder);
  });

  // JSON/structuredClone drop the function-based `expressions.hide`, so clone
  // manually and keep function references (they are pure) to isolate per-test
  // field state from Formly's in-place mutations.
  const cloneItems = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(cloneItems);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, cloneItems(v)]),
      );
    }
    return value;
  };

  // Formly mutates the model in place; the persisted type is `Readonly`.
  type MutableThemeCfg = {
    -readonly [K in keyof WorkContextThemeCfg]: WorkContextThemeCfg[K];
  };

  const buildThemeForm = (
    model: MutableThemeCfg,
  ): { fields: FormlyFieldConfig[]; model: MutableThemeCfg } => {
    const fields = cloneItems(
      WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG.items,
    ) as FormlyFieldConfig[];
    builder.buildForm(new UntypedFormGroup({}), fields, model, {});
    return { fields, model };
  };

  const fieldByKey = (
    fields: FormlyFieldConfig[],
    key: keyof WorkContextThemeCfg,
  ): FormlyFieldConfig => fields.find((f) => f.key === key)!;

  const checkExpressions = (field: FormlyFieldConfig): void => {
    const opts = field.options as any;
    opts.checkExpressions({ fieldGroup: [field], options: opts });
  };

  it('keeps the overlay opacity after removing and re-adding the image', () => {
    const model: MutableThemeCfg = {
      backgroundImageDark: 'image:first',
      backgroundImageLight: null,
      backgroundOverlayOpacity: 20,
    };
    const { fields } = buildThemeForm(model);
    const opacity = fieldByKey(fields, 'backgroundOverlayOpacity');
    const image = fieldByKey(fields, 'backgroundImageDark');

    checkExpressions(opacity);
    expect(opacity.hide).toBeFalsy();
    expect(model.backgroundOverlayOpacity).toBe(20);

    // Remove the image -> the opacity slider hides.
    image.formControl!.setValue('');
    model.backgroundImageDark = '';
    checkExpressions(opacity);
    expect(opacity.hide).toBe(true);

    // Re-add an image -> the opacity slider reappears.
    image.formControl!.setValue('image:second');
    model.backgroundImageDark = 'image:second';
    checkExpressions(opacity);
    expect(opacity.hide).toBeFalsy();

    expect(model.backgroundOverlayOpacity).toBe(20);
  });

  it('shows the configured opacity when an image is added to a context without one', () => {
    // Opacity slider is hidden at init (no image), but the theme still carries
    // the default opacity. Adding an image must reveal it at that value, not 0%.
    const model: MutableThemeCfg = {
      backgroundImageDark: null,
      backgroundImageLight: null,
      backgroundOverlayOpacity: 20,
    };
    const { fields } = buildThemeForm(model);
    const opacity = fieldByKey(fields, 'backgroundOverlayOpacity');
    const image = fieldByKey(fields, 'backgroundImageDark');

    checkExpressions(opacity);
    expect(opacity.hide).toBe(true);

    image.formControl!.setValue('image:added');
    model.backgroundImageDark = 'image:added';
    checkExpressions(opacity);

    expect(opacity.hide).toBeFalsy();
    expect(model.backgroundOverlayOpacity).toBe(20);
  });

  it('keeps a custom blur value after removing and re-adding the image', () => {
    const model: MutableThemeCfg = {
      backgroundImageDark: 'image:first',
      backgroundImageLight: null,
      backgroundImageBlur: 8,
    };
    const { fields } = buildThemeForm(model);
    const blur = fieldByKey(fields, 'backgroundImageBlur');
    const image = fieldByKey(fields, 'backgroundImageDark');

    checkExpressions(blur);
    expect(model.backgroundImageBlur).toBe(8);

    image.formControl!.setValue('');
    model.backgroundImageDark = '';
    checkExpressions(blur);
    expect(blur.hide).toBe(true);

    image.formControl!.setValue('image:second');
    model.backgroundImageDark = 'image:second';
    checkExpressions(blur);

    expect(model.backgroundImageBlur).toBe(8);
  });
});

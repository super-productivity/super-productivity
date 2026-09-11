import { ConfigOption, FormlyFieldConfig } from '@ngx-formly/core';
import { TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs/operators';
import { T } from '../../t.const';
import { msToString } from '../duration/ms-to-string.pipe';

/* eslint-disable @typescript-eslint/naming-convention */

export class TranslateExtension {
  constructor(private translate: TranslateService) {}

  prePopulate(field: FormlyFieldConfig): void {
    const to = field.templateOptions || {};
    if (Array.isArray(to.options)) {
      const options = to.options;
      // Filter out options without valid labels to prevent "Parameter key required" error
      const validOptions = options.filter((o) => o && o.label);
      if (validOptions.length > 0) {
        to.options = this.translate.stream(validOptions.map((o) => o.label)).pipe(
          map((labels) =>
            options.map((o) => {
              // Skip translation for items with invalid labels
              if (!o || !o.label) {
                return o;
              }
              return { ...o, label: labels[o.label] };
            }),
          ),
        );
      }
    }

    const validators = field.validators || {};
    for (const [k, validator] of Object.entries(validators)) {
      const v = validator as any;
      if (v.message && typeof v.message === 'string') {
        validators[k].message = this.translate.stream(v.message);
      }
    }

    field.expressionProperties = {
      ...(field.expressionProperties || {}),
      ...(typeof to.label === 'string' && to.label.length
        ? { 'templateOptions.label': this.translate.stream(to.label) }
        : {}),
      ...(typeof to.description === 'string' && to.description.length
        ? {
            'templateOptions.description': this.translate.stream(
              to.description,
              to.descriptionTranslateParams,
            ),
          }
        : {}),
      ...(typeof to.placeholder === 'string' && to.placeholder.length
        ? { 'templateOptions.placeholder': this.translate.stream(to.placeholder) }
        : {}),
    };
  }
}

/**
 * `min`/`max` on a `duration` field are milliseconds, so the raw number reads as
 * gibberish in the error ("Must not be smaller than 60000"). Render it the same
 * way the field itself does.
 */
const boundVal = (field: FormlyFieldConfig, key: 'min' | 'max'): unknown => {
  const val = field.templateOptions ? field.templateOptions[key] : null;
  return field.type === 'duration' && typeof val === 'number'
    ? msToString(val, true, true)
    : (val ?? null);
};

export const registerTranslateExtension = (
  translate: TranslateService,
): ConfigOption => ({
  extensions: [
    {
      name: 'translate',
      extension: new TranslateExtension(translate),
    },
  ],
  validationMessages: [
    { name: 'required', message: () => translate.stream(T.V.E_REQUIRED) },
    {
      name: 'minLength',
      message: (err, field: FormlyFieldConfig) =>
        translate.stream(T.V.E_MIN_LENGTH, {
          val: field.templateOptions ? field.templateOptions.minLength : null,
        }),
    },
    {
      name: 'maxLength',
      message: (err, field: FormlyFieldConfig) =>
        translate.stream(T.V.E_MAX_LENGTH, {
          val: field.templateOptions ? field.templateOptions.maxLength : null,
        }),
    },
    {
      name: 'min',
      message: (err, field) =>
        translate.stream(T.V.E_MIN, { val: boundVal(field, 'min') }),
    },
    {
      name: 'max',
      message: (err, field) =>
        translate.stream(T.V.E_MAX, { val: boundVal(field, 'max') }),
    },
  ],
});

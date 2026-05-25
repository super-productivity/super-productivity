import { FormlyFieldConfig } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { buildWorkContextSettingsFormCfg } from './work-context-settings-form-cfg.const';

const findField = (
  fields: FormlyFieldConfig[] | undefined,
  key: string,
): FormlyFieldConfig | undefined => fields?.find((field) => field.key === key);

const findThemeColorField = (
  fields: FormlyFieldConfig[],
  key: string,
): FormlyFieldConfig | undefined => {
  const themeField = findField(fields, 'theme');
  const colorRow = themeField?.fieldGroup?.[0];

  return findField(colorRow?.fieldGroup, key);
};

describe('buildWorkContextSettingsFormCfg', () => {
  it('should place the tag color default description on the primary color field', () => {
    const fields = buildWorkContextSettingsFormCfg(false);

    expect(findField(fields, 'color')?.templateOptions?.description).toBeUndefined();
    expect(findThemeColorField(fields, 'primary')?.templateOptions?.description).toBe(
      T.F.TAG.FORM_BASIC.D_COLOR,
    );
  });

  it('should not add the tag-only default description to project primary color', () => {
    const fields = buildWorkContextSettingsFormCfg(true);

    expect(
      findThemeColorField(fields, 'primary')?.templateOptions?.description,
    ).toBeUndefined();
  });
});

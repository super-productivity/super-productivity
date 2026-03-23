import { FormlyFieldConfig } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG } from '../work-context.const';

export const buildWorkContextSettingsFormCfg = (
  isProject: boolean,
): FormlyFieldConfig[] => {
  const basicFields: FormlyFieldConfig[] = [
    {
      key: 'title',
      type: 'input',
      templateOptions: {
        required: true,
        label: isProject ? T.F.PROJECT.FORM_BASIC.L_TITLE : T.F.TAG.FORM_BASIC.L_TITLE,
      },
    },
    {
      key: 'icon',
      type: 'icon',
      templateOptions: {
        label: T.F.TAG.FORM_BASIC.L_ICON,
        description: T.G.ICON_INP_DESCRIPTION,
      },
    },
  ];

  if (!isProject) {
    basicFields.push({
      key: 'color',
      type: 'color',
      templateOptions: {
        label: T.F.TAG.FORM_BASIC.L_COLOR,
      },
    });
  }

  if (isProject) {
    basicFields.push(
      {
        key: 'isEnableBacklog',
        type: 'checkbox',
        templateOptions: {
          label: T.F.PROJECT.FORM_BASIC.L_ENABLE_BACKLOG,
        },
      },
      {
        key: 'isHiddenFromMenu',
        type: 'checkbox',
        templateOptions: {
          label: T.F.PROJECT.FORM_BASIC.L_IS_HIDDEN_FROM_MENU,
        },
      },
    );
  }

  const sharedItems = WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG.items!;
  const colorFields = sharedItems.slice(0, 3);
  const remainingFields = sharedItems.slice(3);

  const themeFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'formly-row',
      fieldGroup: colorFields,
    },
    ...remainingFields,
  ];

  return [
    ...basicFields,
    {
      key: 'theme',
      fieldGroup: themeFields,
    },
  ];
};

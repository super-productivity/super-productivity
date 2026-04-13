import { FormlyFieldConfig } from '@ngx-formly/core';

export const adjustToDialogFormlyForm = (
  items: FormlyFieldConfig[],
): FormlyFieldConfig[] => {
  return items
    .filter((item): item is FormlyFieldConfig => item != null)
    .map((item) => {
      if (item.type === 'checkbox') {
        return { ...item, type: 'toggle' };
      }
      if (Array.isArray(item?.fieldGroup)) {
        return { ...item, fieldGroup: adjustToDialogFormlyForm(item.fieldGroup) };
      }
      return item;
    });
};

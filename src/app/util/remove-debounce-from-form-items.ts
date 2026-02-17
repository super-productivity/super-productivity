import { FormlyFieldConfig } from '@ngx-formly/core';

export const removeDebounceFromFormItems = (
  items: FormlyFieldConfig[],
): FormlyFieldConfig[] => {
  return items.map((item) => {
    const result =
      item.type === 'input'
        ? {
            ...item,
            modelOptions: {
              ...item.modelOptions,
              debounce: {
                default: 0,
              },
            },
          }
        : { ...item };
    if (result.fieldGroup) {
      result.fieldGroup = removeDebounceFromFormItems(result.fieldGroup);
    }
    return result;
  });
};

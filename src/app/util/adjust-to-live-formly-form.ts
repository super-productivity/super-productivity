import { FormlyFieldConfig } from '@ngx-formly/core';
import { stringToMs } from '../ui/duration/string-to-ms.pipe';

export const adjustToLiveFormlyForm = (
  items: FormlyFieldConfig[],
): FormlyFieldConfig[] => {
  // Filter out undefined/null items to prevent "Cannot read properties of undefined" errors
  // This can happen during race conditions when forms are rebuilt during state changes
  const validItems = items.filter((item): item is FormlyFieldConfig => item != null);

  return validItems.map((item) => {
    if (item.type === 'checkbox') {
      return {
        ...item,
        type: 'toggle',
      };
    }
    if (
      item.type === 'input' ||
      item.type === 'textarea' ||
      item.type === 'duration' ||
      item.type === 'icon' ||
      item.type === 'color'
    ) {
      return {
        ...item,
        templateOptions: {
          ...item.templateOptions,
          keydown: (field: FormlyFieldConfig, event: KeyboardEvent) => {
            const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
            if (event.key === 'Enter' && target?.tagName !== 'TEXTAREA') {
              event.preventDefault();
              const value = target?.value;
              // For duration fields, convert the string to milliseconds
              if (item.type === 'duration') {
                field.formControl?.setValue(value ? stringToMs(value) : null);
              } else if (item?.templateOptions?.type === 'number') {
                field.formControl?.setValue(value ? Number(value) : 0);
              } else {
                field.formControl?.setValue(value);
              }
            }
          },
        },
        modelOptions: {
          ...item.modelOptions,
          updateOn: 'blur',
        },
      };
    }

    if (Array.isArray(item?.fieldGroup)) {
      return {
        ...item,
        fieldGroup: adjustToLiveFormlyForm(item?.fieldGroup),
      };
    }

    if (item.type === 'repeat' && item.fieldArray) {
      const fieldArray = item.fieldArray as FormlyFieldConfig;

      // Handle fieldArray with fieldGroup (complex repeat items)
      if (fieldArray.fieldGroup && Array.isArray(fieldArray.fieldGroup)) {
        return {
          ...item,
          fieldArray: {
            ...fieldArray,
            fieldGroup: adjustToLiveFormlyForm(fieldArray.fieldGroup),
          },
        };
      }

      // Handle simple fieldArray with just a type (e.g., { type: 'input' })
      if (fieldArray.type) {
        const adjusted = adjustToLiveFormlyForm([fieldArray]);
        return {
          ...item,
          fieldArray: adjusted[0],
        };
      }
    }

    return item;
  });
};
